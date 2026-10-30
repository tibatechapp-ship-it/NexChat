// polls.test.js — اختبارات ميزات P5 (استطلاعات الرأي + رسائل محفوظة + مسودات)
//
// الضمانات التشغيلية (راوتر حقيقي + io وهمي + DATA_DIR مؤقت — نمط interactions):
// 1. التصويت (نمط Telegram/Signal): صوت واحد لكل مستخدم لكل استطلاع، نفس
//    الخيار = سحب (toggle)، مختلف = استبدال، فهارس خارج 0..9 تُرفض 400،
//    لا صوت من خارج المحادثة (403) ولا على غير استطلاع (400) ولا محذوف (400)
//    ولا مفقود (404)، وبث message:poll-vote يصل الغرفة، والسحب الصريح بـ null.
// 2. التجميع: attachPollVotes يُلحق pollVotes برسائل poll فقط في جلب الرسائل
//    عبر server.js (سلسلة attachPollVotes(attachReactions(rows))).
// 3. زنادا db.js الموسّعان: أصوات الاستطلاع تموت مع الرسالة على مساري الحذف
//    (DELETE الصريح والحذف الناعم deleted=1) — بلا أي تعديل في المسارات.
// 4. رسائل محفوظة لنفسي: عقد الأسلاك في server.js — POST /api/conversations/self
//    مُكرِر (idempotent) بعضو واحد (أنا)، والحظر/الدفع لا يمسّانهما بلا طرف ثانٍ.
// 5. المسودات + مؤلّف الاستطلاع: عقد الواجهة — مسودة محلية localStorage تُستعاد
//    وتُمسح عند الإرسال، والسؤال والخيارات تُشفّر كصندوق واحد E2EE (نوع poll).

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

const auth = (uid) => ({ authorization: `Bearer u:${uid}` });
const vote = (uid, msgId, body) =>
  fetch(`http://localhost:${port}/api/messages/${msgId}/poll-vote`, {
    method: 'PUT', headers: { 'content-type': 'application/json', ...auth(uid) },
    body: JSON.stringify(body),
  });
const getMessages = (uid, convId) =>
  fetch(`http://localhost:${port}/api/conversations/${convId}/messages`.replace('/api', '/api'), {
    headers: auth(uid),
  });

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'rasan-polls-test-'));
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
  // جلب الرسائل يعيش في server.js — نُعيد بناء المسار هنا بنفس السلسلة الموعودة
  app.get('/api/conversations/:id/messages', fakeAuth, (req, res) => {
    const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!member) return res.status(403).json({ error: 'forbidden' });
    const rows = db.prepare('SELECT m.id, m.conversation_id AS conversationId, m.sender_id AS senderId, m.type, m.ciphertext, m.iv, m.time, m.deleted FROM messages m WHERE m.conversation_id = ? AND m.deleted = 0 ORDER BY m.time DESC LIMIT 100').all(req.params.id).reverse();
    return res.json({ messages: interactions.attachPollVotes(interactions.attachReactions(rows)) });
  });
  app.use('/api', interactions.createRouter({ authRequired: fakeAuth, io: fakeIo }));
  server = app.listen(0);
  port = server.address().port;

  // مستخدمان + محادثة + رسالة استطلاع + رسالة نصية عادية
  const t = Date.now();
  db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (1, ?, ?, ?)').run('alice', 'x', t);
  db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (2, ?, ?, ?)').run('bob', 'x', t);
  db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (3, ?, ?, ?)').run('carol', 'x', t);
  db.prepare('INSERT INTO conversations (id, type, owner_id, created_at) VALUES (10, ?, 1, ?)').run('group', t);
  for (const uid of [1, 2])
    db.prepare('INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (10, ?, ?)').run(uid, t);
  db.prepare("INSERT INTO messages (id, conversation_id, sender_id, type, ciphertext, iv, time) VALUES (100, 10, 1, 'poll', 'C', 'I', ?)").run(t);
  db.prepare("INSERT INTO messages (id, conversation_id, sender_id, type, ciphertext, iv, time) VALUES (101, 10, 1, 'text', 'C2', 'I2', ?)").run(t + 1);
});

