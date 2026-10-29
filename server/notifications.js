// notifications.js — طبقة الإشعارات الآمنة (تفضيلات + قوالب + REST).
//
// ضمانة E2EE: نص الإشعار يُبنى حصراً من قوالب ثابتة معرّفة أدناه
// ("لديك رسالة جديدة" / "لديك دعوة إلى مجموعة"). أي حقول يمرّرها
// المستدعي (نص رسالة، ciphertext، أسماء، معاينات…) تُسقَط ولا تصل
// أبداً إلى FCM — لا في title/body ولا في data (مسموح به حصراً:
// kind + conversationId + messageId كأعداد صحيحة).
//
// نقاط الدخول:
// - getPrefs/setPrefs/canPush            تفضيلات لكل مستخدم (تشغيل/إيقاف)
// - buildNotificationPayload(kind, meta) قالب آمن واحد لكل الأنواع
// - notifyUser(userId, kind, meta)       يحترم التفضيلات ثم يرسل عبر push.js
// - createRouter({ authRequired })       REST: تفضيلات + endpoint إرسال
//
// ملاحظة تركيب: لا يتطلب express عند الاستيراد — يُحمَّل كسولاً داخل
// createRouter حتى تبقى نواة القوالب/التفضيلات قابلة للاختبار بمعزل.

const { db } = require("./db");

// ===== التفضيلات =====
db.exec(`CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  messages_enabled INTEGER NOT NULL DEFAULT 1,
  invites_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);`);

const getPrefsStmt = db.prepare(
  "SELECT messages_enabled, invites_enabled FROM notification_prefs WHERE user_id = ?"
);
const upsertPrefsStmt = db.prepare(
  `INSERT INTO notification_prefs (user_id, messages_enabled, invites_enabled, updated_at)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(user_id) DO UPDATE SET
     messages_enabled = excluded.messages_enabled,
     invites_enabled = excluded.invites_enabled,
     updated_at = excluded.updated_at`
);

function defaultPrefs() {
  return { messages: true, invites: true };
}

function getPrefs(userId) {
  const row = getPrefsStmt.get(userId);
  if (!row) return defaultPrefs();
  return { messages: !!row.messages_enabled, invites: !!row.invites_enabled };
}

function setPrefs(userId, { messages, invites } = {}) {
  const cur = getPrefs(userId);
  const next = {
    messages: typeof messages === "boolean" ? messages : cur.messages,
    invites: typeof invites === "boolean" ? invites : cur.invites,
  };
  upsertPrefsStmt.run(
    userId,
    next.messages ? 1 : 0,
    next.invites ? 1 : 0,
    Date.now()
  );
  return next;
}

// ===== بوابة التفضيلات قبل أي إرسال =====
function canPush(userId, kind) {
  const prefs = getPrefs(userId);
  if (kind === "new_message") return prefs.messages;
  if (kind === "group_invite") return prefs.invites;
  return false;
}

// ===== قوالب آمنة (المصدر الوحيد لنصوص الإشعارات) =====
const TEMPLATES = {
  new_message: { title: "رسن", body: "لديك رسالة جديدة" },
  group_invite: { title: "رسن", body: "لديك دعوة إلى مجموعة" },
};

const ALLOWED_DATA_KEYS = ["conversationId", "messageId"];

function toInt(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function buildNotificationPayload(kind, meta = {}) {
  const tpl = TEMPLATES[kind];
  if (!tpl) throw new Error(`unknown notification kind: ${kind}`);
  const data = { kind };
  for (const key of ALLOWED_DATA_KEYS) {
    const id = toInt(meta[key]);
    if (id !== null && id > 0) data[key] = String(id);
  }
  return { title: tpl.title, body: tpl.body, data };
}

// ===== المرسل (تحميل كسول لـ push.js + حقن للاختبارات) =====
let senderOverride = null;
function setPushSender(fn) {
  senderOverride = fn;
}
function getSender() {
  if (senderOverride) return senderOverride;
  return require("./push").sendToUser;
}

async function notifyUser(userId, kind, meta = {}) {
  if (!canPush(userId, kind)) return false;
  await getSender()(userId, buildNotificationPayload(kind, meta));
  return true;
}

// ===== REST: تفضيلات + إرسال =====
// يستدعيه server.js هكذا: app.use("/api", notifications.createRouter({ authRequired }));
function createRouter({ authRequired }) {
  const express = require("express"); // تحميل كسول
  const router = express.Router();

  router.get("/push/preferences", authRequired, (req, res) => {
    res.json({ preferences: getPrefs(req.user.id) });
  });

  router.put("/push/preferences", authRequired, (req, res) => {
    const { messages, invites } = req.body || {};
    if (messages !== undefined && typeof messages !== "boolean") {
      return res.status(400).json({ error: "messages must be boolean" });
    }
    if (invites !== undefined && typeof invites !== "boolean") {
      return res.status(400).json({ error: "invites must be boolean" });
    }
    const preferences = setPrefs(req.user.id, { messages, invites });
    res.json({ ok: true, preferences });
  });

  // إرسال إشعار. لاحظ: لا يُقبل أي حقل نصّي من الطلب (لا title ولا body)
  // — النص يأتي من القوالب فقط. ضمانة E2EE.
  router.post("/push/send", authRequired, async (req, res) => {
    const { toUserId, kind, conversationId, messageId } = req.body || {};
    const target = toInt(toUserId);
    if (target === null || target <= 0) {
      return res.status(400).json({ error: "toUserId required" });
    }
    if (!TEMPLATES[kind]) {
      return res
        .status(400)
        .json({ error: "kind must be one of: new_message, group_invite" });
    }
    const cid = toInt(conversationId);
    if (cid === null || cid <= 0) {
      return res.status(400).json({ error: "conversationId required" });
    }
    // الطالب عضو في المحادثة؟ (يمنع تحويل الـendpoint إلى بثّ عشوائي)
    const from = db
      .prepare(
        "SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?"
      )
      .get(cid, req.user.id);
    if (!from) return res.status(403).json({ error: "not a member" });
    // المستهدف عضو أيضاً؟ (الإشعارات تخص أعضاء المحادثة فقط)
    const to = db
      .prepare(
        "SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?"
      )
      .get(cid, target);
    if (!to) return res.status(403).json({ error: "target not a member" });

    const delivered = await notifyUser(target, kind, {
      conversationId: cid,
      messageId: toInt(messageId) || undefined,
    });
    res.json({ ok: true, delivered });
  });

  return router;
}

module.exports = {
  TEMPLATES,
  getPrefs,
  setPrefs,
  canPush,
  buildNotificationPayload,
  notifyUser,
  setPushSender,
  createRouter,
};
