import { describe, it, expect, beforeEach } from 'vitest';
import {
  genIdentityKeypair,
  signEphemeral,
  verifyEphemeral,
  tofuCheck,
  storePeer,
  getPeer,
  generateSafetyNumber,
  qrPayload,
  parseQR,
} from '../web/identity.js';

async function makePeer(peerId) {
  const kp = await genIdentityKeypair();
  return { peerId, keypair: kp, publicB64: kp.publicKey };
}

describe('generateSafetyNumber', () => {
  it('يعطي نفس الرقم من كلا الطرفين (تناظر)', async () => {
    const A = await makePeer('alice');
    const B = await makePeer('bob');
    const ab = await generateSafetyNumber(A.publicB64, B.publicB64);
    const ba = await generateSafetyNumber(B.publicB64, A.publicB64);
    expect(ab).toBe(ba);
  });

  it('ينتج 12 مجموعة × 5 أرقام = 60 رقماً', async () => {
    const A = await makePeer('alice');
    const B = await makePeer('bob');
    const sn = await generateSafetyNumber(A.publicB64, B.publicB64);
    const digits = sn.replace(/\s/g, '');
    expect(digits).toMatch(/^\d{60}$/);
    const groups = sn.split(/\s/);
    expect(groups.length).toBe(12);
    groups.forEach(g => expect(g).toMatch(/^\d{5}$/));
  });

  it('يختلف الرقم عند تغيير مفتاح أحد الطرفين', async () => {
    const A = await makePeer('alice');
    const B = await makePeer('bob');
    const C = await makePeer('mallory');
    const ab = await generateSafetyNumber(A.publicB64, B.publicB64);
    const ac = await generateSafetyNumber(A.publicB64, C.publicB64);
    expect(ab).not.toBe(ac);
  });
});

describe('ephemeral signing', () => {
  it('round-trip: توقيع صحيح يُقبل', async () => {
    const A = await makePeer('alice');
    const ephemeral = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']
    );
    const ephRaw = await crypto.subtle.exportKey('spki', ephemeral.publicKey);
    const ephB64 = btoa(String.fromCharCode(...new Uint8Array(ephRaw)));
    const sig = await signEphemeral(A.keypair.privateKey, ephB64);
    const ok = await verifyEphemeral(A.keypair.publicKey, ephB64, sig);
    expect(ok).toBe(true);
  });

  it('يرفض توقيعاً بمفتاح مختلف (MITM على التوقيع)', async () => {
    const A = await makePeer('alice');
    const M = await makePeer('mallory');
    const eph = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']
    );
    const ephB64 = btoa(String.fromCharCode(...new Uint8Array(
      await crypto.subtle.exportKey('spki', eph.publicKey)
    )));
    const sig = await signEphemeral(M.keypair.privateKey, ephB64);
    const ok = await verifyEphemeral(A.keypair.publicKey, ephB64, sig);
    expect(ok).toBe(false);
  });
});

describe('TOFU store', () => {
  it("peer جديد يُرجع 'new'", async () => {
    const B = await makePeer('bob1');
    const status = await tofuCheck('bob_new_' + Date.now(), B.publicB64);
    expect(status).toBe('new');
  });

  it("نفس المفتاح يُرجع 'same'", async () => {
    const B = await makePeer('bob2');
    const id = 'bob_same_' + Date.now();
    await storePeer(id, B.publicB64);
    const status = await tofuCheck(id, B.publicB64);
    expect(status).toBe('same');
  });

  it("🚨 MITM: مفتاح مختلف يُرجع 'changed'", async () => {
    const B = await makePeer('bob3');
    const M = await makePeer('mallory3');
    const id = 'bob_mitm_' + Date.now();
    await storePeer(id, B.publicB64);
    const status = await tofuCheck(id, M.publicB64);
    expect(status).toBe('changed');

    const stored = await getPeer(id);
    expect(stored.identityPub).toBe(B.publicB64);
  });
});

describe('QR payload', () => {
  it('round-trip: {v,u,k} يُستعاد كما هو', async () => {
    const A = await makePeer('alice');
    const payload = qrPayload('alice', A.publicB64);
    const parsed = parseQR(payload);
    expect(parsed.userId).toBe('alice');
    expect(parsed.identityPub).toBe(A.publicB64);
  });

  it('لا يحتوي على المفتاح الخاص', async () => {
    const A = await makePeer('alice');
    const payload = qrPayload('alice', A.publicB64);
    const raw = JSON.stringify(payload).toLowerCase();
    expect(raw).not.toContain('private');
    expect(raw).not.toContain('pkcs8');
  });

  it('يرفض بيانات غير صالحة', () => {
    expect(parseQR('not-json')).toBeNull();
    expect(parseQR(JSON.stringify({ v: 2, u: 'x', k: 'y' }))).toBeNull();
    expect(parseQR(JSON.stringify({ v: 1, u: 'x' }))).toBeNull();
  });
});
