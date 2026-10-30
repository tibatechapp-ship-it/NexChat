/**
 * دوال مساعدة عامة
 */

/**
 * هروب نصوص HTML لمنع ثغرات XSS
 */
export function escapeHtml(value) {
  return String(value).replace(
    /[&<>'"]/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#039;",
        '"': "&quot;",
      })[char],
  );
}

/**
 * تنسيق الوقت
 */
export function formatTime(date = new Date()) {
  return date.toLocaleTimeString("ar", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * إنشاء معرف عقدة فريد
 */
export function generateNodeId() {
  return crypto.randomUUID().slice(0, 8);
}

/**
 * معرّف رسالة فريد — يُحمل مع الرسالة عبر كل مسارات النقل (Mesh/P2P/الخادم)
 * كي يزيل الاستقبال التكرار (النقل المزدوج نمط BitChat).
 */
export function newMessageId() {
  return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
