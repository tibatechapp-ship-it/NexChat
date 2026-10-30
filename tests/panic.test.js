// panic.test.js — اختبارات مسح الذعر + وضع الإضطرار (P2 #11 — نمط Briar).
//
// الخادم (runtime حقيقي): POST /api/account/wipe خلف authRequired — يطلب
// كلمة المرور (bcrypt)، يمسح كل أثر المستخدم (الرسائل المرسلة، المرفقات
// بملفاتها، القصص، النسخ الاحتياطية، التوكنات، التفضيلات، العضويات)، ثم
// يفشل كل توكن للمستخدم (صفه حُذف) ولا يلمس بيانات الآخرين.
//
// العميل (منطق نقي): اشتقاق الرمز PBKDF2 + التحقق + قرار الإدخال
// (الإضطرار يفوز على القفل) + مسح localStorage المنسوب لرسن فقط.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let panicMod;
let db;
let dataDir;
let app;
let server;
let port;
let bcrypt;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'rasan-panic-test-'));
  process.env.DATA_DIR = dataDir;
  bcrypt = (await import('bcryptjs')).default;
  const panicImport = await import('../server/panic.js');
  panicMod = panicImport.default ?? panicImport;
  const dbMod = await import('../server/db.js');
  db = dbMod.db;
  // notifications.js ينشئ جدول notification_prefs — نفس ما يفعله server.js
  await import('../server/notifications.js');

  // ===== تطبيق مصغّر بالراوتر الحقيقي ومصادقة مطابقة لauthRequired =====
  const express = (await import('express')).default;
  const fakeIo = { sockets: { sockets: new Map() } };
  const fakeAuth = (req, res, next) => {
    const h = req.headers.authorization || '';
    const m = /^Bearer u:(\d+)$/.exec(h);
    if (!m) return res.status(401).json({ error: 'unauthorized' });
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(Number(m[1]));
    if (!user) return res.status(401).json({ error: 'unauthorized' }); // الحساب المسحوب يفشل فوراً
    req.user = user;
    next();
  };
  app = express();
  app.use(express.json());
  app.use('/api', panicMod.createRouter({ authRequired: fakeAuth, io: fakeIo }));
  server = app.listen(0);
  port = server.address().port;
});

