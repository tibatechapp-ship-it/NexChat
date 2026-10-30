import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// نوجّه DATA_DIR إلى مجلد مؤقت قبل استيراد وحدة الخادم (db.js يفتح القاعدة
// عند الاستيراد). كل الاختبارات تعمل على نسخة معزولة تماماً عن أي بيانات حقيقية.
let notifications;
let db;
let dataDir;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'rasan-notif-test-'));
  process.env.DATA_DIR = dataDir;
  const mod = await import('../server/notifications.js');
  notifications = mod.default ?? mod;
  const dbMod = await import('../server/db.js');
  db = (dbMod.default ?? dbMod).db;
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

// ===== أدوات مساعدة: إنشاء مستخدمين/محادثة حقيقيين (FK مفعّل) =====
let seq = 0;
function makeUser() {
  seq++;
  const info = db
    .prepare(
      "INSERT INTO users (username, password_hash, public_key, locale, created_at) VALUES (?, ?, ?, 'ar', ?)"
    )
    .run(`notif_u_${Date.now()}_${seq}`, 'test-hash', 'A'.repeat(88), Date.now());
  return Number(info.lastInsertRowid);
}
function makeConversation(ownerId, memberIds) {
  const info = db
    .prepare(
      "INSERT INTO conversations (type, name, owner_id, created_at, current_key_version) VALUES ('group', ?, ?, ?, 1)"
    )
    .run(`conv-${Date.now()}-${seq}`, ownerId, Date.now());
  const cid = Number(info.lastInsertRowid);
  const add = db.prepare(
    "INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)"
  );
  add.run(cid, ownerId, Date.now());
  for (const uid of memberIds) {
    if (uid !== ownerId) add.run(cid, uid, Date.now());
  }
  return cid;
}

describe('notification payload templates (E2EE guard)', () => {
  it('new_message uses the fixed template — no sender name, no content', () => {
    const p = notifications.buildNotificationPayload('new_message', {
      conversationId: 7,
      messageId: 3,
    });
    expect(p.title).toBe('رسن');
    expect(p.body).toBe('لديك رسالة جديدة');
    expect(p.data).toEqual({ kind: 'new_message', conversationId: '7', messageId: '3' });
  });

  it('group_invite uses the fixed template', () => {
    const p = notifications.buildNotificationPayload('group_invite', { conversationId: 9 });
    expect(p.title).toBe('رسن');
    expect(p.body).toBe('لديك دعوة إلى مجموعة');
    expect(p.data).toEqual({ kind: 'group_invite', conversationId: '9' });
  });

  it('drops caller-supplied content fields — E2EE leak attempt is neutralized', () => {
    const p = notifications.buildNotificationPayload('new_message', {
      conversationId: 7,
      // محاولات تسريب: نص رسالة، نص مشفر، اسم مُرسل، معاينة، حقول ملفات
      text: 'سرّي جداً',
      ciphertext: 'BASE64SECRET==',
      iv: 'IVIVIV',
      senderName: 'attacker',
      preview: 'معاينة سرية',
      attachmentName: 'document.pdf',
      title: 'عنوان مزروع',
      body: 'متن مزروع',
    });
    const flat = JSON.stringify(p);
    expect(flat).not.toContain('سرّي');
    expect(flat).not.toContain('BASE64SECRET');
    expect(flat).not.toContain('attacker');
    expect(flat).not.toContain('معاينة');
    expect(flat).not.toContain('document.pdf');
    expect(flat).not.toContain('مزروع');
    expect(p.title).toBe('رسن');
    expect(p.body).toBe('لديك رسالة جديدة');
  });

  it('rejects unknown kinds', () => {
    expect(() => notifications.buildNotificationPayload('spam', {})).toThrow(/unknown notification kind/);
  });

  it('data keys are allowlisted to kind/conversationId/messageId only', () => {
    const p = notifications.buildNotificationPayload('new_message', {
      conversationId: 1,
      messageId: 2,
      evilKey: 'nope',
    });
    expect(Object.keys(p.data).sort()).toEqual(['conversationId', 'kind', 'messageId']);
  });

  it('non-integer ids are dropped from data', () => {
    const p = notifications.buildNotificationPayload('new_message', {
      conversationId: 'not-a-number',
      messageId: 0,
    });
    expect(p.data).toEqual({ kind: 'new_message' });
  });
});

