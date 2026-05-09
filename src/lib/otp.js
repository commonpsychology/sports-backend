import { supabaseAdmin } from "./supabase.js";

export function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function storeOTP(email, code, purpose) {
  const normalizedEmail = email.toLowerCase().trim();

  await supabaseAdmin
    .from("otp_codes")
    .update({ used: true })
    .eq("email",   normalizedEmail)
    .eq("purpose", purpose)
    .eq("used",    false);

  const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const { error } = await supabaseAdmin
    .from("otp_codes")
    .insert({
      email:      normalizedEmail,
      code:       code.toString(),
      purpose,
      expires_at,
    });

  if (error) {
    console.error("❌ storeOTP error:", error);
    throw new Error("OTP भण्डारण असफल।");
  }

  console.log(`✅ OTP stored: ${normalizedEmail} | ${code} | ${purpose} | expires: ${expires_at}`);
}

export async function verifyOTP(email, code, purpose) {
  const normalizedEmail = email.toLowerCase().trim();
  const normalizedCode  = code.toString().trim();
  const now             = new Date().toISOString();

  console.log("🔍 verifyOTP attempt →", { normalizedEmail, normalizedCode, purpose, now });

  // First: check if ANY matching row exists (ignore expiry/used to debug)
  const { data: debugRows } = await supabaseAdmin
    .from("otp_codes")
    .select("*")
    .eq("email",   normalizedEmail)
    .eq("purpose", purpose)
    .order("created_at", { ascending: false })
    .limit(5);

  console.log("🗃️  Recent OTP rows for this email:", JSON.stringify(debugRows, null, 2));

  // Now do the real check
  const { data, error } = await supabaseAdmin
    .from("otp_codes")
    .select("*")
    .eq("email",   normalizedEmail)
    .eq("code",    normalizedCode)
    .eq("purpose", purpose)
    .eq("used",    false)
    .gte("expires_at", now)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("❌ verifyOTP query error:", error);
    return false;
  }

  if (!data) {
    console.warn("⚠️ OTP not matched. Check debug rows above ↑");
    return false;
  }

  await supabaseAdmin
    .from("otp_codes")
    .update({ used: true })
    .eq("id", data.id);

  console.log("✅ OTP verified successfully:", normalizedEmail);
  return true;
}