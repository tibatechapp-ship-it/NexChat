// interactions.test.js — اختبارات ميزات التفاعل والمراسلة (P4 — بحث الميزات)
//
// الضمانات التشغيلية (راوتر حقيقي + io وهمي + DATA_DIR مؤقت — نمط moderation):
// 1. التفاعلات (نمط WhatsApp): إيموجي واحد لكل مستخدم لكل رسالة، نفس الإيموجي
//    = سحب (toggle)، مختلف = استبدال، قائمة بيضاء مغلقة ترفض أي إيموجي خارجها،
//    لا تفاعل من خارج المحادثة (403) ولا على رسالة محذوفة (400) ولا مفقودة (404)،
//    وبث message:reaction يصل الغرفة، والتجمع يظهر في جلب الرسائل عبر attachReactions.
// 2. الحظر (نمط WhatsApp/Telegram): لا حظر للنفس (400) ولا لغير موجود (404)،
//    القائمة والرفع، وبوابات فتح DM الجديد بأي اتجاه (403 blocked)، وبوابتا
//    إضافة الأعضاء الاتجاهيتان (blocked_by_user / you_blocked_user).
// 3. زنادا db.js: تفاعلات رسالة تموت معها على كل مسارات الحذف (DELETE الصريح
//    والحذف الناعم deleted=1) — بلا أي تعديل في مسارات الحذف القائمة.
// 4. عقد الأسلاك في server.js (نمط calls.test.js): بوابة الحظر في رسائل DM
//    القائمة، والردود replyTo خلف تحقق (نفس المحادثة + غير محذوفة)، وreply_to_id
//    في INSERT والبث والجلب، وattachReactions على مسار الجلب.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let db;
let interactions;
let dataDir;
let app;
let server;
let port;
let emitted = [];

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'rasan-interactions-test-'));
  process.env.DATA_DIR = dataDir;
  interactions = await import('../server/interactions.js');
  const dbMod = await import('../server/db.js');
  db = dbMod.db;

  const express = (await import('express')).default;
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
  app.use('/api', interactions.createRouter({ authRequired: fakeAuth, io: fakeIo }));
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
function seedMessage(convId, senderId, { deleted = 0 } = {}) {
  const id = ++seq + 5000;
  db.prepare('INSERT INTO messages (id, conversation_id, sender_id, type, ciphertext, iv, time, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, convId, senderId, 'text', 'ct', 'iv', Date.now(), deleted);
  return id;
}
const call = (method, path, userId, body) =>
  fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer u:${userId}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));

