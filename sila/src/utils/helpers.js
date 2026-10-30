/**
 * دوال مساعدة عامة
 */

/**
 * هروب نصوص HTML لمنع ثغرات XSS
 */
export function escapeHtml(value) {
  return value.replace(
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
