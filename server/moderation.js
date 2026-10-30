// moderation.js — حزمة أدوات الإشراف (من بحث الميزات — درس FireChat §6:
// "نجاح تقني بلا إدارة محتوى لا يدوم"). تغطي:
//   1. حذف رسالة أي عضو (حذف ناعم deleted=1) — المرسل أو المشرف/المالك.
//   2. تثبيت/إلغاء تثبيت رسالة واحدة لكل محادثة (pinned_message_id).
//   3. ترقية/تنزيل مشرفين (owner فقط) — الأدوار: owner > admin > member.
//   4. حظر/رفع حظر (owner/admin) — المحظور لا يمكن إضافته ثانيةً
//      (فحص الحظر في server.js POST members عبر isBanned أدناه).
// كل نقطة خلف authRequired وخلف فحص عضوية/رتبة صريح. كل بث للغرفة عبر
// Socket.IO ليتحدث الجميع فورًا. الحذف الناعم يحذف المرفق بملفه من القرص
// (نفس سلوك الرسائل المتلاشية في server.js) — لا ملفات يتيمة.
const express = require("express");
const path = require("path");
const fs = require("fs");
const { db, UPLOAD_DIR } = require("./db");

// هل المستخدم محظور من هذه المحادثة؟ (يستخدمه server.js قبل إضافة عضو)
function isBanned(conversationId, userId) {
  return !!db
    .prepare("SELECT 1 FROM conversation_bans WHERE conversation_id = ? AND user_id = ?")
    .get(conversationId, userId);
}

function getRole(conversationId, userId) {
  const row = db
    .prepare("SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?")
    .get(conversationId, userId);
  return row ? row.role : null;
}

function isAdminRole(role) {
  return role === "owner" || role === "admin";
}

// حذف المرفق المرتبط برسالة: الملف من القرص + صفه (لا تسريب مساحة، لا ملفات يتيمة)
function purgeAttachment(attachmentId) {
  if (!attachmentId) return;
  const p = path.join(UPLOAD_DIR, attachmentId + ".bin");
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
  db.prepare("DELETE FROM attachments WHERE id = ?").run(attachmentId);
}

