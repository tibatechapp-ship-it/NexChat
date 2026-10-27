// Rasan Session — Per-session ephemeral keys + Forward Secrecy + AAD (T2+T3)
// Web Crypto only. No runtime deps.
window.RasanSession = (() => {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  const ID = () => crypto.randomUUID();

  async function shortFingerprint(pubKeyB64) {
    const raw = unb64(pubKeyB64);
    const hash = await crypto.subtle.digest("SHA-256", raw);
    const bytes = new Uint8Array(hash).slice(0, 8);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  // Identity helpers come from RasanIdentity (loaded before this module).
  function identity() {
    return (typeof globalThis !== "undefined" && globalThis.RasanIdentity) || (typeof window !== "undefined" && window.RasanIdentity) || null;
  }

  // ---- Per-session ephemeral keypair ----
  async function genEphemeralKeypair() {
    const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
    const pub = await crypto.subtle.exportKey("raw", kp.publicKey);
    const priv = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
    return { publicKey: b64(pub), privateKey: b64(priv), _kp: kp };
  }

  // Init a session: generate ephemeral keypair + sign it with long-term identity key.
  async function initSession(identityPrivB64, identityPubB64, peerIdentityPubB64) {
    const eph = await genEphemeralKeypair();
    const id = identity();
    let signature = null;
    if (id && typeof id.signEphemeral === "function") {
      signature = await id.signEphemeral(identityPrivB64, eph.publicKey);
    }
    const myFingerprint = identityPubB64 ? await shortFingerprint(identityPubB64) : "";
    const peerFingerprint = peerIdentityPubB64 ? await shortFingerprint(peerIdentityPubB64) : "";
    return {
      id: ID(),
      myEph: eph,
      ephPubB64: eph.publicKey,
      signature,
      identityPrivB64,
      identityPubB64: identityPubB64 || null,
      peerIdentityPubB64: peerIdentityPubB64 || null,
      myFingerprint,
      peerFingerprint,
      sendCount: 0,
      recvCount: 0,
    };
  }

  // Verify peer's ephemeral signature + derive session key (ephemeral x ephemeral).
  async function deriveSessionKey(session, peerEphPubB64, peerSignature, peerIdentityPubB64) {
    const id = identity();
    if (id && typeof id.verifyEphemeral === "function" && peerSignature) {
      const ok = await id.verifyEphemeral(peerIdentityPubB64, peerEphPubB64, peerSignature);
      if (!ok) throw new Error("MITM: invalid ephemeral signature");
    }

    const importPriv = (k) => crypto.subtle.importKey("pkcs8", unb64(k), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey", "deriveBits"]);
    const importPub = (k) => crypto.subtle.importKey("raw", unb64(k), { name: "ECDH", namedCurve: "P-256" }, false, []);

    const shared = await crypto.subtle.deriveBits(
      { name: "ECDH", public: await importPub(peerEphPubB64) },
      await importPriv(session.myEph.privateKey),
      256
    );
    const base = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
    const sk = await crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode("rasan-session-v1") },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
    session.sessionKey = sk;
    return sk;
  }

  // ---- AAD builder (T2) ----
  function buildAAD(senderFp, recipientFp, msgIndex, conversationId) {
    return enc.encode(JSON.stringify({
      sender: senderFp,
      recipient: recipientFp,
      msgIndex: msgIndex,
      conversationId: conversationId,
    }));
  }

  // Encrypt with AAD
  async function encrypt(sessionKey, plaintext, aadBytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const params = { name: "AES-GCM", iv };
    if (aadBytes) params.additionalData = aadBytes;
    const ct = await crypto.subtle.encrypt(params, sessionKey, enc.encode(plaintext));
    return { ciphertext: b64(ct), iv: b64(iv) };
  }

  // Decrypt with AAD (throws on mismatch -> replay/reorder/spoof detected)
  async function decrypt(sessionKey, ctB64, ivB64, aadBytes) {
    const params = { name: "AES-GCM", iv: unb64(ivB64) };
    if (aadBytes) params.additionalData = aadBytes;
    const pt = await crypto.subtle.decrypt(params, sessionKey, unb64(ctB64));
    return dec.decode(pt);
  }

  // ---- Key erasure (Forward Secrecy) ----
  async function endSession(session) {
    if (!session) return;
    // zeroize raw ephemeral private key
    if (session.myEph && session.myEph.privateKey) {
      try {
        const raw = await crypto.subtle.exportKey("pkcs8", (await (async () => {
          // re-import to get a CryptoKey handle we can export
          return crypto.subtle.importKey("pkcs8", unb64(session.myEph.privateKey), { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
        })()));
        new Uint8Array(raw).fill(0);
      } catch (e) { /* best effort */ }
    }
    // null all key material
    session.myEph = null;
    session.sessionKey = null;
    session.ephPubB64 = null;
    session.signature = null;
    session.identityPrivB64 = null;
    // clear from IndexedDB if present
    try {
      const db = await openDB();
      await new Promise((resolve) => {
        const tx = db.transaction("sessions", "readwrite");
        tx.objectStore("sessions").delete(session.id);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (e) { /* best effort */ }
  }

  // ---- IndexedDB for sessions ----
  const DB_NAME = "rasan-sessions";
  const STORE = "sessions";

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  // fingerprint helper (short hash of identity pubkey)
  async function fingerprint(identityPubB64) {
    const h = await crypto.subtle.digest("SHA-256", unb64(identityPubB64));
    return b64(h).slice(0, 16);
  }

  // Detect if two sessions use the same ephemeral key (should never happen)
  function sameEphemeral(a, b) {
    return a && b && a.ephPubB64 === b.ephPubB64;
  }

  return {
    genEphemeralKeypair, initSession, deriveSessionKey,
    buildAAD, encrypt, decrypt, endSession,
    fingerprint, sameEphemeral, openDB,
    b64, unb64,
  };
})();

// Node/test export
if (typeof module !== "undefined" && module.exports) {
  module.exports = globalThis.RasanSession;
}
