// walkie.test.js — عقد واجهة العميل للميزات الجديدة (بحث الميزات):
// 1) وضع للّكة PTT (نمط Zello/WhatsApp Walkie-Talkie) — ضغط مستمر = تسجيل،
//    إفلات = إرسال مشفّر، سحب خارج = إلغاء، وأمان "أُفلت قبل جهوزية المايك".
// 2) المكالمات الجماعية (WebRTC mesh) — قاعدة بلا-تضارب: المنضم الأحدث يعرض،
//    وقائمة المشاركين حية، والانقطاع/الامتلاء/التجاهل مغطاة.
// 3) واجهات الإشراف (درس FireChat) — قائمة أعضاء + حظر/ترقية + لاصقة التثبيت
//    + حذف إشرافي + قناة للقراءة فقط.
// عقد على المصدر (كما في calls.test.js / ui-identity.test.js) لأن مسارات
// getUserMedia/WebRTC لا تعمل في jsdom — الضمانة أن الأسلاك كلها موجودة
// ومتصلة بالنقاط الصحيحة في الخادم.

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

describe('وضع للّكة (PTT) — عقد الواجهة', () => {
  it('عناصر الواجهة كلها موجودة في الصفحة (زر + شريط + تلميح)', () => {
    const h = html();
    for (const id of ['ptt-toggle', 'ptt-bar', 'ptt-btn', 'ptt-label', 'ptt-hint']) {
      expect(h).toContain(`id="${id}"`);
    }
  });

  it('ضغط مستمر: pointerdown يبدأ، pointerup يرسل، وkeyboard مُتاح بلا auto-repeat', () => {
    const a = app();
    expect(a).toMatch(/ptt-btn"\)\.addEventListener\("pointerdown"/);
    expect(a).toMatch(/ptt-btn"\)\.addEventListener\("pointerup"/);
    expect(a).toMatch(/e\.preventDefault\(\); pttStart\(\);/);
    // إتاحة لوحة المفاتيح: keydown/keyup مع حارس !e.repeat
    expect(a).toMatch(/if \(\(e\.key === " " \|\| e\.key === "Enter"\) && !e\.repeat\)/);
    expect(a).toMatch(/ptt-btn"\)\.addEventListener\("keyup"/);
  });

  it('سحب خارج الزر = إلغاء (pointerleave/pointercancel) وبلا قائمة سياق للضغط الطويل', () => {
    const a = app();
    expect(a).toMatch(/ptt-btn"\)\.addEventListener\("pointerleave", pttCancel\)/);
    expect(a).toMatch(/ptt-btn"\)\.addEventListener\("pointercancel", pttCancel\)/);
    expect(a).toMatch(/ptt-btn"\)\.addEventListener\("contextmenu", \(e\) => e\.preventDefault\(\)\)/);
  });

  it('حد أدنى 800ms يمنع اللمسات العابرة من إرسال مذكرات فارغة', () => {
    const a = app();
    expect(a).toMatch(/const PTT_MIN_MS = 800;/);
    expect(a).toMatch(/send && heldMs >= PTT_MIN_MS/);
  });

  it('أمان التسجيل اليتيم: الإفلات قبل جهوزية المايك يُلغِ فوراً', () => {
    // داخل startRecording: مرور ptt + فحص pttState.holding
    const a = app();
    expect(a).toMatch(/async function startRecording\(opts = \{\}\)/);
    expect(a).toMatch(/opts\?\.ptt === true && !pttState\.holding/);
    expect(a).toMatch(/async function pttStart\(\)/);
    expect(a).toMatch(/const ok = await startRecording\(\{ ptt: true \}\);/);
  });

  it('الوضع يُحفظ في localStorage ويعاد تطبيقه عند الإقلاع', () => {
    const a = app();
    expect(a).toMatch(/rasan_ptt_mode/);
    expect(a).toMatch(/applyPttMode\(\); \/\/ استعادة وضع للّكة المحفوظ/);
    expect(a).toMatch(/send-form"\)\.classList\.toggle\("hidden", pttState\.mode\)/);
    expect(a).toMatch(/ptt-bar"\)\.classList\.toggle\("hidden", !pttState\.mode\)/);
  });

  it('الإفلات أثناء وضع PTT يرسل عبر مسار المذكرات الصوتية المشفّر نفسه (E2EE)', () => {
    const a = app();
    expect(a).toMatch(/if \(send && heldMs >= PTT_MIN_MS\) sendVoiceNote\(\);/);
  });

  it('مفاتيح الترجمة موجودة بالعربية والإنجليزية', () => {
    const i = i18n();
    for (const key of ['pttOn', 'pttOff', 'pttTooShort']) {
      expect(i).toMatch(new RegExp(`${key}:`));
    }
  });
});

describe('المكالمات الجماعية — عقد واجهة العميل (mesh)', () => {
  it('زر المكالمة الجماعية موجود ويظهر للمجموعات/القنوات فقط', () => {
    expect(html()).toContain('id="group-call-btn"');
    expect(app()).toMatch(/group-call-btn"\)\.classList\.toggle\("hidden", !\(\(conv\.type === "group" \|\| conv\.type === "channel"\) && gcallSupported\(\)\)\)/);
  });

  it('الانضمام يعرض على كل القائمين — قاعدة المنضم الأحدث (بلا تضارب glare-free)', () => {
    const a = app();
    expect(a).toMatch(/socket\.on\("groupcall:joined"/);
    expect(a).toMatch(/for \(const peer of peers\) \{/);
    expect(a).toMatch(/await offerToPeer\(peer\);/);
  });

  it('الإشارات الثلاث موصولة: عرض/إجابة/ICE — والعرض الوارد بلا مكالمة يُتجاهل', () => {
    const a = app();
    expect(a).toMatch(/socket\.on\("gcall:offer"/);
    expect(a).toMatch(/socket\.on\("gcall:answer"/);
    expect(a).toMatch(/socket\.on\("gcall:ice"/);
    expect(a).toMatch(/if \(!gcall \|\| gcall\.convId !== conversationId\) return; \/\/ لا مكالمة — تجاهل/);
  });

  it('حالة الغرفة: تحديث القائمة، انتهاء العضوية يفك كل شيء، والتجاهل لا يعرض ثانية', () => {
    const a = app();
    expect(a).toMatch(/socket\.on\("groupcall:state"/);
    expect(a).toMatch(/if \(!participants\.some\(\(p\) => p\.userId === state\.user\.id\)\)/);
    expect(a).toMatch(/gcallIgnored\.startedAt === startedAt/);
  });

  it('الامتلاء والانقطاع: groupcall:full يفك، وpagehide يترك الغرفة، والانقطاع يفك بلا إشعار', () => {
    const a = app();
    expect(a).toMatch(/socket\.on\("groupcall:full"/);
    expect(a).toMatch(/groupcall:leave", \{ conversationId: gcall\.convId \}\)/);
    expect(a).toMatch(/teardownCall\(true\); teardownGroupCall\(false\);/);
  });

  it('عنصر صوت مستقل لكل مشارك + قائمة مشاركين في طبقة المكالمة', () => {
    const a = app();
    expect(html()).toContain('id="call-participants"');
    expect(a).toMatch(/data-gcall-audio/);
    expect(a).toMatch(/li\.textContent = p\.userId === state\.user\.id \? `\$\{p\.name\} \(\$\{t\("you"\)\}\)` : p\.name;/);
  });

  it('قائمة مشاركين وأنماط الطبقة موجودة في CSS', () => {
    const c = css();
    for (const cls of ['.pinned-banner', '.ptt-bar', '.ptt-btn', '.members-list', '.call-participants']) {
      expect(c).toContain(cls);
    }
  });

  it('مفاتيح الترجمة للجماعية موجودة بالعربية والإنجليزية', () => {
    const i = i18n();
    for (const key of ['groupCall', 'gcallJoining', 'gcallIncoming', 'gcallFull', 'gcallEnded', 'you']) {
      expect(i).toMatch(new RegExp(`${key}:`));
    }
  });
});

describe('أدوات الإشراف — عقد واجهة العميل (درس FireChat)', () => {
  it('عناصر النافذة واللاصقة موجودة في الصفحة', () => {
    const h = html();
    for (const id of ['members-btn', 'members-modal', 'members-list', 'bans-list', 'member-add-form', 'pinned-banner', 'pinned-jump', 'pinned-unpin']) {
      expect(h).toContain(`id="${id}"`);
    }
  });

  it('canModerate: مالك/مشرف فقط، ولا إشراف في الخاص', () => {
    const a = app();
    expect(a).toMatch(/function canModerate\(\) \{/);
    expect(a).toMatch(/return \["owner", "admin"\]\.includes\(conv\._myRole\);/);
    expect(a).toMatch(/if \(!conv \|\| conv\.type === "dm"\) return false;/);
  });

  it('دوري يُجلب عند فتح المجموعة/القناة (بأمان — الفشل لا يكسر الفتح)', () => {
    const a = app();
    expect(a).toMatch(/conv\._myRole = members\.find\(\(m\) => m\.id === state\.user\.id\)\?\.role \|\| "member";/);
  });

  it('القائمة الإشرافية تضرب نقاط الخادم الصحيحة: ترقية/إزالة/حظر/رفع حظر/إضافة', () => {
    const a = app();
    expect(a).toMatch(/\/members\/\$\{m\.id\}\/role`, \{ method: "PUT"/);
    expect(a).toMatch(/\/members\/\$\{m\.id\}`, \{ method: "DELETE" \}/);
    expect(a).toMatch(/\/bans`, \{ method: "POST", body: JSON\.stringify\(\{ username: m\.username \}\) \}/);
    expect(a).toMatch(/\/bans\/\$\{b\.userId\}`, \{ method: "DELETE" \}/);
    expect(a).toMatch(/\/members`, \{ method: "POST", body: JSON\.stringify\(\{ username \}\) \}/);
  });

  it('الحذف الإشرافي والتثبيت يضربان REST (حذف ناعم + pin) مع تأكيد كتابي', () => {
    const a = app();
    expect(a).toMatch(/\/messages\/\$\{m\.id\}`, \{ method: "DELETE" \}/);
    expect(a).toMatch(/\/pin`, \{ method: "PUT", body: JSON\.stringify\(\{ messageId: m\.id \}\) \}/);
    expect(a).toMatch(/\/pin`, \{ method: "DELETE" \}/);
  });

  it('لاصقة التثبيت تتحدث من فتح المحادثة ومن بث message:pinned/unpinned', () => {
    const a = app();
    expect(a).toMatch(/function updatePinnedBanner\(\)/);
    expect(a).toMatch(/socket\.on\("message:pinned"/);
    expect(a).toMatch(/socket\.on\("message:unpinned"/);
    expect(a).toMatch(/updatePinnedBanner\(\);\n  \$\("msg-input"\)\.focus\(\);/);
  });

  it('أحداث الأدوار/الحظر تحدّث النافذة الحية ودوري إن تغيّر', () => {
    const a = app();
    expect(a).toMatch(/socket\.on\("member:role"/);
    expect(a).toMatch(/socket\.on\("member:banned"/);
    expect(a).toMatch(/if \(userId === state\.user\.id\) state\.activeConv\._myRole = role;/);
  });

  it('القناة للقراءة فقط: الرفض بعقد channel_readonly يعرض رسالة واضحة', () => {
    const a = app();
    expect(a).toMatch(/reason === "channel_readonly"/);
    expect(a).toMatch(/showToast\(t\("channelReadonly"\), "error"\)/);
  });

  it('مفاتيح الترجمة للإشراف موجودة بالعربية والإنجليزية', () => {
    const i = i18n();
    for (const key of ['manageMembers', 'addMember', 'bannedList', 'roleOwner', 'roleAdmin', 'roleMember', 'promote', 'demote', 'kickMember', 'banMember', 'unbanMember', 'bannedErr', 'pinMsg', 'pinnedMsg', 'channelReadonly', 'modDeleteMsg']) {
      expect(i).toMatch(new RegExp(`${key}:`));
    }
  });
});
