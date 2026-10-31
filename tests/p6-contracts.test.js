// p6-contracts.test.js — عقود الأسلاك لدفعة P6 (نفس نمط interactions/polls):
// الخادم والعميل مربوطان بعقد صريحة يفشل الاختبار فوراً لو انفصل أي طرف.
//
// 1. server.js: تركيب privacy + المسح عند الإقلاع والكل 60 ثانية + TTL
//    الافتراضي من المحادثة + القبول التلقائي عند الرد + قمع الدفع للطلبات +
//    ترقيم الصفحات (before/limit بسقف) + أعمدة P6 في القائمة + DM الجديدة
//    معلقة dm_accepted=0.
// 2. auth.js: logout-all + فحص ver في authRequired + رفع النسخة عند تغيير المرور.
// 3. ephemeral.js: DELETE + بث message:deleted + مسح المرفق بملفه.
// 4. privacy.js: المدد البيضاء + السقف + مسارات ttl/accept/decline.
// 5. العميل: قسم الطلبات بأزرار قبول/رفض + قائمة TTL عبر PATCH + زر «الأقدم»
//    بbefore/limit + prepend بلا قفزة تمرير + مستمعات conv:ttl/accepted/declined.
// 6. i18n عربي/إنجليزي متكاملان (مفاتيح P6 كاملة) + رسالة «account locked».

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const serverSrc = read('server/server.js');
const appSrc = read('web/app.js');
const htmlSrc = read('web/index.html');
const i18nSrc = read('web/i18n.js');
const authSrc = read('server/auth.js');
const ephemeralSrc = read('server/ephemeral.js');
const privacySrc = read('server/privacy.js');
const styleSrc = read('web/style.css');