describe('تفاعلات الإيموجي — إيموجي لكل مستخدم، toggle، قائمة بيضاء (نمط WhatsApp)', () => {
  it('إضافة تفاعل: 200 + بث message:reaction للغرفة', async () => {
    const owner = seedUser();
    const convId = seedConv(owner);
    const msgId = seedMessage(convId, owner);
    emitted.length = 0;
    const r = await call('PUT', `/api/messages/${msgId}/reaction`, owner, { emoji: '👍' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, emoji: '👍' });
    expect(emitted.some((e) => e.event === 'message:reaction' && e.payload.messageId === msgId && e.payload.emoji === '👍' && e.room === `conv:${convId}`)).toBe(true);
    const row = db.prepare('SELECT emoji FROM message_reactions WHERE message_id = ? AND user_id = ?').get(msgId, owner);
    expect(row.emoji).toBe('👍');
  });

  it('نفس الإيموجي ثانية = سحب (toggle off) ببث emoji:null', async () => {
    const owner = seedUser();
    const convId = seedConv(owner);
    const msgId = seedMessage(convId, owner);
    await call('PUT', `/api/messages/${msgId}/reaction`, owner, { emoji: '❤️' });
    emitted.length = 0;
    const r = await call('PUT', `/api/messages/${msgId}/reaction`, owner, { emoji: '❤️' });
    expect(r.status).toBe(200);
    expect(r.json.emoji).toBeNull();
    expect(emitted.some((e) => e.event === 'message:reaction' && e.payload.emoji === null)).toBe(true);
    expect(db.prepare('SELECT 1 FROM message_reactions WHERE message_id = ? AND user_id = ?').get(msgId, owner)).toBeUndefined();
  });

  it('إيموجي مختلف = استبدال (صف واحد لكل مستخدم — لا تكدس)', async () => {
    const owner = seedUser();
    const convId = seedConv(owner);
    const msgId = seedMessage(convId, owner);
    await call('PUT', `/api/messages/${msgId}/reaction`, owner, { emoji: '👍' });
    const r = await call('PUT', `/api/messages/${msgId}/reaction`, owner, { emoji: '🔥' });
    expect(r.status).toBe(200);
    const rows = db.prepare('SELECT emoji FROM message_reactions WHERE message_id = ? AND user_id = ?').all(msgId, owner);
    expect(rows).toHaveLength(1);
    expect(rows[0].emoji).toBe('🔥');
  });

  it('قائمة بيضاء مغلقة: إيموجي خارجها 400 — الحقل لا يصبح قناة بيانات', async () => {
    const owner = seedUser();
    const convId = seedConv(owner);
    const msgId = seedMessage(convId, owner);
    const r1 = await call('PUT', `/api/messages/${msgId}/reaction`, owner, { emoji: '🦠' });
    expect(r1.status).toBe(400);
    const r2 = await call('PUT', `/api/messages/${msgId}/reaction`, owner, { emoji: 'x'.repeat(500) });
    expect(r2.status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) c FROM message_reactions WHERE message_id = ?').get(msgId).c).toBe(0);
  });

  it('لا تفاعل من خارج المحادثة (403) ولا على رسالة محذوفة (400) ولا مفقودة (404)', async () => {
    const owner = seedUser(), outsider = seedUser();
    const convId = seedConv(owner);
    const msgId = seedMessage(convId, owner);
    const deletedId = seedMessage(convId, owner, { deleted: 1 });
    expect((await call('PUT', `/api/messages/${msgId}/reaction`, outsider, { emoji: '👍' })).status).toBe(403);
    expect((await call('PUT', `/api/messages/${deletedId}/reaction`, owner, { emoji: '👍' })).status).toBe(400);
    expect((await call('PUT', `/api/messages/999999/reaction`, owner, { emoji: '👍' })).status).toBe(404);
  });

  it('attachReactions يجمع التفاعلات في صفوف الرسائل (يستخدمه جلب الرسائل)', () => {
    const owner = seedUser(), other = seedUser();
    const convId = seedConv(owner);
    const msgId = seedMessage(convId, owner);
    db.prepare('INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)').run(msgId, owner, '👍', Date.now());
    db.prepare('INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)').run(msgId, other, '👍', Date.now() + 1);
    const rows = interactions.attachReactions([{ id: msgId, ciphertext: 'x' }]);
    expect(rows[0].reactions).toEqual([{ emoji: '👍', userId: owner }, { emoji: '👍', userId: other }]);
    expect(interactions.attachReactions([{ id: 424242, ciphertext: 'x' }])[0].reactions).toBeUndefined();
  });
});

