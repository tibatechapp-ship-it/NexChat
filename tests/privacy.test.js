// privacy.test.js — اختبارات P6 التشغيلية (راوترات حقيقية + io وهمي + DATA_DIR مؤقت)
//
// الضمانات:
// 1. إبطال الجلسات (نمط Signal/WhatsApp): توكن بعد تغيير كلمة المرور أو
//    logout-all يموت فوراً (token_version) — والحساب الجديد يعمل كما كان.
// 2. قفل الحساب: 5 فشل متتالي على نفس الاسم يقفله حتى بكلمة مرور صحيحة
//    (LOGIN_LOCKOUT_MS قصيرة للاختبار)، وبعد انتهاء القفل ينجح الدخول.
// 3. مؤقت المتلاشية للمحادثة (نمط Signal): PATCH بالمدد الصحيحة يخزن ويبث،
//    والقيم المرفوضة (سالب/عشري/نص/boolean/فوق السقف) ترد 400، وغير العضو 403.
// 4. طلبات الرسائل (نمط WhatsApp/Signal): القبول idempotent ويبث conv:accepted،
//    الرفض يمحو الـ DM كاملاً بـ CASCADE، والمجموعات ترفض accept/decline.
// 5. مسح المتلاشية (إصلاح إعادة التشغيل): الرسائل التي تجاوزت مؤقتها تُمحى
//    (ويقوم زناد db.js بتنظيف أصوات الاستطلاعات)، والمرفق يمسح بملفه،
//    والرسائل الحية تبقى.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let db;
let auth;
let privacy;
let ephemeral;
let dataDir;
let uploadDir;
let app;
let server;
let port;
let emitted = [];

const fakeAuth = (req, res, next) => {
  const m = /^Bearer u:(\d+)$/.exec(req.headers.authorization || '');
  const user = m && db.prepare('SELECT id, username FROM users WHERE id = ?').get(Number(m[1]));
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  req.user = user;
  next();
};
const fakeIo = { to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }) };
const bearer = (t) => ({ 'content-type': 'application/json', authorization: `Bearer ${t}` });
// مفتاح عام صالح: 65 بايت تبدأ بـ 0x04 (نقطة EC P-256 غير مضغوطة — نفس عقد validatePublicKey)
const PUB = Buffer.from(Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : 7))).toString('base64');
const call = (path, { method = 'GET', token, body } = {}) =>
  fetch(`http://localhost:${port}${path}`, { method, headers: token ? bearer(token) : { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'rasan-privacy-test-'));
  process.env.DATA_DIR = dataDir;
  process.env.JWT_SECRET = 'p6-test-secret';
  process.env.LOGIN_LOCKOUT_MS = '150'; // قفل قصير — يُختبر انتهاؤه فعلياً
  const dbMod = await import('../server/db.js');
  db = dbMod.db;
  uploadDir = dbMod.UPLOAD_DIR;
  auth = await import('../server/auth.js');
  privacy = await import('../server/privacy.js');
  ephemeral = await import('../server/ephemeral.js');

  const express = (await import('express')).default;
  app = express();
  app.use(express.json());
  app.use('/api/auth', auth.router); // راوتر حقيقي — bcrypt + JWT حقيقيان
  app.use('/api', privacy.createRouter({ authRequired: fakeAuth, io: fakeIo }));
  server = app.listen(0);
  port = server.address().port;

  const t = Date.now();
  // مستخدمون لاختبارات الخصوصية (1-3) — حسابات المصادقة تُنشأ عبر /register
  db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (1, ?, ?, ?)').run('alice', 'x', t);
  db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (2, ?, ?, ?)').run('bob', 'x', t);
  db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (3, ?, ?, ?)').run('carol', 'x', t);
});

afterAll(() => {
  server?.close();
  delete process.env.LOGIN_LOCKOUT_MS;
  rmSync(dataDir, { recursive: true, force: true });
});

