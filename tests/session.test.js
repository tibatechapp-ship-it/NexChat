import { describe, it, expect, beforeEach } from 'vitest';
import * as identity from '../web/identity.js';
import * as session from '../web/session.js';

describe('session ephemeral keys', () => {
  it('generates unique ephemeral key per session', async () => {
    const kp = await identity.genIdentityKeypair();
    const s1 = await session.initSession(kp.privateKey);
    const s2 = await session.initSession(kp.privateKey);
    expect(s1.ephPubB64).not.toBe(s2.ephPubB64);
    expect(s1.signature).toBeTruthy();
  });

  it('derives shared session key (encrypt/decrypt round-trip)', async () => {
    const alice = await identity.genIdentityKeypair();
    const bob = await identity.genIdentityKeypair();

    const aliceSession = await session.initSession(alice.privateKey);
    const bobSession = await session.initSession(bob.privateKey);

    const skA = await session.deriveSessionKey(aliceSession, bobSession.ephPubB64, bobSession.signature, bob.publicKey);
    const skB = await session.deriveSessionKey(bobSession, aliceSession.ephPubB64, aliceSession.signature, alice.publicKey);

    const ct = await session.encrypt(skA, 'hello', null);
    const pt = await session.decrypt(skB, ct.ciphertext, ct.iv, null);
    expect(pt).toBe('hello');
  });

  it('MITM: invalid signature throws', async () => {
    const alice = await identity.genIdentityKeypair();
    const bob = await identity.genIdentityKeypair();
    const mallory = await identity.genIdentityKeypair();

    const aliceSession = await session.initSession(alice.privateKey);
    const bobSession = await session.initSession(bob.privateKey);

    const badSig = await identity.signEphemeral(mallory.privateKey, bobSession.ephPubB64);

    await expect(
      session.deriveSessionKey(aliceSession, bobSession.ephPubB64, badSig, bob.publicKey)
    ).rejects.toThrow(/MITM/);
  });

  it('AAD: replay with wrong msgIndex fails decrypt', async () => {
    const alice = await identity.genIdentityKeypair();
    const bob = await identity.genIdentityKeypair();

    const aliceSession = await session.initSession(alice.privateKey);
    const bobSession = await session.initSession(bob.privateKey);

    const skA = await session.deriveSessionKey(aliceSession, bobSession.ephPubB64, bobSession.signature, bob.publicKey);
    const skB = await session.deriveSessionKey(bobSession, aliceSession.ephPubB64, aliceSession.signature, alice.publicKey);

    const aad1 = session.buildAAD('alice-fp', 'bob-fp', 0, 'conv-1');
    const ct = await session.encrypt(skA, 'msg0', aad1);

    const aad2 = session.buildAAD('alice-fp', 'bob-fp', 1, 'conv-1');
    await expect(
      session.decrypt(skB, ct.ciphertext, ct.iv, aad2)
    ).rejects.toThrow();
  });

  it('AAD: wrong sender fingerprint fails decrypt', async () => {
    const alice = await identity.genIdentityKeypair();
    const bob = await identity.genIdentityKeypair();

    const aliceSession = await session.initSession(alice.privateKey);
    const bobSession = await session.initSession(bob.privateKey);

    const skA = await session.deriveSessionKey(aliceSession, bobSession.ephPubB64, bobSession.signature, bob.publicKey);
    const skB = await session.deriveSessionKey(bobSession, aliceSession.ephPubB64, aliceSession.signature, alice.publicKey);

    const aad1 = session.buildAAD('alice-fp', 'bob-fp', 0, 'conv-1');
    const ct = await session.encrypt(skA, 'msg', aad1);

    const aadBad = session.buildAAD('mallory-fp', 'bob-fp', 0, 'conv-1');
    await expect(
      session.decrypt(skB, ct.ciphertext, ct.iv, aadBad)
    ).rejects.toThrow();
  });

  it('endSession nulls all key material', async () => {
    const alice = await identity.genIdentityKeypair();
    const bob = await identity.genIdentityKeypair();

    const s = await session.initSession(alice.privateKey);
    const bobS = await session.initSession(bob.privateKey);
    await session.deriveSessionKey(s, bobS.ephPubB64, bobS.signature, bob.publicKey);

    expect(s.sessionKey).toBeTruthy();
    expect(s.myEph).toBeTruthy();

    await session.endSession(s);

    expect(s.sessionKey).toBeNull();
    expect(s.myEph).toBeNull();
    expect(s.ephPubB64).toBeNull();
    expect(s.signature).toBeNull();
  });

  it('sameEphemeral detects identical ephemeral keys', async () => {
    const alice = await identity.genIdentityKeypair();
    const s1 = await session.initSession(alice.privateKey);
    const s2 = { ...s1 };
    expect(session.sameEphemeral(s1, s2)).toBe(true);
    const s3 = await session.initSession(alice.privateKey);
    expect(session.sameEphemeral(s1, s3)).toBe(false);
  });
});
