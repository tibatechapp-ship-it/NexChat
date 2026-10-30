// groupcalls.test.js — المكالمات الجماعية (WebRTC mesh — يكمل بحث الميزات P1:
// "مكالمات المجموعات متعددة الأطراف"). طبقتان:
//
// 1) تشغيلية على الحالة النقية (server/groupcalls.js _internal): إنشاء الغرفة
//    والسقف 8 والحذف والتفرغ والانضمام المكرر — هذه الرياضيات التي تضمن عدم
//    تسريب مقاعد أو مقابس معلقة.
// 2) عقد على مصدر server.js: التسجيل السليم للوحدة مع callBusy بالمرجع،
//    وفحص العضوية/النوع (لا dm)، وعدم التعديل في مسار المكالمات الثنائية
//    (اختبارات calls.test.js تبقى كما هي)، واختبار calls.test.js نفسه يبقى
//    أخضر — دليل عدم الكسر.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('حالة المكالمة الجماعية النقية (groupcalls._internal)', () => {
  const g = require('../server/groupcalls.js')._internal();

  it('أول منضمّ يفتح الغرفة ويصبح بادئها، والانضمام المكرر يُرفض بلا تأثير', () => {
    const r1 = g.addParticipant(9001, 1, 'alice');
    expect(r1.ok).toBe(true);
    expect(g.getRoom(9001).startedBy).toBe(1);
    const r2 = g.addParticipant(9001, 1, 'alice');
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe('already_in');
    expect(g.getRoom(9001).participants.size).toBe(1); // لا مقعد مكرر
    g.removeParticipant(9001, 1);
  });

  it('سقف المشاركين 8 — التاسع يُرفض بـfull ولا يُسجَّل', () => {
    expect(require('../server/groupcalls.js').GROUP_CALL_MAX).toBe(8);
    const convId = 9002;
    for (let i = 1; i <= 8; i++) expect(g.addParticipant(convId, i, `u${i}`).ok).toBe(true);
    const over = g.addParticipant(convId, 99, 'late');
    expect(over.ok).toBe(false);
    expect(over.reason).toBe('full');
    expect(g.getRoom(convId).participants.size).toBe(8);
    for (let i = 1; i <= 8; i++) g.removeParticipant(convId, i);
  });

  it('خروج المشاركين يحذف الغرفة عند التفرغ (لا غرف يتيمة في الذاكرة)', () => {
    const convId = 9003;
    g.addParticipant(convId, 1, 'a');
    g.addParticipant(convId, 2, 'b');
    let r = g.removeParticipant(convId, 1);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(1);
    expect(g.getRoom(convId)).not.toBeNull();
    r = g.removeParticipant(convId, 2);
    expect(r.emptied).toBe(true);
    expect(g.getRoom(convId)).toBeNull(); // حُذفت
    expect(g.removeParticipant(convId, 2).ok).toBe(false); // خروج مكرر بلا غرفة
  });

  it('bothInCall: الإشارة لا تمر إلا بين مشاركين في نفس الغرفة (لا توجيه عابر)', () => {
    const c1 = 9004, c2 = 9005;
    g.addParticipant(c1, 1, 'a');
    g.addParticipant(c1, 2, 'b');
    g.addParticipant(c2, 3, 'c');
    expect(g.bothInCall(c1, 1, 2)).toBe(true);
    expect(g.bothInCall(c1, 1, 3)).toBe(false); // 3 في غرفة أخرى
    expect(g.bothInCall(c2, 1, 3)).toBe(false);
    expect(g.bothInCall(99999, 1, 1)).toBe(false);
    g.removeParticipant(c1, 1); g.removeParticipant(c1, 2); g.removeParticipant(c2, 3);
  });

  it('لقطة المشاركين معرّفات وأسماء فقط — لا تفاصيل داخلية تسرب للبث', () => {
    const convId = 9006;
    g.addParticipant(convId, 1, 'alice');
    g.addParticipant(convId, 2, 'bob');
    const snap = g.participantsSnapshot(g.getRoom(convId));
    expect(snap).toEqual([{ userId: 1, name: 'alice' }, { userId: 2, name: 'bob' }]);
    g.removeParticipant(convId, 1); g.removeParticipant(convId, 2);
  });
});