describe('عقد الخادم — تركيب P6 في server.js', () => {
  it('راوتر privacy مركب خلف authRequired + io', () => {
    expect(serverSrc).toMatch(/privacy\.createRouter\(\{\s*authRequired,\s*io\s*\}\)/);
  });

  it('المسح عند الإقلاع قبل استقبال أي اتصال + دوري كل 60 ثانية', () => {
    expect(serverSrc).toMatch(/ephemeral\.sweepEphemeral\(\{\s*io\s*\}\)/);
    const bootAt = serverSrc.indexOf('ephemeral.sweepEphemeral');
    const listenAt = serverSrc.indexOf('server.listen(');
    expect(bootAt).toBeGreaterThan(-1);
    expect(listenAt).toBeGreaterThan(bootAt); // الإقلاع قبل الاستماع
    // داخل setInterval التنظيفي القائم (نفس كتلة stories)
    const intervalBlock = serverSrc.slice(serverSrc.indexOf('setInterval('), serverSrc.indexOf('}, 60 * 1000)'));
    expect(intervalBlock).toContain('sweepEphemeral');
  });

  it('TTL الافتراضي: مدة المرسل الصريحة تتفوق وإلا يرث مؤقت المحادثة', () => {
    expect(serverSrc).toMatch(/SELECT type, current_key_version, ttl_seconds, dm_accepted, owner_id FROM conversations/);
    expect(serverSrc).toMatch(/senderTtl/);
    expect(serverSrc).toMatch(/effTtl\s*=\s*senderTtl\s*\|\|/);
    // الرسالة تُخزن وتُبث بالمدة الفعالة لا الخام
    expect(serverSrc).toMatch(/ephemeral_ttl: effTtl/);
    expect(serverSrc).toMatch(/if \(effTtl > 0\)/);
  });

  it('القبول التلقائي: الرد على طلب يقبله ويبث conv:accepted', () => {
    expect(serverSrc).toMatch(/const wasPending = conv\.type === "dm" && !conv\.dm_accepted/);
    expect(serverSrc).toMatch(/UPDATE conversations SET dm_accepted = 1 WHERE id = \?/);
    expect(serverSrc).toMatch(/emit\("conv:accepted"/);
  });

  it('قمع الدفع: لا إشعارات للطلب غير المقبول', () => {
    // قمع الدفع داخل حلقة الدفع قبل canPush
    const pushBlock = serverSrc.slice(serverSrc.indexOf('// Push for offline members'), serverSrc.indexOf('if (effTtl > 0)'));
    expect(pushBlock).toMatch(/if \(wasPending\) continue/);
  });

  it('ترقيم الصفحات: before مؤشر صحيح وlimit مقيد بسقف 100', () => {
    expect(serverSrc).toMatch(/Number\(req\.query\.limit\)/);
    expect(serverSrc).toMatch(/if \(limit > 100\) limit = 100/);
    expect(serverSrc).toMatch(/Number\(req\.query\.before\)/);
    expect(serverSrc).toMatch(/AND m\.id < \?/);
    expect(serverSrc).toMatch(/hasMore/);
    expect(serverSrc).toMatch(/oldestId/);
  });

  it('قائمة المحادثات ترجع ttl_seconds وdm_accepted — وDM الجديدة معلقة', () => {
    expect(serverSrc).toMatch(/c\.ttl_seconds, c\.dm_accepted/);
    expect(serverSrc).toMatch(/type === "dm" && \(members \|\| \[\]\)\.length > 0 \? 0 : 1/);
  });
});

describe('عقد المصادقة — إبطال الجلسات والقفل', () => {
  it('logout-all موجود ويرفع token_version', () => {
    expect(authSrc).toMatch(/router\.post\("\/logout-all", authRequired/);
    expect(authSrc).toMatch(/UPDATE users SET token_version = token_version \+ 1/);
  });

  it('تغيير كلمة المرور يرفع token_version — جلسات أخرى تموت', () => {
    expect(authSrc).toMatch(/password_hash = \?, token_version = token_version \+ 1/);
  });

  it('authRequired يرفض ver القديم — وsignToken يضع ver', () => {
    expect(authSrc).toMatch(/if \(\(p\.ver \?\? 0\) !== \(user\.token_version \?\? 0\)\) return res\.status\(401\)/);
    expect(authSrc).toMatch(/ver: user\.token_version \?\? 0|const ver = user\.token_version \?\? 0/);
    expect(authSrc).toMatch(/token_version FROM users WHERE id = \?/);
  });

  it('القفل: 5 فشل + نافذة قابلة للضبط + تصفير عند النجاح', () => {
    expect(authSrc).toMatch(/LOGIN_MAX_FAILS = 5/);
    expect(authSrc).toMatch(/LOGIN_LOCKOUT_MS/);
    expect(authSrc).toMatch(/recordLoginFail\(username\)/);
    expect(authSrc).toMatch(/recordLoginSuccess\(username\)/);
    expect(authSrc).toMatch(/"account locked"/);
  });
});

describe('عقد ephemeral.js — المتلاشية ملك الخادم لا الذاكرة', () => {
  it('استعلام تجاوز الوقت + DELETE + بث + مسح مرفق', () => {
    expect(ephemeralSrc).toMatch(/ephemeral_ttl > 0 AND deleted = 0 AND time \+ ephemeral_ttl \* 1000 < \?/);
    expect(ephemeralSrc).toMatch(/DELETE FROM messages WHERE id = \?/);
    expect(ephemeralSrc).toMatch(/emit\("message:deleted"/);
    expect(ephemeralSrc).toMatch(/unlinkSync/);
    expect(ephemeralSrc).toMatch(/DELETE FROM attachments WHERE id = \?/);
  });
});

describe('عقد privacy.js — التحقق الصارم والمسارات', () => {
  it('المدد البيضاء = إيقاف/ساعة/يوم/أسبوع/شهر والسقف سنة', () => {
    expect(privacySrc).toMatch(/TTL_CHOICES = \[0, 3600, 86400, 604800, 2592000\]/);
    expect(privacySrc).toMatch(/MAX_TTL_SECONDS = 31536000/);
  });

  it('تحقق صارم Number.isInteger قبل أي شيء آخر (عقد P4/P5 نفسه)', () => {
    expect(privacySrc).toMatch(/!Number\.isInteger\(raw\) \|\| raw < 0 \|\| raw > MAX_TTL_SECONDS/);
  });

  it('القيم الثلاث خلف authRequired + عضوية إلزامية', () => {
    const routes = privacySrc.match(/router\.(patch|post)\("[^"]+", authRequired/g) || [];
    expect(routes).toHaveLength(3);
    expect((privacySrc.match(/return res\.status\(403\)\.json\(\{ error: "forbidden" \}\)/g) || []).length).toBe(3);
  });
});

describe('عقد العميل — الطلبات والمؤقت والترقيم', () => {
  it('قسم طلبات المراسلة: عزل المعلقة عن القائمة + أزرار قبول/رفض تستدعي النقطتين', () => {
    expect(appSrc).toMatch(/function isPendingRequest\(c\)/);
    expect(appSrc).toMatch(/type === "dm" && c\.dm_accepted === 0 && c\.owner_id !== state\.user\?\.id/);
    expect(appSrc).toMatch(/requests-section/);
    expect(appSrc).toMatch(/\/api\/conversations\/\$\{c\.id\}\/accept/);
    expect(appSrc).toMatch(/\/api\/conversations\/\$\{c\.id\}\/decline/);
    expect(appSrc).toMatch(/filter\(\(c\) => !isPendingRequest\(c\)\)/); // لا تكرار بين القسمين
  });

  it('قائمة مؤقت المتلاشية: PATCH بالمدة + المدد الخمس مطابقة للخادم', () => {
    expect(appSrc).toMatch(/function showTtlMenu\(c, el\)/);
    expect(appSrc).toMatch(/\/api\/conversations\/\$\{c\.id\}\/ttl/);
    expect(appSrc).toMatch(/method: "PATCH"/);
    expect(appSrc).toMatch(/\[\["ttlOff", 0\], \["ttl1h", 3600\], \["ttl1d", 86400\], \["ttl1w", 604800\], \["ttl30d", 2592000\]\]/);
  });

  it('زر «الأقدم»: قبل oldestId وبسقف 50 — وprepend يحفظ موضع التمرير', () => {
    expect(appSrc).toMatch(/async function loadOlder\(\)/);
    expect(appSrc).toMatch(/before=\$\{state\._oldestId\}&limit=50/);
    expect(appSrc).toMatch(/insertBefore\(div, \$\("messages"\)\.firstChild\)/);
    expect(appSrc).toMatch(/box\.scrollTop = box\.scrollHeight - prevHeight/);
    expect(appSrc).toMatch(/function updateLoadOlder\(\)/);
  });

  it('index.html يحمل زر load-older مخفياً افتراضياً', () => {
    expect(htmlSrc).toMatch(/id="load-older"/);
    expect(htmlSrc).toMatch(/class="load-older hidden"/);
  });

  it('مستمعات socket الحية: conv:ttl وconv:accepted وconv:declined', () => {
    expect(appSrc).toMatch(/state\.socket\.on\("conv:ttl"/);
    expect(appSrc).toMatch(/state\.socket\.on\("conv:accepted"/);
    expect(appSrc).toMatch(/state\.socket\.on\("conv:declined"/);
    // رسالتي تصل بالمدة الفعالة من الخادم — فلا كتم محلي يكسر عرض ⏲
    expect(appSrc).toMatch(/ephemeral_ttl: 0/); // المرسل يترك الخادم يطبق المؤقت الافتراضي
  });

  it('الرجوع يخفي زر الأقدم — وstyle.css يغطي أقسام P6', () => {
    expect(appSrc).toMatch(/\$\("load-older"\)\?\.classList\.add\("hidden"\)/);
    expect(styleSrc).toMatch(/\.requests-section/);
    expect(styleSrc).toMatch(/\.req-accept/);
    expect(styleSrc).toMatch(/\.load-older/);
    expect(styleSrc).toMatch(/\.ttl-badge/);
  });
});

describe('عقد i18n — عربي/إنجليزي متكاملان', () => {
  const keys = ['ttlMenu', 'ttlOff', 'ttl1h', 'ttl1d', 'ttl1w', 'ttl30d', 'ttlToast', 'ttlClearedToast', 'convPending', 'requestsTitle', 'reqAccept', 'reqDecline', 'reqAcceptedToast', 'reqDeclinedToast', 'loadOlder', 'ttlBadge'];
  for (const lang of ['ar', 'en']) {
    it(`${lang}: كل مفاتيح P6 الـ ${keys.length} موجودة`, () => {
      const block = i18nSrc.slice(i18nSrc.indexOf(`${lang}: {`), i18nSrc.indexOf(`errors:{`, i18nSrc.indexOf(`${lang}: {`)));
      for (const k of keys) expect(block).toContain(`${k}:"`);
    });
  }

  it('رسالة «account locked» مترجمة في اللغتين', () => {
    expect(i18nSrc).toMatch(/"account locked":"الحساب مقفول/);
    expect(i18nSrc).toMatch(/"account locked":"Account temporarily locked/);
  });
});