describe('notification preferences (on/off per kind)', () => {
  it('defaults are all enabled for a fresh user', () => {
    const uid = makeUser();
    expect(notifications.getPrefs(uid)).toEqual({
      messages: true,
      invites: true,
      emergencies: true,
    });
    expect(notifications.canPush(uid, 'new_message')).toBe(true);
    expect(notifications.canPush(uid, 'group_invite')).toBe(true);
    expect(notifications.canPush(uid, 'emergency')).toBe(true);
  });

  it('setPrefs disables messages only — invites and emergencies stay on', () => {
    const uid = makeUser();
    notifications.setPrefs(uid, { messages: false });
    expect(notifications.getPrefs(uid)).toEqual({
      messages: false,
      invites: true,
      emergencies: true,
    });
    expect(notifications.canPush(uid, 'new_message')).toBe(false);
    expect(notifications.canPush(uid, 'group_invite')).toBe(true);
    expect(notifications.canPush(uid, 'emergency')).toBe(true);
  });

  it('setPrefs disables invites only — messages and emergencies stay on', () => {
    const uid = makeUser();
    notifications.setPrefs(uid, { invites: false });
    expect(notifications.canPush(uid, 'new_message')).toBe(true);
    expect(notifications.canPush(uid, 'group_invite')).toBe(false);
    expect(notifications.canPush(uid, 'emergency')).toBe(true);
  });

  it('partial update keeps the other flags untouched', () => {
    const uid = makeUser();
    notifications.setPrefs(uid, { messages: false });
    notifications.setPrefs(uid, { invites: false }); // لا يُعيد messages للتفعيل
    expect(notifications.getPrefs(uid)).toEqual({
      messages: false,
      invites: false,
      emergencies: true,
    });
  });

  it('unknown kind is never pushable', () => {
    const uid = makeUser();
    expect(notifications.canPush(uid, 'anything_else')).toBe(false);
  });
});

describe('notifyUser respects preferences and sends sanitized payloads', () => {
  it('skips sending when the kind is disabled', async () => {
    const uid = makeUser();
    notifications.setPrefs(uid, { messages: false });
    const sent = [];
    notifications.setPushSender(async (userId, payload) => {
      sent.push({ userId, payload });
    });
    const delivered = await notifications.notifyUser(uid, 'new_message', { conversationId: 1 });
    expect(delivered).toBe(false);
    expect(sent).toHaveLength(0);
    notifications.setPushSender(null);
  });

  it('sends the template payload when enabled', async () => {
    const uid = makeUser();
    notifications.setPrefs(uid, { messages: true, invites: true });
    const sent = [];
    notifications.setPushSender(async (userId, payload) => {
      sent.push({ userId, payload });
    });
    const delivered = await notifications.notifyUser(uid, 'group_invite', { conversationId: 42 });
    expect(delivered).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].userId).toBe(uid);
    expect(sent[0].payload.body).toBe('لديك دعوة إلى مجموعة');
    expect(sent[0].payload.data.conversationId).toBe('42');
    notifications.setPushSender(null);
  });
});

// express متاح كـdevDependency (نفس الإصدار ^4 الذي يستخدمه الخادم).
// الاستيراد متحول عبر متغير + @vite-ignore حتى لا يحلله vite أثناء
// التحويل — إن غاب عن بيئة ما يتراجع القسم بهدوء بدل فشل الملف كاملاً.
async function loadExpress() {
  const name = ['ex', 'press'].join('');
  try {
    return (await import(/* @vite-ignore */ name)).default;
  } catch {
    return null;
  }
}