// ================= إبطال الجلسات (token_version) =================
describe('إبطال الجلسات — نمط Signal/WhatsApp (P6)', () => {
  it('التسجيل يعمل و token_version يبدأ صفراً', async () => {
    const r = await call('/api/auth/register', { method: 'POST', body: { username: 'p6dana', password: 'secret1', publicKey: PUB } });
    expect(r.status).toBe(200);
    const { token, user } = await r.json();
    expect(user.token_version ?? 0).toBe(0);
    expect((await call('/api/auth/me', { token })).status).toBe(200);
  });

  it('تغيير كلمة المرور يقتل التوكن القديم فوراً — والجديد يعمل', async () => {
    const r = await call('/api/auth/login', { method: 'POST', body: { username: 'p6dana', password: 'secret1' } });
    const old = (await r.json()).token;
    // جهاز ثانٍ بنفس الحساب (نفس التوكن القديم منطقياً)
    const ch = await call('/api/auth/change-password', { method: 'POST', token: old, body: { oldPassword: 'secret1', newPassword: 'secret2' } });
    expect(ch.status).toBe(200);
    expect((await call('/api/auth/me', { token: old })).status).toBe(401); // الجلسة القديمة ماتت
    const re = await call('/api/auth/login', { method: 'POST', body: { username: 'p6dana', password: 'secret2' } });
    const fresh = (await re.json()).token;
    expect((await call('/api/auth/me', { token: fresh })).status).toBe(200);
  });

  it('logout-all يقتل كل التوكنات حتى توقيعها سليم', async () => {
    const reg = await call('/api/auth/register', { method: 'POST', body: { username: 'p6samy', password: 'secret1', publicKey: PUB } });
    const tok = (await reg.json()).token;
    expect((await call('/api/auth/me', { token: tok })).status).toBe(200);
    const lo = await call('/api/auth/logout-all', { method: 'POST', token: tok, body: {} });
    expect(lo.status).toBe(200);
    expect((await call('/api/auth/me', { token: tok })).status).toBe(401); // ميت رغم صحة التوقيع
  });

  it('توكن مُزوّر بـ ver قديم يُرفض حتى لو التوقيع صحيح', async () => {
    // jsonwebtoken يعيش في server/node_modules — نحلّه من هناك
    const { createRequire } = await import('node:module');
    const sRequire = createRequire(join(ROOT, 'server/'));
    const jwt = sRequire('jsonwebtoken');
    const forged = jwt.sign({ sub: 1, username: 'alice', ver: 0 }, 'p6-test-secret', { expiresIn: '1d' });
    // alice لم ترفع نسختها بعد → ver=0 يمر؛ نرفعها يدوياً ثم نعيد المحاولة
    const st0 = (await call('/api/auth/me', { token: forged })).status;
    db.prepare('UPDATE users SET token_version = 3 WHERE id = 1').run();
    const st1 = (await call('/api/auth/me', { token: forged })).status;
    db.prepare('UPDATE users SET token_version = 0 WHERE id = 1').run();
    expect(st0).toBe(200);
    expect(st1).toBe(401);
  });
});

// ================= قفل الحساب (5 فشل = قفل) =================
describe('قفل الحساب ضد التخمين (P6)', () => {
  it('5 محاولات فاشلة تقفل الحساب حتى بكلمة مرور صحيحة — ثم يُفتح بانتهاء المدة', async () => {
    const r = await call('/api/auth/register', { method: 'POST', body: { username: 'p6lock', password: 'rightpass', publicKey: PUB } });
    expect(r.status).toBe(200);
    for (let i = 0; i < 5; i++) {
      const bad = await call('/api/auth/login', { method: 'POST', body: { username: 'p6lock', password: `wrong${i}` } });
      expect(bad.status).toBe(401);
    }
    // المحاولة السادسة بكلمة المرور الصحيحة — مقفولة 429
    const locked = await call('/api/auth/login', { method: 'POST', body: { username: 'p6lock', password: 'rightpass' } });
    expect(locked.status).toBe(429);
    expect((await locked.json()).error).toBe('account locked');
    // حساب آخر غير متأثر (القفل لكل اسم لا لكل IP)
    const other = await call('/api/auth/login', { method: 'POST', body: { username: 'p6samy', password: 'secret1' } });
    expect(other.status).toBe(200);
    // بعد انتهاء مدة القفل القصيرة (150ms) — ينجح الدخول الصحيح
    await new Promise((res) => setTimeout(res, 250));
    const ok = await call('/api/auth/login', { method: 'POST', body: { username: 'p6lock', password: 'rightpass' } });
    expect(ok.status).toBe(200);
  });

  it('دخول ناجح يصفر العداد — محاولات فاشلة قبلها لا تقفل', async () => {
    await call('/api/auth/login', { method: 'POST', body: { username: 'p6samy', password: 'nope1' } });
    await call('/api/auth/login', { method: 'POST', body: { username: 'p6samy', password: 'nope2' } });
    await call('/api/auth/login', { method: 'POST', body: { username: 'p6samy', password: 'nope3' } });
    const ok = await call('/api/auth/login', { method: 'POST', body: { username: 'p6samy', password: 'secret1' } });
    expect(ok.status).toBe(200); // صفر العداد
    for (let i = 0; i < 2; i++) await call('/api/auth/login', { method: 'POST', body: { username: 'p6samy', password: `nope${i}` } });
    const still = await call('/api/auth/login', { method: 'POST', body: { username: 'p6samy', password: 'secret1' } });
    expect(still.status).toBe(200); // فشلان بعد التصفير — لم يبلغا العتبة
  });
});

