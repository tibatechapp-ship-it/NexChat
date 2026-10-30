/**
 * panic — مسح الذعر + وضع الإضطرار (P2 #11 — نمط Briar).
 *
 * ميزتان منفصلتان يعملان معاً:
 *
 * 1. المسح المحلي (في العميل — web/panic.js): يمسح كل بيانات رسن على الجهاز
 *    (مفاتيح الهوية، الجلسات، الطابور، الإعدادات) فوراً وبلا شبكة — يعمل
 *    دائماً، حتى بلا اتصال بالخادم. هذا هو مسح Briar الذري.
 *
 * 2. المسح عن بُعد (هذه الوحدة): حذف الحساب وكل أثر له من الخادم — يُطلب
 *    فيه كلمة المرور الحقيقية (bcrypt) حتى لا يمحو توكن مسروق أو نقرة
 *    خاطئة حساباً كاملاً. بعد نجاحه يفشل كل توكن قائم للمستخدم فوراً
 *    (authRequired لم يجد صف المستخدم) وتُفصل مقابس Socket.IO الخاصة به.
 *
 * العزل: هذه الوحدة حذف فقط — لا تلمس أي مسار آخر، ولا ترى نصوصاً (E2EE:
 * النصوص المخزنة مشفرة ولا يمكن للخادم قراءتها أصلاً).
 */

const express = require("express");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const { db, UPLOAD_DIR } = require("./db");

/**
 * يبني راوتر المسح عن بُعد.
 * @param {{ authRequired: Function, io?: object }} deps
 */
function createRouter({ authRequired, io } = {}) {
  if (typeof authRequired !== "function") throw new Error("panic router requires authRequired");
  const router = express.Router();

  router.post("/account/wipe", authRequired, async (req, res) => {
    const { password } = req.body || {};
    if (typeof password !== "string" || !password.length || password.length > 72) {
      return res.status(400).json({ error: "password required" });
    }
    const row = db.prepare("SELECT id, password_hash FROM users WHERE id = ?").get(req.user.id);
    if (!row) return res.status(401).json({ error: "unauthorized" });
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return res.status(401).json({ error: "wrong password" });

    const uid = req.user.id;

    // المسح عملية ذرية: إما تمسح كل أثر المستخدم أو لا تمسح شيئاً —
    // نصف مسح أسوأ من لا مسح (المستخدم يثق أن بياناته اختفت).
    let wiped = {};
    try {
      db.exec("BEGIN");

      // مرفقات المستخدم: الملف من القرص ثم الصف — صفوف attachments تحمل
      // uploader_id NOT NULL، وحذف المستخدم دون حذفها يفجّر القيد.
      const atts = db.prepare("SELECT id FROM attachments WHERE uploader_id = ?").all(uid);
      for (const a of atts) {
        const p = path.join(UPLOAD_DIR, a.id + ".bin");
        if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch {} }
      }
      wiped.attachments = db.prepare("DELETE FROM attachments WHERE uploader_id = ?").run(uid).changes;

      // رسائل أرسلها المستخدم — المسح يزيل آثاره من الخادم أيضاً (النصوص
      // المشفرة نفسها). sender_id NOT NULL ON DELETE SET NULL لذلك تُحذف
      // صراحة قبل حذف الحساب وإلا فجّر القيد.
      wiped.messages = db.prepare("DELETE FROM messages WHERE sender_id = ?").run(uid).changes;

      // كل ما يتسكع بحذف المستخدم مباشرة (FK ON DELETE CASCADE يغطيها أيضاً —
      // نحذفها صراحة لأجل العدّات الصريحة في الرد):
      wiped.stories = db.prepare("DELETE FROM stories WHERE user_id = ?").run(uid).changes;
      wiped.key_backups = db.prepare("DELETE FROM key_backups WHERE user_id = ?").run(uid).changes;
      wiped.device_tokens = db.prepare("DELETE FROM device_tokens WHERE user_id = ?").run(uid).changes;
      try { wiped.prefs = db.prepare("DELETE FROM notification_prefs WHERE user_id = ?").run(uid).changes; } catch { wiped.prefs = 0; }
      wiped.group_keys = db.prepare("DELETE FROM group_keys WHERE user_id = ?").run(uid).changes;
      wiped.memberships = db.prepare("DELETE FROM conversation_members WHERE user_id = ?").run(uid).changes;
      wiped.user = db.prepare("DELETE FROM users WHERE id = ?").run(uid).changes;

      // محادثات بلا أعضاء بعد المسح (مثلاً DM بين المستخدم المحموم وطرف واحد):
      wiped.empty_conversations = db.prepare(
        "DELETE FROM conversations WHERE id NOT IN (SELECT DISTINCT conversation_id FROM conversation_members)"
      ).run().changes;

      db.exec("COMMIT");
    } catch (err) {
      try { db.exec("ROLLBACK"); } catch {}
      throw err;
    }

    // فصل مقابس المستخدم المسحوب — فشل فوري لكل جلساته الحية.
    if (io && typeof io.sockets?.sockets?.forEach === "function") {
      io.sockets.sockets.forEach((sock) => {
        if (sock.user && sock.user.id === uid) { try { sock.disconnect(true); } catch {} }
      });
    }

    res.json({ ok: true, wiped });
  });

  return router;
}

module.exports = { createRouter };