afterAll(() => {
  server?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('تصويت الاستطلاعات — دورة الحياة الكاملة', () => {
  it('صوت جديد يُخزَّن ويُبث للغرفة', async () => {
    const r = await vote(1, 100, { optionIndex: 0 });
    expect(r.status).toBe(200);
    expect((await r.json()).optionIndex).toBe(0);
    expect(emitted.at(-1)).toMatchObject({ room: 'conv:10', event: 'message:poll-vote', payload: { messageId: 100, userId: 1, optionIndex: 0 } });
  });

  it('نفس الخيار مجدداً = سحب الصوت (toggle off)', async () => {
    const r = await vote(1, 100, { optionIndex: 0 });
    expect(r.status).toBe(200);
    expect((await r.json()).optionIndex).toBeNull();
    const count = db.prepare('SELECT COUNT(*) AS n FROM poll_votes WHERE message_id = 100 AND user_id = 1').get().n;
    expect(count).toBe(0);
  });

  it('خيار مختلف = استبدال (صوت واحد فقط في القاعدة)', async () => {
    await vote(1, 100, { optionIndex: 0 });
    const r = await vote(1, 100, { optionIndex: 2 });
    expect(r.status).toBe(200);
    expect((await r.json()).optionIndex).toBe(2);
    const rows = db.prepare('SELECT option_index AS i FROM poll_votes WHERE message_id = 100 AND user_id = 1').all();
    expect(rows).toHaveLength(1);
    expect(rows[0].i).toBe(2);
    await vote(1, 100, { optionIndex: null }); // تنظيف
  });

  it('السحب الصريح بـ null يعيد ok + null', async () => {
    await vote(2, 100, { optionIndex: 1 });
    const r = await vote(2, 100, { optionIndex: null });
    expect(r.status).toBe(200);
    expect((await r.json()).optionIndex).toBeNull();
    const count = db.prepare('SELECT COUNT(*) AS n FROM poll_votes WHERE message_id = 100 AND user_id = 2').get().n;
    expect(count).toBe(0);
  });

  it.each([-1, 10, 1.5, 'x', true])('فهرس غير صالح %p يُرفض 400', async (bad) => {
    const r = await vote(1, 100, { optionIndex: bad });
    expect(r.status).toBe(400);
  });

  it('لا صوت من خارج المحادثة (403)', async () => {
    const r = await vote(3, 100, { optionIndex: 0 });
    expect(r.status).toBe(403);
  });

  it('لا صوت على رسالة ليست استطلاعاً (400 not a poll)', async () => {
    const r = await vote(1, 101, { optionIndex: 0 });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('not a poll');
  });

  it('لا صوت على استطلاع محذوف ناعماً (400)', async () => {
    const t = Date.now();
    db.prepare("INSERT INTO messages (id, conversation_id, sender_id, type, ciphertext, iv, time, deleted) VALUES (102, 10, 1, 'poll', 'C', 'I', ?, 1)").run(t);
    const r = await vote(1, 102, { optionIndex: 0 });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('message deleted');
  });

  it('استطلاع مفقود = 404', async () => {
    const r = await vote(1, 9999, { optionIndex: 0 });
    expect(r.status).toBe(404);
  });

  it('بلا مصادقة = 401', async () => {
    const r = await fetch(`http://localhost:${port}/api/messages/100/poll-vote`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ optionIndex: 0 }),
    });
    expect(r.status).toBe(401);
  });
});

describe('تجميع الأصوات في جلب الرسائل (attachPollVotes)', () => {
  it('pollVotes تُلحق برسالة poll فقط، والنصية تبقى كما هي', async () => {
    await vote(1, 100, { optionIndex: 0 });
    await vote(2, 100, { optionIndex: 0 });
    await vote(2, 100, { optionIndex: 1 }); // استبدال
    const r = await getMessages(1, 10);
    expect(r.status).toBe(200);
    const { messages } = await r.json();
    const poll = messages.find((m) => m.id === 100);
    const text = messages.find((m) => m.id === 101);
    expect(poll.pollVotes).toEqual([{ userId: 1, optionIndex: 0 }, { userId: 2, optionIndex: 1 }]);
    expect(text.pollVotes).toBeUndefined();
    await vote(1, 100, { optionIndex: null });
    await vote(2, 100, { optionIndex: null });
  });
});

