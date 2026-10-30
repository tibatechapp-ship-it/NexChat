// calls.test.js — عقد إشارات المكالمات (WebRTC) في الخادم (server.js).
//
// مكالمات صوت/مرئي (من بحث الميزات P1 — نمط Meshenger/Zello): الوسائط تسير
// طرف-لطرف مشفّرة DTLS-SRTP، والخادم موجّه إشارات فقط. الضمانات هنا:
// 1. العرض خلف فحص عضوية صريح للطرفين في نفس المحادثة (لا اتصال عابراً).
// 2. تتبع انشغال بالـ userId — عرض واحد لكل مستخدم، والطرف المشغول يرد busy.
// 3. سقوف صارمة على أحجام SDP/ICE ومحدد معدل مستقل عن الرسائل.
// 4. إجابة/ICE/إنهاء/رفض تتطلب اقتراناً قائماً — لا توجيه من متسلل.
// 5. بلا تخزين إطلاقاً: قسم المكالمات لا يكتب شيئاً في قاعدة البيانات.
// 6. انقطاع أحد الطرفين ينظّف الاقتران ويبلّغ الآخر.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('call signaling contract (server.js)', () => {
  const server = read('server/server.js');

  const callSection = (() => {
    const start = server.indexOf('// ===== Calls');
    const end = server.indexOf('// ===== Stories');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return server.slice(start, end);
  })();

  it('offers are membership-checked on BOTH sides of the same conversation', () => {
    expect(server).toMatch(/socket\.on\("call:offer"/);
    expect(server).toMatch(
      /!isMemberOf\(convId, uid\) \|\| !isMemberOf\(convId, toUserId\)/
    );
    expect(server).toMatch(/socket\.emit\("call:error", \{ reason: "forbidden" \}\)/);
  });

  it('tracks busy state per user and refuses double-calls with call:busy', () => {
    expect(server).toMatch(/const callBusy = new Map\(\)/);
    expect(server).toMatch(/if \(callBusy\.has\(uid\)\) return;/);
    expect(server).toMatch(/if \(callBusy\.has\(toUserId\)\) \{ socket\.emit\("call:busy"/);
  });

  it('emits call:unavailable when the callee has no connected socket', () => {
    expect(server).toMatch(/socket\.emit\("call:unavailable", \{\}\)/);
  });

  it('caps SDP at 32KB and ICE candidates at 2KB with byte-length checks', () => {
    expect(server).toMatch(/MAX_SDP_BYTES = 32768/);
    expect(server).toMatch(/MAX_ICE_BYTES = 2048/);
    expect(server).toMatch(
      /Buffer\.byteLength\(sdp, "utf8"\) > MAX_SDP_BYTES/
    );
    expect(server).toMatch(
      /Buffer\.byteLength\(candidate, "utf8"\) > MAX_ICE_BYTES/
    );
  });

  it('rate-limits call signaling independently of message rate', () => {
    expect(server).toMatch(/CALL_RATE_WINDOW_MS = 10000/);
    expect(server).toMatch(/CALL_RATE_MAX = 120/);
    expect(server).toMatch(/if \(!checkCallRate\(\)\) return;/);
  });

  it('answer/ice/end/reject require an existing call pairing (no hijack)', () => {
    // كل معالج يبدأ بالتحقق من اقتران الطرفين قبل أي توجيه
    const handlers = ['call:answer', 'call:ice', 'call:end', 'call:reject'];
    for (const ev of handlers) {
      const idx = server.indexOf(`socket.on("${ev}"`);
      expect(idx).toBeGreaterThan(-1);
      const body = server.slice(idx, idx + 700);
      expect(body).toMatch(/busy\.peer !== toUserId/);
    }
  });

  it('end/reject always clear the pairing (no orphan busy state)', () => {
    const endIdx = server.indexOf('socket.on("call:end"');
    const rejectIdx = server.indexOf('socket.on("call:reject"');
    expect(server.slice(endIdx, endIdx + 400)).toMatch(/clearCallPair\(uid, toUserId\)/);
    expect(server.slice(rejectIdx, rejectIdx + 400)).toMatch(/clearCallPair\(uid, toUserId\)/);
  });

  it('disconnect cleans up the call and notifies the peer with a reason', () => {
    const discIdx = server.indexOf('socket.on("disconnect"');
    const body = server.slice(discIdx, discIdx + 600);
    expect(body).toMatch(/callBusy\.get\(uid\)/);
    expect(body).toMatch(/clearCallPair\(uid, busy\.peer\)/);
    expect(body).toMatch(/reason: "disconnect"/);
  });

  it('never persists call data — the signaling section writes nothing to the DB', () => {
    expect(callSection).not.toMatch(/INSERT INTO/i);
    expect(callSection).not.toMatch(/UPDATE |DELETE FROM/i);
  });

  it('relays the offer to every socket of the callee (multi-device ring)', () => {
    expect(server).toMatch(/const targets = userSockets\(toUserId\)/);
    expect(server).toMatch(
      /target\.emit\("call:offer", \{ from: uid, fromName: socket\.user\.username, conversationId: convId, sdp, video: !!video \}\)/
    );
  });
});