// ================= مؤقت المتلاشية للمحادثة (نمط Signal) =================
describe('PATCH /conversations/:id/ttl — مؤقت المتلاشية (P6)', () => {
  const h = (uid) => ({ 'content-type': 'application/json', authorization: `Bearer u:${uid}` });
  const patch = (uid, cid, body) => fetch(`http://localhost:${port}/api/conversations/${cid}/ttl`, { method: 'PATCH', headers: h(uid), body: JSON.stringify(body) });

  beforeAll(() => {
    const t = Date.now();
    db.prepare("INSERT INTO conversations (id, type, owner_id, created_at) VALUES (40, 'dm', 1, ?)").run(t);
    db.prepare('INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (40, 1, ?)').run(t);
    db.prepare('INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (40, 2, ?)').run(t);
    db.prepare("INSERT INTO conversations (id, type, owner_id, created_at) VALUES (41, 'group', 1, ?)").run(t);
    db.prepare('INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (41, 1, ?)').run(t);
  });

  it('عضو يضع يوماً — يخزن ويبث conv:ttl للغرفة', async () => {
    emitted.length = 0;
    const r = await patch(1, 40, { ttl_seconds: 86400 });
    expect(r.status).toBe(200);
    expect((await r.json()).ttl_seconds).toBe(86400);
    expect(db.prepare('SELECT ttl_seconds AS s FROM conversations WHERE id = 40').get().s).toBe(86400);
    expect(emitted.at(-1)).toMatchObject({ room: 'conv:40', event: 'conv:ttl', payload: { conversationId: 40, ttlSeconds: 86400 } });
  });

  it.each([-1, 1.5, 'x', true, 36000000])('قيمة مرفوضة %p ترد 400 بلا تخزين', async (bad) => {
    const r = await patch(1, 40, { ttl_seconds: bad });
    expect(r.status).toBe(400);
  });

  it('غير العضو 403 — وحتى للمحادثة المجهولة (عدم تسريب الوجود: 403 لا 404)', async () => {
    expect((await patch(3, 40, { ttl_seconds: 3600 })).status).toBe(403);
    expect((await patch(1, 999, { ttl_seconds: 3600 })).status).toBe(403); // نفس الرد — لا تسريب
  });

  it('الإيقاف بـ 0 يعيد الوضع الافتراضي', async () => {
    const r = await patch(2, 40, { ttl_seconds: 0 });
    expect(r.status).toBe(200);
    expect(db.prepare('SELECT ttl_seconds AS s FROM conversations WHERE id = 40').get().s).toBe(0);
  });
});

// ================= طلبات الرسائل (نمط WhatsApp/Signal) =================
describe('accept / decline — طلبات الرسائل (P6)', () => {
  const h = (uid) => ({ 'content-type': 'application/json', authorization: `Bearer u:${uid}` });
  const post = (uid, cid, ep) => fetch(`http://localhost:${port}/api/conversations/${cid}/${ep}`, { method: 'POST', headers: h(uid), body: '{}' });

  let reqConv, grpConv;
  beforeAll(() => {
    const t = Date.now();
    // DM «طلب» معلق + مجموعة
    reqConv = db.prepare("INSERT INTO conversations (id, type, owner_id, created_at, dm_accepted) VALUES (50, 'dm', 2, ?, 0)").run(t).lastInsertRowid;
    db.prepare('INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (50, 1, ?)').run(t);
    db.prepare('INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (50, 2, ?)').run(t);
    grpConv = db.prepare("INSERT INTO conversations (id, type, owner_id, created_at) VALUES (51, 'group', 1, ?)").run(t).lastInsertRowid;
    db.prepare('INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (51, 1, ?)').run(t);
  });

  it('القبول يرفع dm_accepted ويبث conv:accepted — ومكرر بعده idempotent', async () => {
    emitted.length = 0;
    const r = await post(1, reqConv, 'accept');
    expect(r.status).toBe(200);
    expect((await r.json()).already).toBeUndefined();
    expect(db.prepare('SELECT dm_accepted AS a FROM conversations WHERE id = ?').get(reqConv).a).toBe(1);
    expect(emitted.at(-1)).toMatchObject({ room: `conv:${reqConv}`, event: 'conv:accepted' });
    const again = await post(1, reqConv, 'accept');
    expect(await again.json()).toEqual({ ok: true, already: true });
  });

  it('المجموعات ترفض accept/decline — ليست منطقة طلبات', async () => {
    expect((await post(1, grpConv, 'accept')).status).toBe(400);
    expect((await post(1, grpConv, 'decline')).status).toBe(400);
  });

  it('غير العضو 403', async () => {
    expect((await post(3, reqConv, 'accept')).status).toBe(403);
    expect((await post(3, reqConv, 'decline')).status).toBe(403);
  });

  it('الرفض يمحو الـ DM كاملاً بـ CASCADE (أعضاء + رسائل)', async () => {
    const t = Date.now();
    const cid = db.prepare("INSERT INTO conversations (id, type, owner_id, created_at, dm_accepted) VALUES (52, 'dm', 1, ?, 0)").run(t).lastInsertRowid;
    db.prepare('INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (52, 1, ?)').run(t);
    db.prepare('INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (52, 2, ?)').run(t);
    db.prepare("INSERT INTO messages (conversation_id, sender_id, type, ciphertext, iv, time) VALUES (52, 1, 'text', 'C', 'I', ?)").run(t);
    emitted.length = 0;
    const r = await post(2, cid, 'decline');
    expect(r.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM conversations WHERE id = ?').get(cid).n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM conversation_members WHERE conversation_id = ?').get(cid).n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?').get(cid).n).toBe(0);
    expect(emitted.at(-1)).toMatchObject({ room: `conv:${cid}`, event: 'conv:declined' });
  });
});

