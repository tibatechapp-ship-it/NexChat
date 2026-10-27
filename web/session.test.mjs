import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.window = globalThis;
await import('./identity.js');
await import('./session.js');
const S = globalThis.RasanSession;
const I = globalThis.RasanIdentity;

test("initSession generates unique ephemeral key per session", async () => {
  const kp = await I.genIdentityKeypair();
  const s1 = await S.initSession(kp.privateKey, kp.publicKey, kp.publicKey);
  const s2 = await S.initSession(kp.privateKey, kp.publicKey, kp.publicKey);
  assert.notEqual(s1.ephPubB64, s2.ephPubB64, "ephemeral keys must differ");
  assert.ok(s1.signature, "signature present");
});

test("deriveSessionKey verifies signature and produces a key", async () => {
  const alice = await I.genIdentityKeypair();
  const bob = await I.genIdentityKeypair();

  const aliceSession = await S.initSession(alice.privateKey, alice.publicKey, bob.publicKey);
  const bobSession = await S.initSession(bob.privateKey, bob.publicKey, alice.publicKey);

  const skA = await S.deriveSessionKey(aliceSession, bobSession.ephPubB64, bobSession.signature, bob.publicKey);
  const skB = await S.deriveSessionKey(bobSession, aliceSession.ephPubB64, aliceSession.signature, alice.publicKey);

  // Both should derive the same shared secret (test by encrypt/decrypt round-trip)
  const ct = await S.encrypt(skA, "hello", null);
  const pt = await S.decrypt(skB, ct.ciphertext, ct.iv, null);
  assert.equal(pt, "hello");
});

test("MITM: invalid signature throws", async () => {
  const alice = await I.genIdentityKeypair();
  const bob = await I.genIdentityKeypair();
  const mallory = await I.genIdentityKeypair();

  const aliceSession = await S.initSession(alice.privateKey, alice.publicKey, bob.publicKey);
  const bobSession = await S.initSession(bob.privateKey, bob.publicKey, alice.publicKey);

  // mallory signs bob's ephemeral with her own key
  const badSig = await I.signEphemeral(mallory.privateKey, bobSession.ephPubB64);

  await assert.rejects(
    () => S.deriveSessionKey(aliceSession, bobSession.ephPubB64, badSig, bob.publicKey),
    /MITM/
  );
});

test("AAD: replay with wrong msgIndex fails decrypt", async () => {
  const alice = await I.genIdentityKeypair();
  const bob = await I.genIdentityKeypair();

  const aliceSession = await S.initSession(alice.privateKey, alice.publicKey, bob.publicKey);
  const bobSession = await S.initSession(bob.privateKey, bob.publicKey, alice.publicKey);

  const skA = await S.deriveSessionKey(aliceSession, bobSession.ephPubB64, bobSession.signature, bob.publicKey);
  const skB = await S.deriveSessionKey(bobSession, aliceSession.ephPubB64, aliceSession.signature, alice.publicKey);

  const aad1 = S.buildAAD("alice-fp", "bob-fp", 0, "conv-1");
  const ct = await S.encrypt(skA, "msg0", aad1);

  // replay with msgIndex 1 (wrong) should fail
  const aad2 = S.buildAAD("alice-fp", "bob-fp", 1, "conv-1");
  await assert.rejects(
    () => S.decrypt(skB, ct.ciphertext, ct.iv, aad2),
    /OperationError|decrypt/i
  );
});

test("AAD: wrong sender fingerprint fails decrypt", async () => {
  const alice = await I.genIdentityKeypair();
  const bob = await I.genIdentityKeypair();

  const aliceSession = await S.initSession(alice.privateKey, alice.publicKey, bob.publicKey);
  const bobSession = await S.initSession(bob.privateKey, bob.publicKey, alice.publicKey);

  const skA = await S.deriveSessionKey(aliceSession, bobSession.ephPubB64, bobSession.signature, bob.publicKey);
  const skB = await S.deriveSessionKey(bobSession, aliceSession.ephPubB64, aliceSession.signature, alice.publicKey);

  const aad1 = S.buildAAD("alice-fp", "bob-fp", 0, "conv-1");
  const ct = await S.encrypt(skA, "msg", aad1);

  const aadBad = S.buildAAD("mallory-fp", "bob-fp", 0, "conv-1");
  await assert.rejects(
    () => S.decrypt(skB, ct.ciphertext, ct.iv, aadBad),
    /OperationError|decrypt/i
  );
});

test("endSession nulls all key material", async () => {
  const alice = await I.genIdentityKeypair();
  const s = await S.initSession(alice.privateKey);
  const bob = await I.genIdentityKeypair();
  const bobS = await S.initSession(bob.privateKey);
  await S.deriveSessionKey(s, bobS.ephPubB64, bobS.signature, bob.publicKey);

  assert.ok(s.sessionKey, "session key exists before end");
  assert.ok(s.myEph, "ephemeral exists before end");

  await S.endSession(s);

  assert.equal(s.sessionKey, null, "sessionKey nulled");
  assert.equal(s.myEph, null, "myEph nulled");
  assert.equal(s.ephPubB64, null, "ephPubB64 nulled");
  assert.equal(s.signature, null, "signature nulled");
});

test("sameEphemeral detects identical ephemeral keys (should not happen)", async () => {
  const alice = await I.genIdentityKeypair();
  const s1 = await S.initSession(alice.privateKey);
  const s2 = { ...s1 }; // same eph
  assert.equal(S.sameEphemeral(s1, s2), true);
  const s3 = await S.initSession(alice.privateKey);
  assert.equal(S.sameEphemeral(s1, s3), false);
});
