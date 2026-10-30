// interactions.js — ميزات التفاعل والمراسلة (P4 — بحث الميزات):
// أنماط WhatsApp/Telegram/Signal/Session المتبقية، بنفس عقد رسن الآمن:
//   1. تفاعلات الإيموجي (Reactions) — إيموجي واحد لكل مستخدم لكل رسالة
//      (نمط WhatsApp) مع قائمة بيضاء مغلقة: التفاعل بيانات وصفية (ميتاداتا)
//      بلا أي محتوى، فلا يلمس E2EE ولا يكشف شيئاً للخادم.
//   2. حظر المستخدمين (Blocking) — حظر ثنائي الاتجاه يمنع فتح DM جديدة،
//       يمنع إضافة المحظور-لي للمجموعات (نمط Telegram)، ويصمت رسائل DM
//       القائمة (فحص في مسار socket message بـ server.js عبر isBlockedBetween).
//   3. الردود (Replies) — مرجع معرّف فقط: النص المقتبس داخل ciphertext
//      العميل (E2EE) — الخادم يخزن/يتحقق من المعرف ويعيد توزيعه.
// التنظيف: زنادا db.js يمسحان التفاعلات على كل مسارات حذف الرسائل.
// التفاعلات والحظر أسماء مستخدمين/أرقام فقط — لا نص حر يُخزَّن إطلاقاً.
const express = require("express");
const { db } = require("./db");

// قائمة الإيموجي المسموحة (نمط شريط التفاعلات في WhatsApp/Slack) — ثابتة
// ومغلقة: أي إيموجي خارجها يُرفض 400 فلا يمكن استخدام الحقل كقناة بيانات.
const ALLOWED_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "😡", "🔥", "✅"];

function getRole(conversationId, userId) {
  const row = db
    .prepare("SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?")
    .get(conversationId, userId);
  return row ? row.role : null;
}

// هل الحجب قائم بين طرفين (أي اتجاه)؟ — بوابة رسائل DM وفتح DM الجديد
function isBlockedBetween(a, b) {
  return !!db
    .prepare("SELECT 1 FROM blocked_users WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)")
    .get(a, b, b, a);
}

// اتجاهي: هل حجب (a) المستخدم (b)؟ — بوابة إضافة الأعضاء (نمط Telegram)
function hasBlocked(a, b) {
  return !!db.prepare("SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?").get(a, b);
}

// تفاعلات رسائل مجموعة صفوف رسائل (تجميع: [{emoji, userId}] لكل رسالة) —
// تُستدعى من مسار جلب الرسائل في server.js؛ تُعيد صفوفاً جديدة بلا تعديل الأصل.
function attachReactions(rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id).filter((id) => Number.isInteger(id));
  if (!ids.length) return rows;
  const map = new Map();
  const placeholders = ids.map(() => "?").join(",");
  const list = db
    .prepare(`SELECT message_id, emoji, user_id AS userId FROM message_reactions WHERE message_id IN (${placeholders}) ORDER BY created_at ASC`)
    .all(...ids);
  for (const r of list) {
    if (!map.has(r.message_id)) map.set(r.message_id, []);
    map.get(r.message_id).push({ emoji: r.emoji, userId: r.userId });
  }
  return rows.map((r) => (map.has(r.id) ? { ...r, reactions: map.get(r.id) } : r));
}

function createRouter({ authRequired, io }) {
  const router = express.Router();

  // ===== 1) تفاعل إيموجي على رسالة — وضع/تبديل/إزالة (نمط WhatsApp) =====
  router.put("/messages/:id/reaction", authRequired, (req, res) => {
    const msgId = Number(req.params.id);
    const emoji = (req.body || {}).emoji;
    if (!Number.isInteger(msgId)) return res.status(400).json({ error: "bad id" });

    // الإزالة: emoji فارغ أو null = سحب تفاعلي الحالي (toggle off)
    const removing = emoji === null || emoji === undefined || emoji === "";
    if (!removing && (typeof emoji !== "string" || !ALLOWED_REACTIONS.includes(emoji)))
      return res.status(400).json({ error: "emoji not allowed", allowed: ALLOWED_REACTIONS.length });

    const msg = db
      .prepare("SELECT id, conversation_id, sender_id, deleted FROM messages WHERE id = ?")
      .get(msgId);
    if (!msg || msg.conversation_id == null) return res.status(404).json({ error: "not found" });
    // عضوية الغرفة شرط — لا تفاعل من خارج المحادثة
    if (!getRole(msg.conversation_id, req.user.id)) return res.status(403).json({ error: "forbidden" });
    if (msg.deleted) return res.status(400).json({ error: "message deleted" });

    if (removing) {
      db.prepare("DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?").run(msgId, req.user.id);
      io.to("conv:" + msg.conversation_id).emit("message:reaction", { conversationId: msg.conversation_id, messageId: msgId, userId: req.user.id, emoji: null });
      return res.json({ ok: true, emoji: null });
    }

    // إيموجي واحد لكل مستخدم لكل رسالة: نفس الإيموجي = إزالة (toggle)، مختلف = استبدال
    const existing = db
      .prepare("SELECT emoji FROM message_reactions WHERE message_id = ? AND user_id = ?")
      .get(msgId, req.user.id);
    if (existing && existing.emoji === emoji) {
      db.prepare("DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?").run(msgId, req.user.id);
      io.to("conv:" + msg.conversation_id).emit("message:reaction", { conversationId: msg.conversation_id, messageId: msgId, userId: req.user.id, emoji: null });
      return res.json({ ok: true, emoji: null });
    }
    db.prepare(
      `INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(message_id, user_id) DO UPDATE SET emoji = excluded.emoji, created_at = excluded.created_at`
    ).run(msgId, req.user.id, emoji, Date.now());
    io.to("conv:" + msg.conversation_id).emit("message:reaction", { conversationId: msg.conversation_id, messageId: msgId, userId: req.user.id, emoji });
    res.json({ ok: true, emoji });
  });

  // ===== 2) حظر المستخدمين — ثنائي الاتجاه في البوابات، أحادي في السجل =====
  router.post("/users/:id/block", authRequired, (req, res) => {
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId)) return res.status(400).json({ error: "bad id" });
    if (targetId === req.user.id) return res.status(400).json({ error: "cannot block self" });
    const target = db.prepare("SELECT id FROM users WHERE id = ?").get(targetId);
    if (!target) return res.status(404).json({ error: "user not found" });
    db.prepare("INSERT INTO blocked_users (blocker_id, blocked_id, created_at) VALUES (?, ?, ?) ON CONFLICT(blocker_id, blocked_id) DO NOTHING")
      .run(req.user.id, targetId, Date.now());
    res.json({ ok: true, userId: targetId });
  });

  router.delete("/users/:id/block", authRequired, (req, res) => {
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId)) return res.status(400).json({ error: "bad id" });
    db.prepare("DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?").run(req.user.id, targetId);
    res.json({ ok: true });
  });

  router.get("/users/blocks", authRequired, (req, res) => {
    const rows = db
      .prepare("SELECT bu.blocked_id AS userId, u.username, bu.created_at AS createdAt FROM blocked_users bu JOIN users u ON u.id = bu.blocked_id WHERE bu.blocker_id = ? ORDER BY bu.created_at DESC")
      .all(req.user.id);
    res.json({ blocks: rows });
  });

  return router;
}

module.exports = { createRouter, isBlockedBetween, hasBlocked, attachReactions, ALLOWED_REACTIONS, getRole };