function createRouter({ authRequired, io }) {
  const router = express.Router();

  // ===== 1) حذف رسالة للجميع (المرسل نفسه، أو مشرف/مالك على رسالة غيره) =====
  // حذف ناعم (deleted=1): يبقى السجل للتدقيق ويختفي من كل العملاء — نفس عقد
  // message:deleted الذي تعرفونه من الرسائل المتلاشية فلا يحتاج العميل شيفرة جديدة.
  router.delete("/conversations/:id/messages/:messageId", authRequired, (req, res) => {
    const convId = Number(req.params.id);
    const msgId = Number(req.params.messageId);
    if (!Number.isInteger(convId) || !Number.isInteger(msgId))
      return res.status(400).json({ error: "bad ids" });

    const role = getRole(convId, req.user.id);
    if (!role) return res.status(403).json({ error: "forbidden" });

    const msg = db
      .prepare("SELECT id, conversation_id, sender_id, attachment_id, deleted FROM messages WHERE id = ?")
      .get(msgId);
    if (!msg || msg.conversation_id !== convId) return res.status(404).json({ error: "not found" });
    if (msg.deleted) return res.json({ ok: true }); // حذف مكرر — نجاح صامت (idempotent)

    const isSender = msg.sender_id === req.user.id;
    if (!isSender && !isAdminRole(role))
      return res.status(403).json({ error: "not allowed" });

    db.prepare("UPDATE messages SET deleted = 1 WHERE id = ?").run(msgId);
    purgeAttachment(msg.attachment_id);
    io.to("conv:" + convId).emit("message:deleted", { id: msgId });
    res.json({ ok: true });
  });

  // ===== 2) تثبيت رسالة (رسالة واحدة مثبّتة لكل محادثة) =====
  router.put("/conversations/:id/pin", authRequired, (req, res) => {
    const convId = Number(req.params.id);
    const msgId = Number((req.body || {}).messageId);
    if (!Number.isInteger(convId) || !Number.isInteger(msgId))
      return res.status(400).json({ error: "bad ids" });

    const role = getRole(convId, req.user.id);
    if (!role) return res.status(403).json({ error: "forbidden" });
    if (!isAdminRole(role)) return res.status(403).json({ error: "not allowed" });

    const msg = db
      .prepare("SELECT id, conversation_id, deleted FROM messages WHERE id = ?")
      .get(msgId);
    if (!msg || msg.conversation_id !== convId) return res.status(404).json({ error: "not found" });
    if (msg.deleted) return res.status(400).json({ error: "message deleted" });

    db.prepare("UPDATE conversations SET pinned_message_id = ? WHERE id = ?").run(msgId, convId);
    // المحتوى E2EE — نبعث المعرّف فقط؛ العميل الذي يملك المفتاح يفكّه عند العرض
    io.to("conv:" + convId).emit("message:pinned", { conversationId: convId, messageId: msgId, by: req.user.id });
    res.json({ ok: true, messageId: msgId });
  });

  router.delete("/conversations/:id/pin", authRequired, (req, res) => {
    const convId = Number(req.params.id);
    if (!Number.isInteger(convId)) return res.status(400).json({ error: "bad id" });
    const role = getRole(convId, req.user.id);
    if (!role) return res.status(403).json({ error: "forbidden" });
    if (!isAdminRole(role)) return res.status(403).json({ error: "not allowed" });
    db.prepare("UPDATE conversations SET pinned_message_id = NULL WHERE id = ?").run(convId);
    io.to("conv:" + convId).emit("message:unpinned", { conversationId: convId, by: req.user.id });
    res.json({ ok: true });
  });

  // ===== 3) ترقية/تنزيل مشرف — المالك وحده يغيّر الأدوار =====
  // owner فقط: منح مشرف ثقة هو قرار تأسيسي لا يُفوَّض. المالك لا يُنزَّل ولا
  // يغيّر دوره، والمستهدف عضو قائم بالفعل في المحادثة.
  router.put("/conversations/:id/members/:userId/role", authRequired, (req, res) => {
    const convId = Number(req.params.id);
    const targetId = Number(req.params.userId);
    const role = (req.body || {}).role;
    if (!Number.isInteger(convId) || !Number.isInteger(targetId))
      return res.status(400).json({ error: "bad ids" });
    if (!["admin", "member"].includes(role))
      return res.status(400).json({ error: "role must be admin|member" });

    const myRole = getRole(convId, req.user.id);
    if (myRole !== "owner") return res.status(403).json({ error: "owner only" });
    if (targetId === req.user.id) return res.status(400).json({ error: "cannot change own role" });

    const targetRole = getRole(convId, targetId);
    if (!targetRole) return res.status(404).json({ error: "member not found" });
    if (targetRole === "owner") return res.status(400).json({ error: "cannot change owner role" });

    db.prepare("UPDATE conversation_members SET role = ? WHERE conversation_id = ? AND user_id = ?")
      .run(role, convId, targetId);
    io.to("conv:" + convId).emit("member:role", { conversationId: convId, userId: targetId, role, by: req.user.id });
    res.json({ ok: true, userId: targetId, role });
  });

  // ===== 4) حظر/رفع حظر =====
  // الحظر = إزالة عضوية + حذف مفاتيحه الملفوفة (لا يبقى له وصول للمحتوى القادم)
  // + سجل conversation_bans يمنع إضافته ثانيةً من server.js (403 banned).
  router.post("/conversations/:id/bans", authRequired, (req, res) => {
    const convId = Number(req.params.id);
    const username = (req.body || {}).username;
    if (!Number.isInteger(convId)) return res.status(400).json({ error: "bad id" });
    if (typeof username !== "string" || !username.trim())
      return res.status(400).json({ error: "username required" });

    const role = getRole(convId, req.user.id);
    if (!role) return res.status(403).json({ error: "forbidden" });
    if (!isAdminRole(role)) return res.status(403).json({ error: "not allowed" });

    const target = db.prepare("SELECT id, username FROM users WHERE username = ?").get(username.trim());
    if (!target) return res.status(404).json({ error: "user not found" });
    const targetRole = getRole(convId, target.id);
    if (targetRole === "owner") return res.status(400).json({ error: "cannot ban owner" });
    // المالك يمكنه حظر أي أحد؛ المشرف لا يحظر مشرفًا آخر — سلّم إشرافي واضح
    if (targetRole === "admin" && role !== "owner")
      return res.status(403).json({ error: "owner only" });

    db.prepare("DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?").run(convId, target.id);
    db.prepare("DELETE FROM group_keys WHERE conversation_id = ? AND user_id = ?").run(convId, target.id);
    db.prepare(
      "INSERT INTO conversation_bans (conversation_id, user_id, banned_by, created_at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(conversation_id, user_id) DO NOTHING"
    ).run(convId, target.id, req.user.id, Date.now());

    io.to("conv:" + convId).emit("member:banned", { conversationId: convId, userId: target.id, username: target.username });
    res.json({ ok: true, userId: target.id });
  });

  router.delete("/conversations/:id/bans/:userId", authRequired, (req, res) => {
    const convId = Number(req.params.id);
    const targetId = Number(req.params.userId);
    if (!Number.isInteger(convId) || !Number.isInteger(targetId))
      return res.status(400).json({ error: "bad ids" });
    const role = getRole(convId, req.user.id);
    if (!role) return res.status(403).json({ error: "forbidden" });
    if (!isAdminRole(role)) return res.status(403).json({ error: "not allowed" });
    db.prepare("DELETE FROM conversation_bans WHERE conversation_id = ? AND user_id = ?").run(convId, targetId);
    io.to("conv:" + convId).emit("member:unbanned", { conversationId: convId, userId: targetId });
    res.json({ ok: true });
  });

  router.get("/conversations/:id/bans", authRequired, (req, res) => {
    const convId = Number(req.params.id);
    if (!Number.isInteger(convId)) return res.status(400).json({ error: "bad id" });
    const role = getRole(convId, req.user.id);
    if (!role) return res.status(403).json({ error: "forbidden" });
    if (!isAdminRole(role)) return res.status(403).json({ error: "not allowed" });
    const rows = db
      .prepare(
        `SELECT cb.user_id AS userId, u.username, cb.banned_by AS bannedBy, cb.created_at AS createdAt
         FROM conversation_bans cb JOIN users u ON u.id = cb.user_id
         WHERE cb.conversation_id = ? ORDER BY cb.created_at DESC`
      )
      .all(convId);
    res.json({ bans: rows });
  });

  return router;
}

module.exports = { createRouter, isBanned, getRole, isAdminRole, purgeAttachment };
