// src/routes/notifications.js
import { Router }       from "express";
import { supabaseAdmin } from "../lib/supabase.js";
import { requireAuth }  from "../middleware/auth.js";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Helper — fetch notifications for a user, merging global + user-specific,
// and attaching their read/dismissed status from user_notifications
// ─────────────────────────────────────────────────────────────────────────────
async function getUserNotifications(userId, userType, limit = 30) {
  // 1. Fetch all notifications targeting this user
  //    (global OR explicitly targeted by ID OR targeted by userType)
  const { data: notifs, error } = await supabaseAdmin
    .from("notifications")
    .select("*")
    .or(
      `target_all.eq.true,` +
      `target_user_ids.cs.{${userId}}`
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  // Filter by user_type targeting if set
  const filtered = notifs.filter(n => {
    if (!n.target_user_types || n.target_user_types.length === 0) return true;
    return n.target_user_types.includes(userType);
  });

  if (filtered.length === 0) return [];

  // 2. Fetch this user's read/dismissed statuses
  const notifIds = filtered.map(n => n.id);
  const { data: statuses } = await supabaseAdmin
    .from("user_notifications")
    .select("notification_id, read, dismissed, read_at")
    .eq("user_id", userId)
    .in("notification_id", notifIds);

  const statusMap = {};
  (statuses || []).forEach(s => { statusMap[s.notification_id] = s; });

  // 3. Merge and return
  return filtered
    .filter(n => !statusMap[n.id]?.dismissed)
    .map(n => ({
      ...n,
      read:     statusMap[n.id]?.read     ?? false,
      read_at:  statusMap[n.id]?.read_at  ?? null,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/notifications
// Returns all notifications for authenticated user
// ─────────────────────────────────────────────────────────────────────────────
router.get("/", requireAuth, async (req, res) => {
  try {
    const notifications = await getUserNotifications(
      req.user.id,
      req.user.userType,
      50
    );
    const unreadCount = notifications.filter(n => !n.read).length;
    return res.json({ notifications, unreadCount });
  } catch (err) {
    console.error("GET /notifications error:", err);
    return res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/notifications/unread-count
// Lightweight — just returns the unread count (for polling)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/unread-count", requireAuth, async (req, res) => {
  try {
    const notifications = await getUserNotifications(
      req.user.id,
      req.user.userType,
      100
    );
    const unreadCount = notifications.filter(n => !n.read).length;
    return res.json({ unreadCount });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/notifications/public
// Returns notifications for unauthenticated users (global only, no read state)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/public", async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("notifications")
      .select("id, type, title, body, emoji, color, action_page, created_at")
      .eq("target_all", true)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) throw error;
    return res.json({ notifications: data, unreadCount: 0 });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/notifications/:id/read
// Mark a single notification as read
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/:id/read", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await upsertUserNotif(req.user.id, id, { read: true, read_at: new Date().toISOString() });
    return res.json({ message: "पढिएको चिन्ह लगाइयो।" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/notifications/read-all
// Mark all notifications as read for this user
// ─────────────────────────────────────────────────────────────────────────────
router.post("/read-all", requireAuth, async (req, res) => {
  try {
    const notifications = await getUserNotifications(req.user.id, req.user.userType, 100);
    const unread = notifications.filter(n => !n.read);

    await Promise.all(
      unread.map(n => upsertUserNotif(req.user.id, n.id, {
        read: true,
        read_at: new Date().toISOString(),
      }))
    );

    return res.json({ message: "सबै पढिएको चिन्ह लगाइयो।", count: unread.length });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/notifications/:id
// Dismiss (soft-delete) a notification for this user
// ─────────────────────────────────────────────────────────────────────────────
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    await upsertUserNotif(req.user.id, req.params.id, { dismissed: true, read: true });
    return res.json({ message: "सूचना हटाइयो।" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/notifications/admin/send
// Admin only — create a new notification
// Body: { type, title, body, emoji, color, action_page, action_data,
//         target_all, target_user_ids, target_user_types }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/admin/send", requireAuth, async (req, res) => {
  try {
    if (req.user.userType !== "staff" && req.user.userType !== "admin") {
      return res.status(403).json({ message: "अनुमति छैन।" });
    }

    const {
      type = "system",
      title, body, emoji = "🔔", color = "#1a3a6b",
      action_page, action_data,
      target_all = true,
      target_user_ids,
      target_user_types,
    } = req.body;

    if (!title || !body) {
      return res.status(400).json({ message: "शीर्षक र सन्देश आवश्यक छ।" });
    }

    const { data, error } = await supabaseAdmin
      .from("notifications")
      .insert({
        type, title, body, emoji, color,
        action_page, action_data,
        target_all,
        target_user_ids: target_all ? null : target_user_ids,
        target_user_types: target_user_types || null,
        created_by: req.user.id,
      })
      .select()
      .single();

    if (error) throw error;

    console.log(`✅ Notification sent by ${req.user.email}: "${title}"`);
    return res.json({ message: "सूचना पठाइयो।", notification: data });
  } catch (err) {
    console.error("admin/send error:", err);
    return res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper — upsert a user_notifications row
// ─────────────────────────────────────────────────────────────────────────────
async function upsertUserNotif(userId, notificationId, updates) {
  const { error } = await supabaseAdmin
    .from("user_notifications")
    .upsert(
      { user_id: userId, notification_id: notificationId, ...updates },
      { onConflict: "user_id,notification_id" }
    );
  if (error) throw error;
}

export default router;