describe('عقد الإشارات في server.js — تكامل بلا كسر', () => {
  const server = read('server/server.js');
  const mod = read('server/groupcalls.js');

  it('الوحدة مسجلة داخل قسم المكالمات الثنائية مع تمرير callBusy بالمرجع', () => {
    const start = server.indexOf('// ===== Calls');
    const end = server.indexOf('// ===== Stories');
    const section = server.slice(start, end);
    expect(section).toMatch(/groupcalls\.init\(io, \{ callBusy \}\)/);
  });

  it('الانضمام خلف فحص عضوية + نوع المحادثة (المجموعات والقنوات فقط — لا dm)', () => {
    expect(mod).toMatch(/socket\.on\("groupcall:start"/);
    expect(mod).toMatch(/!isMemberOf\(convId, uid\)/);
    expect(mod).toMatch(/conv\.type === "dm"/);
    expect(mod).toMatch(/groupcall:error", \{ reason: "forbidden" \}/);
  });

  it('المستخدم في مكالمة ثنائية يُرد عليه call:busy من مسار الانشغال القائم', () => {
    expect(mod).toMatch(/if \(callBusyRef\.has\(uid\)\) \{ socket\.emit\("call:busy", \{\}\); return; \}/);
    // وعكسه: الجماعية تضع callBusy بلا peer كي يراه مسار الثنائية
    expect(mod).toMatch(/callBusyRef\.set\(uid, \{ peer: null, conversationId: convId, group: true \}\)/);
  });

  it('سقوف SDP/ICE مطابقة للمكالمات الثنائية + محدد معدل مستقل', () => {
    expect(require('../server/groupcalls.js').GC_SDP_BYTES).toBe(32768);
    expect(require('../server/groupcalls.js').GC_ICE_BYTES).toBe(2048);
    expect(mod).toMatch(/Buffer\.byteLength\(sdp, "utf8"\) > GC_SDP_BYTES/);
    expect(mod).toMatch(/Buffer\.byteLength\(candidate, "utf8"\) > GC_ICE_BYTES/);
    expect(mod).toMatch(/GC_RATE_WINDOW_MS = 10000/);
    expect(mod).toMatch(/if \(!rateOk\(\)\) return;/);
  });

  it('كل إشارة gcall:* تتطلب مشاركة فعليّة في نفس الغرفة (لا توجيه من متسلل)', () => {
    for (const ev of ['gcall:offer', 'gcall:answer', 'gcall:ice']) {
      const idx = mod.indexOf(`socket.on("${ev}"`);
      expect(idx).toBeGreaterThan(-1);
      const body = mod.slice(idx, idx + 800);
      expect(body).toMatch(/bothInCall\(convId, uid, to\)/);
    }
  });

  it('بلا تخزين إطلاقاً — وحدة المكالمات الجماعية لا تكتب في قاعدة البيانات', () => {
    expect(mod).not.toMatch(/INSERT INTO|UPDATE |DELETE FROM/i);
  });

  it('الانقطاع ينظّف مقعد المستخدم من الغرفة ويلغي انشغاله الجماعي', () => {
    expect(mod).toMatch(/socket\.on\("disconnect", \(\) => cleanupUser\(io, uid\)\)/);
    expect(mod).toMatch(/if \(busy && busy\.group\) callBusyRef\.delete\(uid\)/);
  });

  it('مسار المكالمات الثنائية في server.js لم يُعدَّل — اختبارات calls.test.js تظل صحيحة', () => {
    // نفس التأكيدات الجوهرية في calls.test.js ما تزال تنطبق حرفياً
    expect(server).toMatch(/const callBusy = new Map\(\)/);
    expect(server).toMatch(/if \(callBusy\.has\(uid\)\) return;/);
  });
});
