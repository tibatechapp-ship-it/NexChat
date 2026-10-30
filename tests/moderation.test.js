// moderation.test.js — اختبارات تشغيلية حقيقية لأدوات الإشراف
// (server/moderation.js — درس FireChat في docs/FEATURE_RESEARCH.md §6).
//
// الضمانات:
// 1. حذف رسالة غيري: للمشرف/المالك فقط — ويكون حذفاً ناعماً (deleted=1) مع
//    حذف المرفق بملفه من القرص، وبقاء سجل الرسالة (تدقيق).
// 2. تثبيت رسالة: مشرف/مالك فقط، رسالة قائمة غير محذوفة من نفس المحادثة،
//    ورسالة واحدة مثبّتة كحد أقصى (العمود على conversations).
// 3. الأدوار: المالك وحده يرقّي/ينزّل؛ لا يمكن تغيير دور المالك أو النفس؛
//    والرتبة المقبولة admin|member فقط.
// 4. الحظر: يزيل العضوية ومفاتيح المجموعة ويسجل المحظور؛ isBanned يراه
//    server.js ليرفض إضافته ثانيةً (403 banned)؛ المشرف لا يحظر مشرفاً
//    ولا المالك؛ ورفع الحظر يعيد فتح الباب.
// 5. بث الأحداث member:role / member:banned / message:pinned /
//    message:deleted يصل إلى الغرفة (fake io يسجل الغرف).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let db;
let moderation;
let UPLOAD_DIR;
let dataDir;
let app;
let server;
let port;
let emitted = []; // بث الـfake io — للتأكد من وصول الأحداث للغرفة

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'rasan-moderation-test-'));
  process.env.DATA_DIR = dataDir;
  moderation = await import('../server/moderation.js');
  const dbMod = await import('../server/db.js');
  db = dbMod.db;
  UPLOAD_DIR = dbMod.UPLOAD_DIR;

  const express = (await import('express')).default;
  // fake io: يسجل (room, event, payload) — نفس شكل io.to(...).emit
  const fakeIo = { to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }) };
  const fakeAuth = (req, res, next) => {
    const m = /^Bearer u:(\d+)$/.exec(req.headers.authorization || '');
    const user = m && db.prepare('SELECT id, username FROM users WHERE id = ?').get(Number(m[1]));
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    req.user = user;
    next();
  };
  app = express();
  app.use(express.json());
  app.use('/api', moderation.createRouter({ authRequired: fakeAuth, io: fakeIo }));
  server = app.listen(0);
  port = server.address().port;
});