// ================= مسح المتلاشية — إصلاح إعادة التشغيل =================
describe('sweepEphemeral — المتلاشية لا تنجو من إعادة التشغيل (P6)', () => {
  it('الرسائل المتجاوزة تمحى وتُبث message:deleted — والحية تبقى', () => {
    const t = Date.now();
    const t2 = Date.now();
    db.prepare("INSERT INTO conversations (id, type, owner_id, created_at) VALUES (60, 'dm', 1, ?)").run(t2);
    db.prepare('INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (60, 1, ?)').run(t2);
    // متجاوزة: ttl=1s قبل 5 ثوانٍ
    db.prepare("INSERT INTO messages (id, conversation_id, sender_id, type, ciphertext, iv, ephemeral_ttl, time) VALUES (600, 60, 1, 'text', 'C', 'I', 1, ?)").run(Date.now() - 5000);
    // حية: ttl=3600 الآن
    db.prepare("INSERT INTO messages (id, conversation_id, sender_id, type, ciphertext, iv, ephemeral_ttl, time) VALUES (601, 60, 1, 'text', 'C', 'I', 3600, ?)").run(Date.now());
    // متجاوزة بلا ttl (عادية) — يجب ألا تمس
    db.prepare("INSERT INTO messages (id, conversation_id, sender_id, type, ciphertext, iv, time) VALUES (602, 60, 1, 'text', 'C', 'I', ?)").run(Date.now() - 5000);
    emitted.length = 0;
    const n = ephemeral.sweepEphemeral({ io: fakeIo });
    expect(n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM messages WHERE id = 600').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM messages WHERE id = 601').get().n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM messages WHERE id = 602').get().n).toBe(1);
    expect(emitted).toContainEqual({ room: 'conv:60', event: 'message:deleted', payload: { id: 600 } });
  });

  it('زناد db.js ينظف أصوات الاستطلاع مع المتلاشية (عقد P5 يعمل على المسح)', () => {
    const t = Date.now();
    db.prepare("INSERT INTO messages (id, conversation_id, sender_id, type, ciphertext, iv, ephemeral_ttl, time) VALUES (610, 60, 1, 'poll', 'C', 'I', 1, ?)").run(Date.now() - 5000);
    db.prepare('INSERT INTO poll_votes (message_id, user_id, option_index, created_at) VALUES (610, 1, 0, ?)').run(t);
    ephemeral.sweepEphemeral({ io: fakeIo });
    expect(db.prepare('SELECT COUNT(*) AS n FROM poll_votes WHERE message_id = 610').get().n).toBe(0);
  });

  it('مرفق الرسالة المتلاشية يمسح بملفه من القرص (لا ملفات يتيمة)', () => {
    const t = Date.now();
    const attId = 'p6sweepatt1';
    const filePath = join(uploadDir, attId + '.bin');
    writeFileSync(filePath, 'encrypted-bytes');
    db.prepare("INSERT INTO attachments (id, conversation_id, uploader_id, size_bytes, created_at) VALUES (?, 60, 1, 16, ?)").run(attId, t);
    db.prepare("INSERT INTO messages (id, conversation_id, sender_id, type, ciphertext, iv, ephemeral_ttl, time, attachment_id) VALUES (620, 60, 1, 'file', 'C', 'I', 1, ?, ?)").run(Date.now() - 5000, attId);
    expect(existsSync(filePath)).toBe(true);
    ephemeral.sweepEphemeral({ io: fakeIo });
    expect(existsSync(filePath)).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE id = ?').get(attId).n).toBe(0);
  });

  it('بدون io — المسح يعمل صامتاً (لا يرمي)', () => {
    expect(() => ephemeral.sweepEphemeral()).not.toThrow();
  });
});
