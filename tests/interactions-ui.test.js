// interactions-ui.test.js — عقد واجهة العميل لميزات P4 (بحث الميزات):
// 1) تفاعلات الإيموجي — شريط ثمانية إيموجي مطابق لقائمة الخادم البيضاء، ولاصقات
//    حية تتحدث عبر message:reaction بلا إعادة جلب.
// 2) الردود — شريط معاينة فوق حقل الكتابة + مرجع معرّف فقط في الحمولة (E2EE) +
//    اقتباس قابل للنقر يقفز للأصل.
// 3) البحث المحلي — يبحث في النصوص المفكوكة على الجهاز فقط (الخادم لا يبحث شيئاً).
// 4) المحفوظات + الأرشيف — مخازن localStorage محلية (E2EE آمنة) بقائمة وقفز.
// 5) مشاركة الموقع — إحداثيات مشفّرة E2EE ورقاقة OSM بلا بلاطات خارجية.
// 6) الحظر الشخصي — أزرار في نافذة الأعضاء + بوابات الخادم الثلاث.
// عقد على المصدر (كما في walkie.test.js / calls.test.js) — الضمانة أن الأسلاك
// كلها موجودة ومتصلة بالنقاط الصحيحة في الخادم.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const app = () => read('web/app.js');
const html = () => read('web/index.html');
const css = () => read('web/style.css');
const i18n = () => read('web/i18n.js');