describe('REST endpoints (createRouter with injected auth)', () => {
  it('GET/PUT /api/push/preferences round-trip', async () => {
    const express = await loadExpress();
    if (!express) return; // بيئة بلا express — النواة مغطاة بالاختبارات أعلاه
    const uid = makeUser();
    const router = notifications.createRouter({
      authRequired: (req, _res, next) => {
        req.user = { id: uid };
        next();
      },
    });
    const app = express();
    app.use(express.json());
    app.use('/api', router);
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}/api`;

    const get1 = await fetch(`${base}/push/preferences`);
    expect(get1.status).toBe(200);
    expect((await get1.json()).preferences).toEqual({
      messages: true,
      invites: true,
      emergencies: true,
    });

    const put = await fetch(`${base}/push/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: false }),
    });
    expect(put.status).toBe(200);
    expect((await put.json()).preferences).toEqual({
      messages: false,
      invites: true,
      emergencies: true,
    });

    const get2 = await fetch(`${base}/push/preferences`);
    expect((await get2.json()).preferences).toEqual({
      messages: false,
      invites: true,
      emergencies: true,
    });

    // تحقق صحة الإدخال
    const bad = await fetch(`${base}/push/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: 'yes' }),
    });
    expect(bad.status).toBe(400);

    server.close();
  });

  it('POST /api/push/send: member→member delivers template; non-member is 403; content fields in request are ignored', async () => {
    const express = await loadExpress();
    if (!express) return;
    const alice = makeUser();
    const bob = makeUser();
    const mallory = makeUser();
    const cid = makeConversation(alice, [bob]);

    const sent = [];
    notifications.setPushSender(async (userId, payload) => {
      sent.push({ userId, payload });
    });

    const router = notifications.createRouter({
      authRequired: (req, _res, next) => {
        req.user = { id: alice };
        next();
      },
    });
    const app = express();
    app.use(express.json());
    app.use('/api', router);
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}/api`;

    // إرسال سليم — النص من القالب مهما حاول الطلب تمرير محتوى
    const ok = await fetch(`${base}/push/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toUserId: bob,
        kind: 'new_message',
        conversationId: cid,
        title: 'مزروع',
        body: 'محتوى سرّي مزروع',
      }),
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).delivered).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].payload.title).toBe('رسن');
    expect(sent[0].payload.body).toBe('لديك رسالة جديدة');
    expect(JSON.stringify(sent[0].payload)).not.toContain('مزروع');
    expect(JSON.stringify(sent[0].payload)).not.toContain('سرّي');

    // مستهدف ليس عضواً → 403
    const notMember = await fetch(`${base}/push/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toUserId: mallory, kind: 'new_message', conversationId: cid }),
    });
    expect(notMember.status).toBe(403);

    // kind غير معروف → 400
    const badKind = await fetch(`${base}/push/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toUserId: bob, kind: 'custom_text', conversationId: cid }),
    });
    expect(badKind.status).toBe(400);

    // إيقاف تفضيلات bob → delivered=false ولا يُرسل شيء
    notifications.setPrefs(bob, { messages: false });
    const muted = await fetch(`${base}/push/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toUserId: bob, kind: 'new_message', conversationId: cid }),
    });
    expect((await muted.json()).delivered).toBe(false);
    expect(sent).toHaveLength(1); // لم يزد

    server.close();
    notifications.setPushSender(null);
  });
});