afterAll(() => {
  server?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

// ===== أدوات البذر =====
let seq = 0;
async function makeUser(username, password) {
  seq++;
  const hash = await bcrypt.hash(password, 4); // تكلفة منخفضة للاختبار فقط
  const info = db
    .prepare("INSERT INTO users (username, password_hash, public_key, locale, created_at) VALUES (?, ?, ?, 'ar', ?)")
    .run(username, hash, 'A'.repeat(88), Date.now());
  return Number(info.lastInsertRowid);
}
function addMember(cid, uid, role = 'member') {
  db.prepare("INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)").run(cid, uid, role, Date.now());
}
function makeConversation(ownerId, type = 'group') {
  const info = db.prepare("INSERT INTO conversations (type, name, owner_id, created_at) VALUES (?, ?, ?, ?)").run(type, `conv-${seq}-${Date.now()}`, ownerId, Date.now());
  return Number(info.lastInsertRowid);
}

let victim; // المستخدم الذي سيمسَح حسابه
let friend; // مستخدم آخر يجب ألا يمسّه المسح
let victimPassword = 'correct-horse-7';
const authOf = (uid) => ({ 'Content-Type': 'application/json', Authorization: `Bearer u:${uid}` });
const wipe = (uid, body) => fetch(`http://127.0.0.1:${port}/api/account/wipe`, { method: 'POST', headers: authOf(uid), body: JSON.stringify(body) });

beforeAll(async () => {
  victim = await makeUser(`panic_victim_${Date.now()}`, victimPassword);
  friend = await makeUser(`panic_friend_${Date.now()}`, 'friend-pass-9');

  // محادثة مشتركة (ضحية + صديق) فيها رسائل من الاثنين
  const shared = makeConversation(victim);
  addMember(shared, victim, 'owner');
  addMember(shared, friend);
  db.prepare("INSERT INTO messages (conversation_id, sender_id, type, ciphertext, iv, time) VALUES (?, ?, 'text', 'ct-v', 'iv', ?)").run(shared, victim, Date.now());
  db.prepare("INSERT INTO messages (conversation_id, sender_id, type, ciphertext, iv, time) VALUES (?, ?, 'text', 'ct-f', 'iv', ?)").run(shared, friend, Date.now());

  // محادثة الضحية الخاصة (ستصبح فارغة بعد المسح)
  const solo = makeConversation(victim);
  addMember(solo, victim, 'owner');
  db.prepare("INSERT INTO messages (conversation_id, sender_id, type, ciphertext, iv, time) VALUES (?, ?, 'text', 'ct-solo', 'iv', ?)").run(solo, victim, Date.now());

  // مرفق للضحية — ملف حقيقي على القرص
  const attId = 'att' + Date.now().toString(36);
  writeFileSync(join(dataDir, 'uploads', attId + '.bin'), Buffer.from('encrypted-bytes'));
  db.prepare("INSERT INTO attachments (id, conversation_id, uploader_id, size_bytes, created_at) VALUES (?, ?, ?, ?, ?)").run(attId, shared, victim, 16, Date.now());

  // قصة + نسخة احتياطية + توكن جهاز + تفضيلات للضحية
  db.prepare("INSERT INTO stories (user_id, ciphertext, iv, type, created_at, expires_at) VALUES (?, 'ct', 'iv', 'text', ?, ?)").run(victim, Date.now(), Date.now() + 86400000);
  db.prepare("INSERT INTO key_backups (user_id, ciphertext, iv, salt, iterations, created_at) VALUES (?, 'ct', 'iv', 'salt', 150000, ?)").run(victim, Date.now());
  db.prepare("INSERT INTO device_tokens (token, user_id, platform, created_at, updated_at) VALUES (?, ?, 'android', ?, ?)").run('tok' + Date.now(), victim, Date.now(), Date.now());
  try { db.prepare("INSERT INTO notification_prefs (user_id, messages_enabled, invites_enabled, updated_at) VALUES (?, 1, 1, ?)").run(victim, Date.now()); } catch {}

  globalThis.__panicFixture = { shared, solo, attId };
});

describe('POST /api/account/wipe — العقد الأمني', () => {
  it('401 بلا مصادقة', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/account/wipe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(r.status).toBe(401);
  });

  it('400 بلا كلمة مرور', async () => {
    const r = await wipe(victim, {});
    expect(r.status).toBe(400);
  });

  it('401 بكلمة مرور خاطئة — ولا يُمسح شيء', async () => {
    const r = await wipe(victim, { password: 'wrong-password' });
    expect(r.status).toBe(401);
    const u = db.prepare('SELECT id FROM users WHERE id = ?').get(victim);
    expect(u).toBeTruthy();
  });

  it('نجاح بكلمة المرور الصحيحة: يرد بعدّادات ويمسح كل أثر الضحية', async () => {
    const { attId, shared, solo } = globalThis.__panicFixture;
    const r = await wipe(victim, { password: victimPassword });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.wiped.user).toBe(1);
    expect(body.wiped.messages).toBe(2); // رسالة الضحية: واحدة في المشتركة وواحدة في الفردية
    expect(body.wiped.attachments).toBe(1);
    expect(body.wiped.key_backups).toBe(1);
    expect(body.wiped.device_tokens).toBe(1);
    expect(body.wiped.empty_conversations).toBe(1); // محادثته الفردية

    // الحساب نفسه اختفى → كل توكناته ماتت
    expect(db.prepare('SELECT id FROM users WHERE id = ?').get(victim)).toBeFalsy();
    // ملف المرفق حُذف من القرص
    expect(existsSync(join(dataDir, 'uploads', attId + '.bin'))).toBe(false);
    // محادثته الفردية حُذفت
    expect(db.prepare('SELECT id FROM conversations WHERE id = ?').get(solo)).toBeFalsy();
    // المحادثة المشتركة بقيت لصديقه
    expect(db.prepare('SELECT id FROM conversations WHERE id = ?').get(shared)).toBeTruthy();
  });

  it('بعد المسح: توكن الضحية يُرفض (الحساب غير موجود)', async () => {
    const r = await wipe(victim, { password: victimPassword });
    expect(r.status).toBe(401);
  });

  it('بيانات الصديق لم تُمس: رسالته وعضويته وحسابه سليمة', async () => {
    const { shared } = globalThis.__panicFixture;
    expect(db.prepare('SELECT id FROM users WHERE id = ?').get(friend)).toBeTruthy();
    const hisMsg = db.prepare("SELECT COUNT(*) c FROM messages WHERE conversation_id = ? AND sender_id = ?").get(shared, friend);
    expect(hisMsg.c).toBe(1);
    const hisMembership = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(shared, friend);
    expect(hisMembership).toBeTruthy();
  });
});