describe('تفاعلات الإيموجي — عقد الواجهة', () => {
  it('شريط التفاعلات داخل قائمة الرسالة بلصقات حية تحت الفقاعة', () => {
    const a = app();
    expect(a).toMatch(/msg-reactions/);
    expect(a).toMatch(/for \(const emoji of REACTIONS\)/);
    expect(a).toMatch(/function renderReactionChips\(/);
    expect(a).toMatch(/data-reactions-for/);
    // الزر يستدعي نقطة الخادم PUT /api/messages/:id/reaction
    expect(a).toMatch(/\/api\/messages\/\$\{m\.id\}\/reaction/);
  });

  it('قائمة الإيموجي مطابقة لحرفياً لقائمة الخادم البيضاء (8 إيموجي)', () => {
    const a = app();
    const server = read('server/interactions.js');
    const clientList = /const REACTIONS = \[(.+)\];/.exec(a)?.[1];
    const serverList = /const ALLOWED_REACTIONS = \[(.+)\];/.exec(server)?.[1];
    expect(clientList).toBeTruthy();
    expect(clientList).toBe(serverList);
    expect(clientList.split(',')).toHaveLength(8);
  });

  it('تحديث حي عبر message:reaction — بلا إعادة جلب الصفحة', () => {
    const a = app();
    expect(a).toMatch(/state\.socket\.on\("message:reaction"/);
    expect(a).toMatch(/function applyReactionUpdate\(/);
    expect(a).toMatch(/old\.replaceWith\(renderReactionChips\(messageId\)\)/);
  });
});

describe('الردود — عقد الواجهة', () => {
  it('شريط الرد بعناصره ومعاينة مقتبسة وزر إلغاء', () => {
    const h = html();
    for (const id of ['reply-bar', 'reply-preview', 'reply-cancel']) expect(h).toContain(`id="${id}"`);
    const a = app();
    expect(a).toMatch(/function updateReplyBar\(\)/);
    expect(a).toMatch(/reply-cancel"\)\?\.addEventListener\("click"/);
    expect(a).toMatch(/state\.replyTo = \{ id: m\.id, text: m\.text \|\| "", senderName: m\.senderName \|\| "" \}/);
  });

  it('المرسل يضع مرجع المعرف فقط في الحمولة (النص المقتبس داخل ciphertext) ويُمسح بعد الإرسال', () => {
    const a = app();
    expect(a).toMatch(/replyTo: state\.replyTo\?\.id \?\? null/);
    expect(a).toMatch(/state\.replyTo = null;\s*\n\s*updateReplyBar\(\);/);
  });

  it('الاقتباس في الفقاعة يقفز للأصل بالنقر وبلوحة المفاتيح', () => {
    const a = app();
    expect(a).toMatch(/reply-quote/);
    expect(a).toMatch(/scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
    expect(a).toMatch(/quote\.addEventListener\("keydown"/);
  });

  it('الخادم يتحقق من هدف الرد (نفس المحادثة + غير محذوفة) ويرفض reply_invalid', () => {
    const src = read('server/server.js');
    expect(src).toMatch(/reason: "reply_invalid"/);
    const a = app();
    expect(a).toMatch(/reason === "reply_invalid"/);
  });
});

describe('البحث المحلي — عقد الواجهة (E2EE: يبحث على الجهاز فقط)', () => {
  it('شريط بحث بعدّاد نتائج وفilter يخفي غير المطابق', () => {
    const h = html();
    for (const id of ['search-input', 'search-count', 'search-bar']) expect(h).toContain(`id="${id}"`);
    const a = app();
    expect(a).toMatch(/search-input"\)\?\.addEventListener\("input"/);
    expect(a).toMatch(/search-hidden/);
    expect(a).toMatch(/function applySearchFilter\(/);
    expect(css()).toMatch(/\.msg\.search-hidden\{display:none\}/);
  });

  it('البحث يستخدم ذاكرة النصوص المفكوكة المحلية (_msgCache) لا الخادم', () => {
    const a = app();
    expect(a).toMatch(/_msgCache/);
    // لا نداء شبكة في مسار البحث — لا fetch ولا api() داخل معالج البحث
    const handler = /search-input"\)\?\.addEventListener\("input"[\s\S]*?\}\);/.exec(app())?.[0] || '';
    expect(handler).not.toMatch(/api\(|fetch\(/);
  });
});

describe('المحفوظات والأرشيف — عقد الواجهة (مخازن محلية)', () => {
  it('زر المحفوظات + نافذة + تخزين localStorage بصوت rasan_starred', () => {
    const h = html();
    for (const id of ['starred-btn', 'starred-modal', 'starred-list', 'close-starred']) expect(h).toContain(`id="${id}"`);
    const a = app();
    expect(a).toMatch(/localStorage\.setItem\("rasan_starred"/);
    expect(a).toMatch(/function renderStarred\(\)/);
    expect(a).toMatch(/function toggleStar\(/);
  });

  it('الأرشيف: مبدّل في قائمة المحادثات + قائمة سياق أرشفة/إلغاء + rasan_archived', () => {
    const a = app();
    expect(a).toMatch(/localStorage\.setItem\("rasan_archived"/);
    expect(a).toMatch(/function toggleArchive\(/);
    expect(a).toMatch(/function showConvMenu\(/);
    expect(a).toMatch(/archive-toggle/);
    expect(a).toMatch(/state\.showArchived/);
  });

  it('حذف الرسالة ينظّف المحفوظات والذاكرة والرد المعلّق', () => {
    const src = app();
    const h = /state\.socket\.on\("message:deleted"[\s\S]*?\}\);/.exec(src)?.[0] || '';
    expect(h).toMatch(/_msgCache\.delete\(id\)/);
    expect(h).toMatch(/_reactions\.delete\(id\)/);
    expect(h).toMatch(/state\.starred\.findIndex/);
    expect(h).toMatch(/state\.replyTo\?\.id === id/);
  });
});

describe('مشاركة الموقع — عقد الواجهة (نمط Meshtastic GPS)', () => {
  it('زر 📍 في المحرر يرسل إحداثيات مشفّرة E2EE بنوع location', () => {
    const h = html();
    expect(h).toContain('id="loc-btn"');
    const a = app();
    expect(a).toMatch(/loc-btn"\)\?\.addEventListener\("click"/);
    expect(a).toMatch(/navigator\.geolocation\.getCurrentPosition/);
    expect(a).toMatch(/JSON\.stringify\(loc\)/);
    expect(a).toMatch(/type: "location"/);
  });

  it('العرض رقاقة OSM بلا بلاطات خارجية (rel=noopener) وأخطاء الصلاحيات مترجمة', () => {
    const a = app();
    expect(a).toMatch(/openstreetmap\.org\/\?mlat=/);
    expect(a).toMatch(/rel = "noopener noreferrer"/);
    expect(a).toMatch(/locDenied/);
    expect(i18n()).toMatch(/locDenied:/);
    expect(css()).toMatch(/\.location-chip/);
  });
});

describe('الحظر الشخصي — عقد الواجهة والخادم', () => {
  it('أزرار حظر/رفع حظر في نافذة الأعضاء + تحميل قائمة حظري عند الدخول', () => {
    const a = app();
    expect(a).toMatch(/\/api\/users\/\$\{m\.id\}\/block/);
    expect(a).toMatch(/async function loadBlocks\(\)/);
    expect(a).toMatch(/loadBlocks\(\);/);
    expect(a).toMatch(/state\._blocked/);
  });

  it('نقاط الحظر الثلاث خلف authRequired في الخادم', () => {
    const s = read('server/interactions.js');
    expect(s).toMatch(/router\.post\("\/users\/:id\/block", authRequired/);
    expect(s).toMatch(/router\.delete\("\/users\/:id\/block", authRequired/);
    expect(s).toMatch(/router\.get\("\/users\/blocks", authRequired/);
    expect(s).toMatch(/cannot block self/);
  });

  it('إضافة الأعضاء تعرض رسائل الحظر الواضحة (blocked_by_user / you_blocked_user)', () => {
    const a = app();
    expect(a).toMatch(/msg\.includes\("blocked_by_user"\)/);
    expect(a).toMatch(/msg\.includes\("you_blocked_user"\)/);
    expect(a).toMatch(/reason === "blocked"/);
  });
});

describe('لغة ووصولية P4', () => {
  it('كل المفاتيح الجديدة موجودة في العربية والإنجليزية معاً', () => {
    const i = i18n();
    for (const k of ['react', 'reply', 'replyTo', 'star', 'unstar', 'starredTitle', 'noStarred', 'archivedChats', 'archiveChat', 'unarchiveChat', 'searchPh', 'locationMsg', 'locDenied', 'blockUser', 'unblockUser', 'blockConfirm', 'blockedToast', 'blockedByUser', 'youBlockedUser', 'quoteUnavailable', 'replyInvalidToast', 'jumpToMsg']) {
      expect((i.match(new RegExp(k + ':', 'g')) || []).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('الوصولية: aria-label على أزرار P4 وأدوار مناسبة', () => {
    const h = html();
    expect(h).toMatch(/id="loc-btn"[^>]*aria-label=/);
    expect(h).toMatch(/id="starred-btn"[^>]*aria-label=/);
    expect(h).toMatch(/id="reply-cancel"[^>]*aria-label=/);
    const a = app();
    expect(a).toMatch(/rb\.setAttribute\("aria-label"/);
    expect(a).toMatch(/chip\.setAttribute\("aria-label"/);
  });
});

describe('إصلاح TDZ المرفق بميزات P4', () => {
  it('لا يبقى مؤقت لمس يظلل دالة الترجمة t() في نطاق appendMessage (كان يرمي ReferenceError)', () => {
    const a = app();
    expect(a).toMatch(/let touchTimer = null;/);
    expect(a).not.toMatch(/let t = null;/);
  });

  it('قائمة الرسائل متاحة على كل رسالة غير ملف (الرد والتفاعل والحفظ للجميع)', () => {
    const a = app();
    expect(a).toMatch(/\/\/ قائمة الرسائل متاحة على كل رسالة[\s\S]*?if \(m\.type !== "file"\) \{/);
  });
});