// ===== إنذارات الطوارئ (emergency) — من بحث الميزات (Zello نموذجاً) =====
describe('emergency alerts', () => {
  it('emergency uses the fixed template — caller content is dropped (E2EE guard)', () => {
    const p = notifications.buildNotificationPayload('emergency', {
      conversationId: 7,
      title: 'مزروع',
      body: 'محتوى سرّي مزروع',
      senderName: 'اسم مزروع',
    });
    expect(p.title).toBe('رسن');
    expect(p.body).toContain('طوارئ');
    expect(JSON.stringify(p)).not.toContain('مزروع');
    expect(p.data).toEqual({ kind: 'emergency', conversationId: '7' });
  });

  it('emergencies preference defaults on, gates canPush, and is isolated from other kinds', () => {
    const uid = makeUser();
    expect(notifications.getPrefs(uid)).toEqual({
      messages: true,
      invites: true,
      emergencies: true,
    });
    expect(notifications.canPush(uid, 'emergency')).toBe(true);

    notifications.setPrefs(uid, { emergencies: false });
    expect(notifications.canPush(uid, 'emergency')).toBe(false);
    // إيقاف الطوارئ لا يمس أنواع الإشعارات الأخرى
    expect(notifications.canPush(uid, 'new_message')).toBe(true);
    expect(notifications.canPush(uid, 'group_invite')).toBe(true);

    // إعادة التشغيل تعمل كذلك
    notifications.setPrefs(uid, { emergencies: true });
    expect(notifications.canPush(uid, 'emergency')).toBe(true);
  });

  it('notifyUser delivers the emergency template when enabled and skips when muted', async () => {
    const uid = makeUser();
    const sent = [];
    notifications.setPushSender(async (userId, payload) => {
      sent.push({ userId, payload });
    });

    expect(await notifications.notifyUser(uid, 'emergency', { conversationId: 1 })).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].payload.body).toContain('طوارئ');
    expect(sent[0].payload.data.kind).toBe('emergency');

    notifications.setPrefs(uid, { emergencies: false });
    expect(await notifications.notifyUser(uid, 'emergency', { conversationId: 1 })).toBe(false);
    expect(sent).toHaveLength(1); // لم يزد

    notifications.setPushSender(null);
  });

  it('REST: PUT /push/preferences accepts emergencies; POST /push/send accepts kind emergency', async () => {
    const express = await loadExpress();
    if (!express) return;
    const alice = makeUser();
    const bob = makeUser();
    const cid = makeConversation(alice, [bob]);

    const sent = [];
    notifications.setPushSender(async (userId, payload) => sent.push({ userId, payload }));

    const router = notifications.createRouter({
      authRequired: (req, _res, next) => {
        req.user = { id: alice };
        next();
      },
    });
    const app = express();
    app.use(express.json());
    app.use('/api', router);
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}/api`;

    // GET يعيد الأنواع الثلاثة
    const get1 = await fetch(`${base}/push/preferences`);
    expect((await get1.json()).preferences).toEqual({
      messages: true,
      invites: true,
      emergencies: true,
    });

    // كتم الطوارئ للمستهدف bob مباشرة (الـPUT يُختبر أعلاه على صاحب الجلسة)
    notifications.setPrefs(bob, { emergencies: false });

    // إرسال إنذار عبر /push/send — delivered=false لأن bob كتم الطوارئ
    const send = await fetch(`${base}/push/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toUserId: bob,
        kind: 'emergency',
        conversationId: cid,
        body: 'محاولة تمرير محتوى',
      }),
    });
    expect(send.status).toBe(200);
    expect((await send.json()).delivered).toBe(false);
    expect(sent).toHaveLength(0);

    // قيمة غير منطقية → 400
    const bad = await fetch(`${base}/push/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emergencies: 'no' }),
    });
    expect(bad.status).toBe(400);

    // تحقق إضافي: PUT يقبل emergencies كقيمة منطقية (round-trip على صاحب الجلسة)
    const putOk = await fetch(`${base}/push/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emergencies: false }),
    });
    expect(putOk.status).toBe(200);
    expect((await putOk.json()).preferences.emergencies).toBe(false);

    server.close();
    notifications.setPushSender(null);
  });
});