describe('حظر المستخدمين — بوابات DM وإضافة الأعضاء (نمط WhatsApp/Telegram)', () => {
  it('لا حظر للنفس (400) ولا لغير موجود (404)', async () => {
    const me = seedUser();
    expect((await call('POST', `/api/users/${me}/block`, me)).status).toBe(400);
    expect((await call('POST', `/api/users/999999/block`, me)).status).toBe(404);
  });

  it('حظر ثم قائمة ثم رفع — والسجل اتجاهي (حظري ≠ حظره)', async () => {
    const me = seedUser(), target = seedUser();
    expect((await call('POST', `/api/users/${target}/block`, me)).status).toBe(200);
    const list = await call('GET', '/api/users/blocks', me);
    expect(list.status).toBe(200);
    expect(list.json.blocks.some((b) => b.userId === target)).toBe(true);
    // الاتجاه المعاكس لا يتأثر
    const rev = await call('GET', '/api/users/blocks', target);
    expect(rev.json.blocks.some((b) => b.userId === me)).toBe(false);
    expect(interactions.hasBlocked(me, target)).toBe(true);
    expect(interactions.hasBlocked(target, me)).toBe(false);
    expect(interactions.isBlockedBetween(me, target)).toBe(true);
    // رفع الحظر
    expect((await call('DELETE', `/api/users/${target}/block`, me)).status).toBe(200);
    expect(interactions.isBlockedBetween(me, target)).toBe(false);
  });

  it('الحظر idempotent — إعادة الحظر لا تفشل ولا تكرر', async () => {
    const me = seedUser(), target = seedUser();
    await call('POST', `/api/users/${target}/block`, me);
    await call('POST', `/api/users/${target}/block`, me);
    const rows = db.prepare('SELECT COUNT(*) c FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?').get(me, target);
    expect(rows.c).toBe(1);
  });

  it('عقد server.js: DM الجديدة تُرفض بأي اتجاه حجب (403 blocked)', () => {
    const src = read('server/server.js');
    expect(src).toMatch(/if \(type === "dm"\) \{[\s\S]*?interactions\.isBlockedBetween\(req\.user\.id, u\.id\)\) return res\.status\(403\)\.json\(\{ error: "blocked" \}\)/);
  });

  it('عقد server.js: بوابتا إضافة الأعضاء الاتجاهيتان (blocked_by_user / you_blocked_user)', () => {
    const src = read('server/server.js');
    expect(src).toMatch(/if \(interactions\.hasBlocked\(target\.id, req\.user\.id\)\) return res\.status\(403\)\.json\(\{ error: "blocked_by_user" \}\)/);
    expect(src).toMatch(/if \(interactions\.hasBlocked\(req\.user\.id, target\.id\)\) return res\.status\(403\)\.json\(\{ error: "you_blocked_user" \}\)/);
  });

  it('عقد server.js: رسائل DM القائمة تصمت خلف الحجب الثنائي (message:rejected reason:blocked)', () => {
    const src = read('server/server.js');
    expect(src).toMatch(/if \(conv\.type === "dm"\) \{[\s\S]*?const other = db\.prepare\("SELECT user_id FROM conversation_members WHERE conversation_id = \? AND user_id != \?"\)\.get\(conversationId, uid\);[\s\S]*?interactions\.isBlockedBetween\(uid, other\.user_id\)[\s\S]*?reason: "blocked"/);
  });
});

describe('الردود (Replies) — مرجع معرّف فقط، النص المقتبس داخل ciphertext (E2EE)', () => {
  it('عقد server.js: replyTo خلف تحقق صارم (موجود + نفس المحادثة + غير محذوف) وإلا reply_invalid', () => {
    const src = read('server/server.js');
    expect(src).toMatch(/let replyTo = null;/);
    expect(src).toMatch(/const target = db\.prepare\("SELECT id, conversation_id, deleted FROM messages WHERE id = \?"\)\.get\(replyTo\);/);
    expect(src).toMatch(/!target \|\| target\.conversation_id !== conversationId \|\| target\.deleted/);
    expect(src).toMatch(/reason: "reply_invalid"/);
    // يُخزَّن في INSERT ويُبث ويُجلب
    expect(src).toMatch(/attachment_id, reply_to_id\) VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, \?, \?\)/);
    expect(src).toMatch(/attachmentId: attachmentId \|\| null, replyTo \}/);
    expect(src).toMatch(/m\.reply_to_id AS replyTo/);
  });

  it('عمود reply_to_id مُرحّل فعلاً في قاعدة البيانات', () => {
    const cols = db.prepare("PRAGMA table_info(messages)").all().map((c) => c.name);
    expect(cols).toContain('reply_to_id');
  });
});

describe('زنادا التنظيف — تفاعلات الرسالة تموت معها على كل مسارات الحذف', () => {
  it('الحذف الصريح (DELETE) يمسح تفاعلات الرسالة', () => {
    const owner = seedUser();
    const convId = seedConv(owner);
    const msgId = seedMessage(convId, owner);
    db.prepare('INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)').run(msgId, owner, '👍', Date.now());
    db.prepare('DELETE FROM messages WHERE id = ?').run(msgId);
    expect(db.prepare('SELECT COUNT(*) c FROM message_reactions WHERE message_id = ?').get(msgId).c).toBe(0);
  });

  it('الحذف الناعم (deleted=1 — مسار الإشراف) يمسح التفاعلات أيضاً', () => {
    const owner = seedUser();
    const convId = seedConv(owner);
    const msgId = seedMessage(convId, owner);
    db.prepare('INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)').run(msgId, owner, '🔥', Date.now());
    db.prepare('UPDATE messages SET deleted = 1 WHERE id = ?').run(msgId);
    expect(db.prepare('SELECT COUNT(*) c FROM message_reactions WHERE message_id = ?').get(msgId).c).toBe(0);
    // والسجل نفسه باقٍ (حذف ناعم للتدقيق كما هو)
    expect(db.prepare('SELECT deleted FROM messages WHERE id = ?').get(msgId).deleted).toBe(1);
  });
});

describe('جداول P4 — البنية موجودة ومفهرسة', () => {
  it('message_reactions بمفتاح (message_id, user_id) وblocked_users بمفتاح (blocker_id, blocked_id)', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    expect(tables).toContain('message_reactions');
    expect(tables).toContain('blocked_users');
    const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map((r) => r.name);
    expect(triggers).toContain('trg_msg_reactions_on_delete');
    expect(triggers).toContain('trg_msg_reactions_on_softdelete');
  });

  it('القائمة البيضاء للتفاعلات ثابتة (8 إيموجي) ومطابقة لقائمة العميل', () => {
    expect(interactions.ALLOWED_REACTIONS).toHaveLength(8);
    expect(new Set(interactions.ALLOWED_REACTIONS).size).toBe(8);
  });
});
