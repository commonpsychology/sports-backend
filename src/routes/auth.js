import { Router }       from "express";
import jwt              from "jsonwebtoken";
import { supabase, supabaseAdmin } from "../lib/supabase.js";
import { sendOTPEmail } from "../lib/email.js";
import { generateOTP, storeOTP, verifyOTP } from "../lib/otp.js";
import { requireAuth }  from "../middleware/auth.js";

const router = Router();

const signToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "7d" });

const signPending = (data) =>
  jwt.sign(data, process.env.JWT_SECRET, { expiresIn: "15m" });

async function findAuthUser(email) {
  const { data } = await supabaseAdmin.auth.admin.listUsers();
  return data?.users?.find(u => u.email === email) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/register
// Saves user to DB immediately — no OTP at this step
// ─────────────────────────────────────────────────────────────────────────────
router.post("/register", async (req, res) => {
  try {
    const { fullName, email, phone, province, sport, userType, password } = req.body;

    if (!fullName || !email || !password || !phone || !province) {
      return res.status(400).json({ message: "सबै आवश्यक फिल्डहरू भर्नुहोस्।" });
    }

    // Check duplicate
    const existing = await findAuthUser(email);
    if (existing) {
      return res.status(409).json({ message: "यो इमेल पहिले नै दर्ता छ।" });
    }

    // Create Supabase Auth user immediately
    const { data: authData, error: authErr } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });

    if (authErr) {
      console.error("createUser error:", authErr);
      return res.status(500).json({ message: authErr.message });
    }

    // Insert profile row immediately
    const { error: profileErr } = await supabaseAdmin
      .from("user_profiles")
      .insert({
        id:        authData.user.id,
        full_name: fullName,
        phone,
        province,
        sport:     sport || null,
        user_type: userType || "player",
      });

    if (profileErr) {
      // Rollback auth user
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      console.error("profile insert error:", profileErr);
      return res.status(500).json({ message: "प्रोफाइल बनाउन असफल: " + profileErr.message });
    }

    console.log("✅ User registered:", email);
    return res.json({ message: "दर्ता सफल! अब लगइन गर्नुहोस्।" });

  } catch (err) {
    console.error("register error:", err);
    return res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/login
// Step 1 — verify email+password, then send OTP
// Returns: { pendingToken } — not logged in yet
// ─────────────────────────────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "इमेल र पासवर्ड आवश्यक छ।" });
    }

    // Verify credentials
    const { data: signInData, error: signInErr } =
      await supabase.auth.signInWithPassword({ email, password });

    if (signInErr) {
      return res.status(401).json({ message: "इमेल वा पासवर्ड गलत छ।" });
    }

    // Fetch profile
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("user_profiles")
      .select("*")
      .eq("id", signInData.user.id)
      .single();

    if (profileErr || !profile) {
      return res.status(404).json({ message: "प्रोफाइल फेला परेन।" });
    }

    // Send OTP for 2FA
    const otp = generateOTP();
    await storeOTP(email, otp, "login");
    await sendOTPEmail({ to: email, otp, purpose: "login" });

    // Pack user info into short-lived pending token
    const pendingToken = signPending({
      id:       signInData.user.id,
      email,
      fullName: profile.full_name,
      userType: profile.user_type,
      province: profile.province,
      sport:    profile.sport,
      phone:    profile.phone,
    });

    console.log("✅ OTP sent for login:", email);
    return res.json({
      message:      "OTP पठाइयो। प्रमाणीकरण गर्नुहोस्।",
      pendingToken,
    });

  } catch (err) {
    console.error("login error:", err);
    return res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/verify-login-otp
// Step 2 — verify OTP, return final token + user
// ─────────────────────────────────────────────────────────────────────────────
router.post("/verify-login-otp", async (req, res) => {
  try {
    const { otp, pendingToken } = req.body;

    if (!otp || !pendingToken) {
      return res.status(400).json({ message: "OTP र token आवश्यक छ।" });
    }

    let pending;
    try {
      pending = jwt.verify(pendingToken, process.env.JWT_SECRET);
    } catch {
      return res.status(400).json({ message: "Session म्याद सकियो। पुनः लगइन गर्नुहोस्।" });
    }

    const valid = await verifyOTP(pending.email, otp, "login");
    if (!valid) {
      return res.status(400).json({ message: "OTP गलत वा म्याद सकियो।" });
    }

    // Issue final session token
    const token = signToken({
      id:       pending.id,
      email:    pending.email,
      fullName: pending.fullName,
      userType: pending.userType,
    });

    console.log("🎉 Login complete:", pending.email);
    return res.json({
      token,
      user: {
        id:       pending.id,
        email:    pending.email,
        fullName: pending.fullName,
        userType: pending.userType,
        province: pending.province,
        sport:    pending.sport,
        phone:    pending.phone,
      },
    });

  } catch (err) {
    console.error("verify-login-otp error:", err);
    return res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/resend-otp
// ─────────────────────────────────────────────────────────────────────────────
router.post("/resend-otp", async (req, res) => {
  try {
    const { email, pendingToken, purpose = "login" } = req.body;

    try { jwt.verify(pendingToken, process.env.JWT_SECRET); }
    catch { return res.status(400).json({ message: "Session म्याद सकियो।" }); }

    const otp = generateOTP();
    await storeOTP(email, otp, purpose);
    await sendOTPEmail({ to: email, otp, purpose });

    return res.json({ message: "OTP पुनः पठाइयो।" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/forgot-password
// ─────────────────────────────────────────────────────────────────────────────
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "इमेल आवश्यक छ।" });

    const user = await findAuthUser(email);
    if (user) {
      const otp = generateOTP();
      await storeOTP(email, otp, "reset");
      await sendOTPEmail({ to: email, otp, purpose: "reset" });
    }

    return res.json({ message: "OTP पठाइयो (यदि इमेल दर्ता छ भने)।" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/verify-reset-otp
// ─────────────────────────────────────────────────────────────────────────────
router.post("/verify-reset-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;

    const valid = await verifyOTP(email, otp, "reset");
    if (!valid) {
      return res.status(400).json({ message: "OTP गलत वा म्याद सकियो।" });
    }

    const resetToken = jwt.sign(
      { email, purpose: "reset" },
      process.env.JWT_SECRET,
      { expiresIn: "10m" }
    );

    return res.json({ resetToken });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/reset-password
// ─────────────────────────────────────────────────────────────────────────────
router.post("/reset-password", async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;

    if (!resetToken || !newPassword) {
      return res.status(400).json({ message: "सबै फिल्डहरू आवश्यक छन्।" });
    }

    let payload;
    try {
      payload = jwt.verify(resetToken, process.env.JWT_SECRET);
      if (payload.purpose !== "reset") throw new Error();
    } catch {
      return res.status(400).json({ message: "Reset token अमान्य वा म्याद सकियो।" });
    }

    const user = await findAuthUser(payload.email);
    if (!user) return res.status(404).json({ message: "प्रयोगकर्ता फेला परेन।" });

    const { error } = await supabaseAdmin.auth.admin.updateUserById(
      user.id, { password: newPassword }
    );

    if (error) return res.status(500).json({ message: error.message });

    return res.json({ message: "पासवर्ड सफलतापूर्वक परिवर्तन भयो।" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/me  (protected)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/me", requireAuth, async (req, res) => {
  try {
    const { data: profile } = await supabaseAdmin
      .from("user_profiles")
      .select("*")
      .eq("id", req.user.id)
      .single();

    return res.json({ user: { ...req.user, ...profile } });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/logout  (protected)
// ─────────────────────────────────────────────────────────────────────────────
router.post("/logout", requireAuth, (req, res) => {
  return res.json({ message: "लगआउट सफल।" });
});

export default router;