describe('زنادا db.js الموسّعان — أصوات الاستطلاع تموت مع الرسالة', () => {
  it('الحذف الصريح يمسح الأصوات', async () => {
    await vote(1, 100, { optionIndex: 3 });
    await vote(2, 100, { optionIndex: 3 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM poll_votes WHERE message_id = 100').get().n).toBe(2);
    db.prepare('DELETE FROM messages WHERE id = 100').run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM poll_votes WHERE message_id = 100').get().n).toBe(0);
    // أعد إدراج الاستطلاع لبقية الاختبارات
    db.prepare("INSERT INTO messages (id, conversation_id, sender_id, type, ciphertext, iv, time) VALUES (100, 10, 1, 'poll', 'C', 'I', ?)").run(Date.now());
  });

  it('الحذف الناعم deleted=1 يمسح الأصوات', async () => {
    await vote(1, 100, { optionIndex: 4 });
    await vote(2, 100, { optionIndex: 4 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM poll_votes WHERE message_id = 100').get().n).toBe(2);
    db.prepare('UPDATE messages SET deleted = 1 WHERE id = 100').run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM poll_votes WHERE message_id = 100').get().n).toBe(0);
    db.prepare('UPDATE messages SET deleted = 0 WHERE id = 100').run();
  });
});

describe('عقد الأسلاك — server.js وdb.js والواجهة', () => {
  const srv = () => read('server/server.js');
  const dbSrc = () => read('server/db.js');
  const appSrc = () => read('web/app.js');
  const htmlSrc = () => read('web/index.html');
  const cssSrc = () => read('web/style.css');
  const i18nSrc = () => read('web/i18n.js');

  it('جلب الرسائل يسلسل attachPollVotes فوق attachReactions', () => {
    expect(srv()).toMatch(/interactions\.attachPollVotes\(interactions\.attachReactions\(rows\)\)/);
  });

  it('رسائل محفوظة لنفسي: مسار مُكرِر بعضو واحد', () => {
    const s = srv();
    expect(s).toMatch(/app\.post\("\/api\/conversations\/self"/);
    // idempotent: يفحص وجوداً قائماً قبل الإنشاء ويعيد created:false
    expect(s).toMatch(/created: false/);
    expect(s).toMatch(/created: true/);
    // عضو واحد فقط: INSERT عضو واحد بلا حلقة أعضاء
    expect(s).toMatch(/INSERT INTO conversation_members \(conversation_id, user_id, role, joined_at\) VALUES \(\?, \?, 'owner', \?\)/);
  });

  it('db.js: جدول poll_votes بفهرس وتحقق نطاق 0..9 + زنادان يمسحان الأصوات', () => {
    const d = dbSrc();
    expect(d).toMatch(/CREATE TABLE IF NOT EXISTS poll_votes/);
    expect(d).toMatch(/option_index INTEGER NOT NULL CHECK\(option_index >= 0 AND option_index <= 9\)/);
    expect(d).toMatch(/idx_poll_votes_msg/);
    expect(d).toMatch(/DELETE FROM poll_votes WHERE message_id = OLD\.id/);
    expect(d).toMatch(/DELETE FROM poll_votes WHERE message_id = NEW\.id/);
  });

  it('الواجهة: مؤلّف الاستطلاع يشفّر السؤال والخيارات كصندوق واحد E2EE بنوع poll', () => {
    const a = appSrc();
    expect(htmlSrc()).toMatch(/id="poll-btn"/);
    expect(a).toMatch(/\$\("poll-btn"\)\?\.addEventListener\("click"/);
    expect(a).toMatch(/\$\("poll-form"\)\?\.addEventListener\("submit"/);
    expect(a).toMatch(/RasanCrypto\.encrypt\(state\.activeKey, JSON\.stringify\(\{ kind: "poll", question, options \}\)\)/);
    expect(a).toMatch(/type: "poll"/);
  });

  it('الواجهة: بطاقة الاستطلاع + تصويت عبر PUT poll-vote + تحديث حي عبر message:poll-vote', () => {
    const a = appSrc();
    expect(a).toMatch(/function renderPollCard\(/);
    expect(a).toMatch(/function applyPollVoteUpdate\(/);
    expect(a).toMatch(/data-poll-for/);
    expect(a).toMatch(/\/api\/messages\/\$\{mid\}\/poll-vote/);
    expect(a).toMatch(/state\.socket\.on\("message:poll-vote"/);
    expect(a).toMatch(/_pollVotes: new Map\(\)/);
  });

  it('الواجهة: نافذة المؤلّف بحد أقصى 10 خيارات مطابقة لسقف الخادم', () => {
    expect(read('web/index.html')).toMatch(/id="poll-modal"/);
    expect(appSrc()).toMatch(/box\.children\.length >= 10/);
    expect(cssSrc()).toMatch(/\.poll-card/);
  });

  it('i18n: مفاتيح الاستطلاع موجودة في ar وen', () => {
    const i = i18nSrc();
    expect(i).toMatch(/pollVotes:"أصوات"/);
    expect(i).toMatch(/pollVotes:"votes"/);
    expect(i).toMatch(/pollNeedsMore/);
  });

  it('الواجهة: رسائل محفوظة لنفسي — زر 🔖 يستدعي المسار المُكرِر ويفتح المحادثة', () => {
    const a = appSrc();
    expect(a).toMatch(/\$\("saved-btn"\)\?\.addEventListener\("click"/);
    expect(a).toMatch(/api\("\/api\/conversations\/self", \{ method: "POST" \}\)/);
    expect(htmlSrc()).toMatch(/id="saved-btn"/);
  });

  it('الواجهة: المسودات محلية فقط — تُستعاد عند الفتح وتُمسح عند الإرسال', () => {
    const a = appSrc();
    expect(a).toMatch(/function getDraft\(/);
    expect(a).toMatch(/function saveDraft\(/);
    expect(a).toMatch(/function clearDraft\(/);
    expect(a).toMatch(/localStorage\.setItem\("rasan_drafts"/);
    expect(a).toMatch(/\$\("msg-input"\)\.value = getDraft\(conv\.id\)/);
    expect(a).toMatch(/clearDraft\(state\.activeConv\.id\)/);
    expect(a).toMatch(/_draftTimer = setTimeout\(\(\) => saveDraft\(cid, val\), 300\)/);
  });
});
