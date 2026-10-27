// Rasan Identity — TOFU + Safety Numbers (Web Crypto only, 0KB deps)
// Long-term identity keypair (ECDSA P-256) used to authenticate ephemeral ECDH keys.
globalThis.RasanIdentity = (() => {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  // ---- Identity keypair (long-term, ECDSA for signing) ----
  async function genIdentityKeypair() {
    const kp = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]
    );
    const pub = await crypto.subtle.exportKey("spki", kp.publicKey);
    const priv = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
    return { publicKey: b64(pub), privateKey: b64(priv) };
  }

  async function importPriv(b64key) {
    return crypto.subtle.importKey("pkcs8", unb64(b64key), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  }
  async function importPub(b64key) {
    return crypto.subtle.importKey("spki", unb64(b64key), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  }

  // Sign an ephemeral ECDH public key with the identity key (proves ownership).
  async function signEphemeral(identityPrivB64, ephemeralPubB64) {
    const key = await importPriv(identityPrivB64);
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, unb64(ephemeralPubB64));
    return b64(sig);
  }

  async function verifyEphemeral(identityPubB64, ephemeralPubB64, sigB64) {
    const key = await importPub(identityPubB64);
    return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, unb64(sigB64), unb64(ephemeralPubB64));
  }

  // ---- TOFU store (IndexedDB) ----
  const DB_NAME = "rasan-identity";
  const STORE = "peers";

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "userId" });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function storePeer(userId, identityPubB64) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ userId, identityPub: identityPubB64, firstSeen: Date.now() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async function getPeer(userId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(userId);
      req.onsuccess = (e) => resolve(e.target.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  // TOFU check: returns { status: "new"|"same"|"changed", peer }
  async function tofuCheck(userId, identityPubB64) {
    const peer = await getPeer(userId);
    if (!peer) {
      await storePeer(userId, identityPubB64);
      return { status: "new", peer: null };
    }
    if (peer.identityPub === identityPubB64) {
      return { status: "same", peer };
    }
    // MITM warning: record changedAt WITHOUT replacing the stored key.
    peer.changedAt = Date.now();
    return { status: "changed", peer }; // MITM warning!
  }

  // ---- Safety Numbers (Signal-style) ----
  // Combine both identity public keys (sorted) -> SHA-256 -> 12 groups of 5 digits.
  async function generateSafetyNumber(myIdentityPubB64, theirIdentityPubB64) {
    const keys = [myIdentityPubB64, theirIdentityPubB64].sort();
    const combined = enc.encode(keys.join("|"));
    const hash = await crypto.subtle.digest("SHA-256", combined);
    const bytes = new Uint8Array(hash);
    // 30 bytes -> 12 groups of 5 digits (each group = 2.5 bytes ~ 20 bits, but we use 2 bytes = 5 digits mod 100000)
    const groups = [];
    for (let i = 0; i < 12; i++) {
      const off = i * 2;
      const val = (bytes[off] << 8 | bytes[off + 1]) % 100000;
      groups.push(String(val).padStart(5, "0"));
    }
    return groups.join(" ");
  }

  // ---- QR payload (public info only) ----
  function qrPayload(userId, identityPubB64) {
    return JSON.stringify({ v: 1, u: userId, k: identityPubB64 });
  }

  // Parse QR payload
  function parseQR(str) {
    try {
      const o = JSON.parse(str);
      if (o.v !== 1 || !o.u || !o.k) return null;
      return { userId: o.u, identityPub: o.k };
    } catch (e) {
      return null;
    }
  }

  // ---- Verified flag (user confirmed safety numbers match) ----
  async function markPeerVerified(peerId) {
    const db = await openDB();
    const peer = await getPeer(peerId);
    if (!peer) throw new Error("peer " + peerId + " not found");
    peer.verifiedAt = Date.now();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(peer);
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async function isPeerVerified(peerId) {
    const peer = await getPeer(peerId);
    if (!peer || !peer.verifiedAt) return false;
    return peer.verifiedAt >= (peer.changedAt || 0);
  }

  return {
    genIdentityKeypair, importPriv, importPub,
    signEphemeral, verifyEphemeral,
    storePeer, getPeer, tofuCheck, markPeerVerified, isPeerVerified,
    generateSafetyNumber, qrPayload, parseQR,
    b64, unb64,
  };
})();

// Node/test export (no-op in browser)
if (typeof module !== "undefined" && module.exports) {
  module.exports = globalThis.RasanIdentity;
}