// ===== منطق العميل (web/panic.js) =====

describe('web/panic.js — الرموز وقرار الإدخال والمسح المحلي', () => {
  let webPanic;
  beforeAll(async () => {
    webPanic = await import('../web/panic.js');
  });

  it('isValidPin: 4-8 أرقام فقط', () => {
    expect(webPanic.isValidPin('1234')).toBe(true);
    expect(webPanic.isValidPin('12345678')).toBe(true);
    expect(webPanic.isValidPin('123')).toBe(false);
    expect(webPanic.isValidPin('123456789')).toBe(false);
    expect(webPanic.isValidPin('12a4')).toBe(false);
    expect(webPanic.isValidPin('')).toBe(false);
  });

  it('makePinRecord + verifyPin: الصحيح ينجح والخاطئ يفشل', async () => {
    const rec = await webPanic.makePinRecord('9876');
    expect(rec.v).toBe(1);
    expect(rec.iterations).toBeGreaterThanOrEqual(100000);
    expect(JSON.stringify(rec)).not.toContain('9876'); // النص الأصلي لا يُخزَّن
    expect(await webPanic.verifyPin('9876', rec)).toBe(true);
    expect(await webPanic.verifyPin('9877', rec)).toBe(false);
    expect(await webPanic.verifyPin('', rec)).toBe(false);
    expect(await webPanic.verifyPin('9876', null)).toBe(false);
  });

  it('السجل المشتق لا يتكرر بين نداءين (ملح عشوائي)', async () => {
    const a = await webPanic.makePinRecord('1111');
    const b = await webPanic.makePinRecord('1111');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('evaluateEntry: الإضطرار يفوز على القفل عند التطابق الوهمي', async () => {
    const lock = await webPanic.makePinRecord('1111');
    const duress = await webPanic.makePinRecord('2222');
    expect(await webPanic.evaluateEntry('2222', lock, duress)).toBe('wipe');
    expect(await webPanic.evaluateEntry('1111', lock, duress)).toBe('unlock');
    expect(await webPanic.evaluateEntry('9999', lock, duress)).toBe('deny');
  });

  it('evaluateEntry يعمل بلا رموز مضبوطة (deny دائماً)', async () => {
    expect(await webPanic.evaluateEntry('1234', null, null)).toBe('deny');
  });

  it('sweepLocalStorage يمسح مفاتيح رسن فقط ويترك غيرها', () => {
    localStorage.setItem('rasan_token', 't');
    localStorage.setItem('rasan_outbox', '[]');
    localStorage.setItem('rasan_lock_pin', '{}');
    localStorage.setItem('other_app_data', 'keep-me');
    const doomed = webPanic.sweepLocalStorage();
    expect(doomed.sort()).toEqual(['rasan_lock_pin', 'rasan_outbox', 'rasan_token']);
    expect(localStorage.getItem('other_app_data')).toBe('keep-me');
    expect(localStorage.getItem('rasan_token')).toBe(null);
  });

  it('readRecord يرفض السجلات التالفة بأمان', () => {
    localStorage.setItem('rasan_test_rec', 'not-json');
    expect(webPanic.readRecord(localStorage, 'rasan_test_rec')).toBe(null);
    localStorage.setItem('rasan_test_rec', JSON.stringify({ v: 2 }));
    expect(webPanic.readRecord(localStorage, 'rasan_test_rec')).toBe(null);
  });
});