afterAll(() => {
  server?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

// ===== أدوات البذر =====
let seq = 0;
function seedUser() {
  const id = ++seq;
  db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(id, `user${id}`, 'x', Date.now());
  return id;
}
function seedConv(ownerId, type = 'group') {
  const id = ++seq + 1000;
  db.prepare('INSERT INTO conversations (id, type, name, owner_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, type, `conv${id}`, ownerId, Date.now());
  db.prepare('INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)')
    .run(id, ownerId, 'owner', Date.now());
  return id;
}
function addMember(convId, userId, role = 'member') {
  db.prepare('INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)')
    .run(convId, userId, role, Date.now());
}
function seedMessage(convId, senderId, attachmentId = null) {
  const id = ++seq + 5000;
  db.prepare('INSERT INTO messages (id, conversation_id, sender_id, type, ciphertext, iv, time) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, convId, senderId, 'text', 'ct', 'iv', Date.now());
  return id;
}
const call = (method, path, userId, body) =>
  fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer u:${userId}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));

describe('حذف رسالة غيري — مشرف/مالك فقط، حذف ناعم + مرفق يُمسح من القرص', () => {
  it('عضو عادي لا يحذف رسالة غيره (403) ولا رسالة نفسه عبر REST غير موجود له', async () => {
    const owner = seedUser(), member = seedUser(), other = seedUser();
    const convId = seedConv(owner);
    addMember(convId, member);
    const msgId = seedMessage(convId, other);
    expect((await call('DELETE', `/api/conversations/${convId}/messages/${msgId}`, member)).status).toBe(403);
  });

  it('المشرف يحذف رسالة عضو: deleted=1 يبقى في القاعدة (تدقيق) + بث message:deleted', async () => {
    const owner = seedUser(), admin = seedUser(), other = seedUser();
    const convId = seedConv(owner);
    addMember(convId, admin, 'admin');
    const msgId = seedMessage(convId, other);
    const r = await call('DELETE', `/api/conversations/${convId}/messages/${msgId}`, admin);
    expect(r.status).toBe(200);
    const row = db.prepare('SELECT deleted FROM messages WHERE id = ?').get(msgId);
    expect(row.deleted).toBe(1); // ناعم — السجل باقٍ
    expect(emitted.some((e) => e.event === 'message:deleted' && e.payload.id === msgId && e.room === `conv:${convId}`)).toBe(true);
  });

  it('حذف رسالة بمرفق يمسح الملف من القرص وصفه — لا ملفات يتيمة', async () => {
    const owner = seedUser(), admin = seedUser(), other = seedUser();
    const convId = seedConv(owner);
    addMember(convId, admin, 'admin');
    const msgId = seedMessage(convId, other);
    const attId = 'att' + ++seq;
    writeFileSync(join(UPLOAD_DIR, attId + '.bin'), Buffer.from('secret-blob'));
    db.prepare('INSERT INTO attachments (id, conversation_id, uploader_id, size_bytes, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(attId, convId, other, 10, Date.now());
    db.prepare('UPDATE messages SET attachment_id = ? WHERE id = ?').run(attId, msgId);

    expect(existsSync(join(UPLOAD_DIR, attId + '.bin'))).toBe(true);
    await call('DELETE', `/api/conversations/${convId}/messages/${msgId}`, admin);
    expect(existsSync(join(UPLOAD_DIR, attId + '.bin'))).toBe(false); // الملف مُسح
    expect(db.prepare('SELECT COUNT(*) c FROM attachments WHERE id = ?').get(attId).c).toBe(0);
  });

  it('الحذف مكرر ينجح بصمت (idempotent) والرسالة غير الموجودة 404', async () => {
    const owner = seedUser(), admin = seedUser(), other = seedUser();
    const convId = seedConv(owner);
    addMember(convId, admin, 'admin');
    const msgId = seedMessage(convId, other);
    await call('DELETE', `/api/conversations/${convId}/messages/${msgId}`, admin);
    expect((await call('DELETE', `/api/conversations/${convId}/messages/${msgId}`, admin)).status).toBe(200);
    expect((await call('DELETE', `/api/conversations/${convId}/messages/999999`, admin)).status).toBe(404);
  });
});

describe('التثبيت — رسالة واحدة مثبّتة لكل محادثة، مشرف/مالك فقط', () => {
  it('عضو عادي ممنوع (403)، والمشرف يثبّت ويُحدث pinned_message_id + بث', async () => {
    const owner = seedUser(), admin = seedUser(), member = seedUser();
    const convId = seedConv(owner);
    addMember(convId, admin, 'admin');
    addMember(convId, member);
    const msgId = seedMessage(convId, member);

    expect((await call('PUT', `/api/conversations/${convId}/pin`, member, { messageId: msgId })).status).toBe(403);
    const r = await call('PUT', `/api/conversations/${convId}/pin`, admin, { messageId: msgId });
    expect(r.status).toBe(200);
    expect(db.prepare('SELECT pinned_message_id FROM conversations WHERE id = ?').get(convId).pinned_message_id).toBe(msgId);
    expect(emitted.some((e) => e.event === 'message:pinned' && e.payload.messageId === msgId)).toBe(true);
  });

  it('إعادة التثبيت تستبدل الرسالة المثبّتة (رسالة واحدة)، وUNPIN يفرغها، ورسالة محذوفة تُرفض', async () => {
    const owner = seedUser(), other = seedUser();
    const convId = seedConv(owner);
    const m1 = seedMessage(convId, other), m2 = seedMessage(convId, other);
    await call('PUT', `/api/conversations/${convId}/pin`, owner, { messageId: m1 });
    await call('PUT', `/api/conversations/${convId}/pin`, owner, { messageId: m2 });
    expect(db.prepare('SELECT pinned_message_id FROM conversations WHERE id = ?').get(convId).pinned_message_id).toBe(m2);

    expect((await call('DELETE', `/api/conversations/${convId}/pin`, owner)).status).toBe(200);
    expect(db.prepare('SELECT pinned_message_id FROM conversations WHERE id = ?').get(convId).pinned_message_id).toBeNull();

    db.prepare('UPDATE messages SET deleted = 1 WHERE id = ?').run(m1);
    expect((await call('PUT', `/api/conversations/${convId}/pin`, owner, { messageId: m1 })).status).toBe(400);
  });
});

describe('الأدوار — المالك وحده يرقّي/ينزّل، ولا يُمَس دور المالك ولا دوره', () => {
  it('المالك يرقّي عضواً إلى admin ثم ينزّله — وبث member:role', async () => {
    const owner = seedUser(), member = seedUser();
    const convId = seedConv(owner);
    addMember(convId, member);
    const r = await call('PUT', `/api/conversations/${convId}/members/${member}/role`, owner, { role: 'admin' });
    expect(r.status).toBe(200);
    expect(db.prepare('SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(convId, member).role).toBe('admin');
    expect((await call('PUT', `/api/conversations/${convId}/members/${member}/role`, owner, { role: 'member' })).status).toBe(200);
    expect(emitted.some((e) => e.event === 'member:role' && e.payload.userId === member)).toBe(true);
  });

  it('المشرف لا يرقّي (owner only)، والمالك لا يُمَس دوره، والنفس ممنوعة، ورتبة غير معروفة 400', async () => {
    const owner = seedUser(), admin = seedUser(), member = seedUser();
    const convId = seedConv(owner);
    addMember(convId, admin, 'admin');
    addMember(convId, member);

    expect((await call('PUT', `/api/conversations/${convId}/members/${member}/role`, admin, { role: 'admin' })).status).toBe(403);
    expect((await call('PUT', `/api/conversations/${convId}/members/${owner}/role`, owner, { role: 'member' })).status).toBe(400);
    expect((await call('PUT', `/api/conversations/${convId}/members/${owner}/role`, owner, { role: 'admin' })).status).toBe(400);
    expect((await call('PUT', `/api/conversations/${convId}/members/${member}/role`, owner, { role: 'owner' })).status).toBe(400);
    expect((await call('PUT', `/api/conversations/${convId}/members/${member}/role`, owner, { role: 'boss' })).status).toBe(400);
    expect((await call('PUT', `/api/conversations/${convId}/members/${member}/role`, owner, { role: 'admin' })).status).toBe(200);
  });
});

describe('الحظر — يمنع العودة: server.js يستعلم isBanned قبل أي إضافة عضو', () => {
  it('المالك يحظر عضواً: عضويته ومفاتيحه تُحذف وسجل الحظر يمنع الإضافة (isBanned)', async () => {
    const owner = seedUser(), member = seedUser();
    const convId = seedConv(owner);
    addMember(convId, member);
    db.prepare('INSERT INTO group_keys (conversation_id, user_id, wrapped_by, wrapped_key, iv, key_version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(convId, member, owner, 'wk', 'iv', 1, Date.now());

    const r = await call('POST', `/api/conversations/${convId}/bans`, owner, { username: `user${member}` });
    expect(r.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) c FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(convId, member).c).toBe(0);
    expect(db.prepare('SELECT COUNT(*) c FROM group_keys WHERE conversation_id = ? AND user_id = ?').get(convId, member).c).toBe(0);
    expect(moderation.isBanned(convId, member)).toBe(true); // نفس الدالة التي يفحص بها server.js
    expect(emitted.some((e) => e.event === 'member:banned' && e.payload.userId === member)).toBe(true);
  });

  it('سلّم الإشراف: المشرف يحظر عضواً، ولا يحظر مشرفاً آخر ولا المالك (owner only)', async () => {
    const owner = seedUser(), admin1 = seedUser(), admin2 = seedUser(), member = seedUser();
    const convId = seedConv(owner);
    addMember(convId, admin1, 'admin');
    addMember(convId, admin2, 'admin');
    addMember(convId, member);

    expect((await call('POST', `/api/conversations/${convId}/bans`, admin1, { username: `user${admin2}` })).status).toBe(403);
    expect((await call('POST', `/api/conversations/${convId}/bans`, admin1, { username: `user${owner}` })).status).toBe(400);
    expect((await call('POST', `/api/conversations/${convId}/bans`, admin1, { username: `user${member}` })).status).toBe(200);
    expect(moderation.isBanned(convId, member)).toBe(true);
  });

  it('رفع الحظر يمسح السجل فيعود العضو قابلاً للإضافة، والقائمة للمشرفين فقط', async () => {
    const owner = seedUser(), member = seedUser();
    const convId = seedConv(owner);
    addMember(convId, member);
    await call('POST', `/api/conversations/${convId}/bans`, owner, { username: `user${member}` });
    expect(moderation.isBanned(convId, member)).toBe(true);

    const list = await call('GET', `/api/conversations/${convId}/bans`, owner);
    expect(list.status).toBe(200);
    expect(list.json.bans.some((b) => b.userId === member)).toBe(true);

    expect((await call('DELETE', `/api/conversations/${convId}/bans/${member}`, owner)).status).toBe(200);
    expect(moderation.isBanned(convId, member)).toBe(false);
    // أعضاء عاديون لا يرون قائمة الحظر ولا يحذفون منها
    expect((await call('GET', `/api/conversations/${convId}/bans`, member)).status).toBe(403);
  });

  it('غير الأعضاء ممنوعون من كل نقاط الإشراف (403 forbidden)', async () => {
    const owner = seedUser(), outsider = seedUser();
    const convId = seedConv(owner);
    const msgId = seedMessage(convId, owner);
    expect((await call('DELETE', `/api/conversations/${convId}/messages/${msgId}`, outsider)).status).toBe(403);
    expect((await call('PUT', `/api/conversations/${convId}/pin`, outsider, { messageId: msgId })).status).toBe(403);
    expect((await call('GET', `/api/conversations/${convId}/bans`, outsider)).status).toBe(403);
  });
});

// ===== عقد التوصيل في server.js (نفس أسلوب calls.test.js) =====
describe('عقد التوصيل في server.js — الإشراف مثبت في نقاط النشر الفعلية', () => {
  const server = read('server/server.js');

  it('الراوتر مثبت على /api مع المصادقة', () => {
    expect(server).toMatch(/const moderation = require\("\.\/moderation"\);/);
    expect(server).toMatch(/app\.use\("\/api", moderation\.createRouter\(\{ authRequired, io \}\)\);/);
  });

  it('فحص الحظر قبل إضافة أي عضو — المحظور يُرد 403 banned', () => {
    expect(server).toMatch(/moderation\.isBanned\(Number\(req\.params\.id\), target\.id\)/);
    expect(server).toMatch(/error: "banned"/);
  });

  it('القنوات للقراءة فقط — النشر للمشرفين/المالك حصراً بعقد channel_readonly', () => {
    expect(server).toMatch(/conv\.type === "channel"/);
    expect(server).toMatch(/reason: "channel_readonly"/);
    expect(server).toMatch(/!\["owner", "admin"\]\.includes\(role\)/);
  });
});
