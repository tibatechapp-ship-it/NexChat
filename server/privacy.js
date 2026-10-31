// privacy.js — P6: خصوصية المحادثة (مستوحى من مراجعة المنافسين)
//
// 1) مؤقت المتلاشية على مستوى المحادثة (نمط Signal «Disappearing Messages»):
//    PATCH /api/conversations/:id/ttl — عضو فقط، تحقق صارم من المدة (0..سنة)
//    وتُبث للغرفة عبر conv:ttl. الرسائل الجديدة ترث المؤقت إن لم تحدد المرسل
//    مدة صريحة أطول (منطق الخادم في server.js). المدة نفسها ميتاداتا يراها
//    الخادم — لا محتوى E2EE يمرّ هنا إطلاقاً.
//
// 2) طلبات الرسائل (نمط WhatsApp/Signal «Message Requests»): DM يبدؤها شخص
//    غريب (بمستخدمين مختلفين) تصل الطرف الثاني كـ«طلب» (dm_accepted=0):
//    - POST /api/conversations/:id/accept — يقبل فتصبح المحادثة نشطة وتُبث
//      conv:accepted. مُكرِر (idempotent): القبول على مقبولة يعيد ok.
//    - POST /api/conversations/:id/decline — يرفض فيُمحى DM كاملاً (أعضاؤه
//      ومفاتيحه ورسائله بـ CASCADE — بلا أثر).
//    - الرد على طلبٍ يقبله تلقائياً (منطق الخادم في server.js) — نمط WhatsApp.
//    المجموعات والقنوات والقديمة dm_accepted=1 — لا يتغير سلوكها أبداً.

const express = require("express");
const { db } = require("./db");

// المدد البيضاء المسموحة بالثواني (نمط Signal: off/1h/1d/1w/4w) — السقف سنة
const TTL_CHOICES = [0, 3600, 86400, 604800, 2592000];
const MAX_TTL_SECONDS = 31536000;

function createRouter({ authRequired, io }) {
  const router = express.Router();

  // ===== مؤقت المتلاشية للمحادثة (Signal-style default timer) =====
  router.patch("/conversations/:id/ttl", authRequired, (req, res) => {
    const convId = Number(req.params.id);
    if (!Number.isInteger(convId)) return res.status(400).json({ error: "bad conversation id" });
    const member = db
      .prepare("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?")
      .get(convId, req.user.id);
    if (!member) return res.status(403).json({ error: "forbidden" });
    const conv = db.prepare("SELECT id FROM conversations WHERE id = ?").get(convId);
    if (!conv) return res.status(404).json({ error: "conversation not found" });

    // تحقق صارم: عدد صحيح 0..سنة — وإن لم يكن ضمن المدد البيضاء الشائعة فهو
    // مقبول ضمن السقف (مرونة واجهة برمجية) لكن لا مرور لأي شيء آخر
    // (نفس فلسفة التحقق الصارم في تفاعلات P4 واستطلاعات P5).
    const raw = (req.body || {}).ttl_seconds;
    if (!Number.isInteger(raw) || raw < 0 || raw > MAX_TTL_SECONDS) {
      return res.status(400).json({ error: "bad ttl", choices: TTL_CHOICES });
    }
    db.prepare("UPDATE conversations SET ttl_seconds = ? WHERE id = ?").run(raw, convId);
    io.to("conv:" + convId).emit("conv:ttl", { conversationId: convId, ttlSeconds: raw, by: req.user.id });
    res.json({ ok: true, ttl_seconds: raw });
  });

  // ===== قبول طلب الرسالة (message request — نمط WhatsApp/Signal) =====
  router.post("/conversations/:id/accept", authRequired, (req, res) => {
    const convId = Number(req.params.id);
    if (!Number.isInteger(convId)) return res.status(400).json({ error: "bad conversation id" });
    const member = db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(convId, req.user.id);
    if (!member) return res.status(403).json({ error: "forbidden" });
    const conv = db.prepare("SELECT id, type, dm_accepted FROM conversations WHERE id = ?").get(convId);
    if (!conv) return res.status(404).json({ error: "conversation not found" });
    if (conv.type !== "dm") return res.status(400).json({ error: "not a dm" }); // المجموعات بلا طلبات
    if (conv.dm_accepted) return res.json({ ok: true, already: true }); // مُكرِر
    db.prepare("UPDATE conversations SET dm_accepted = 1 WHERE id = ?").run(convId);
    io.to("conv:" + convId).emit("conv:accepted", { conversationId: convId, by: req.user.id });
    res.json({ ok: true });
  });

  // ===== رفض طلب الرسالة: يمحو الـ DM كاملاً (CASCADE: أعضاء/مفاتيح/رسائل) =====
  router.post("/conversations/:id/decline", authRequired, (req, res) => {
    const convId = Number(req.params.id);
    if (!Number.isInteger(convId)) return res.status(400).json({ error: "bad conversation id" });
    const member = db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(convId, req.user.id);
    if (!member) return res.status(403).json({ error: "forbidden" });
    const conv = db.prepare("SELECT id, type FROM conversations WHERE id = ?").get(convId);
    if (!conv) return res.status(404).json({ error: "conversation not found" });
    if (conv.type !== "dm") return res.status(400).json({ error: "not a dm" });
    db.prepare("DELETE FROM conversations WHERE id = ?").run(convId);
    io.to("conv:" + convId).emit("conv:declined", { conversationId: convId, by: req.user.id });
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createRouter, TTL_CHOICES, MAX_TTL_SECONDS };
