// ephemeral.js — P6: مسح الرسائل المتلاشية (إصلاح أمني من مراجعة الكود)
//
// 🐞 الخلل المكتشف في المراجعة الدقيقة: الرسائل المتلاشية (ephemeral_ttl > 0)
// تُحذف عبر setTimeout داخل معالج socket الرسائل — والمؤقتات **تموت بإعادة
// تشغيل الخادم**، فتعود الرسالة من قاعدة البيانات وتعيش للأبد رغم وعد
// المتلاشية (خرق وعد الخصوصية — نمط Signal/WhatsApp: المؤقت ملك الخادم
// لا الذاكرة).
//
// الإصلاح: مسح دوري (كل 60 ثانية كنظّاف stories القائم) + مسح عند الإقلاع —
// يبحث عن الرسائل التي تجاوزت وقتها (time + ttl*1000 < الآن) فتُمحى فيقوم
// زناد db.js بتنظيف التفاعلات وأصوات الاستطلاعات تلقائياً، ويُبث message:deleted
// للغرفة فيزيلها العملاء حياً، ومرفق الرسالة إن وجد يمسح بملفه من القرص
// (لا ملفات يتيمة — نفس عقد الحذف الإشرافي في moderation.js).
//
// بلا حالة ولا مؤقتات لكل رسالة: استعلام واحد يجد كل المتجاوز — حتى الرسائل
// المتلاشية التي وصلت أثناء التوقف تُمسح لحظة الإقلاع أو أول دورة.

const path = require("path");
const fs = require("fs");
const { db, UPLOAD_DIR } = require("./db");

function sweepEphemeral({ io } = {}) {
  const now = Date.now();
  const expired = db
    .prepare(`SELECT id, conversation_id, attachment_id FROM messages
              WHERE ephemeral_ttl > 0 AND deleted = 0 AND time + ephemeral_ttl * 1000 < ?`)
    .all(now);
  for (const row of expired) {
    // DELETE الصريح يقوم زناد trg_msg_reactions_on_delete بتنظيف التفاعلات
    // وأصوات الاستطلاعات (عقد db.js القائم — بلا تعديل فيه).
    db.prepare("DELETE FROM messages WHERE id = ?").run(row.id);
    if (row.attachment_id) {
      const p = path.join(UPLOAD_DIR, row.attachment_id + ".bin");
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* القرص يعيد المحاولة دورياً */ }
      db.prepare("DELETE FROM attachments WHERE id = ?").run(row.attachment_id);
    }
    if (io) io.to("conv:" + row.conversation_id).emit("message:deleted", { id: row.id });
  }
  return expired.length;
}

module.exports = { sweepEphemeral };
