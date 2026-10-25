window.RasanCrypto = (() => {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  function b64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
  function unb64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
  async function genKeypair() {
    const kp = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveKey"]);
    const pub = await crypto.subtle.exportKey("raw", kp.publicKey);
    const priv = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
    return { publicKey: b64(pub), privateKey: b64(priv) };
  }
  async function importPrivate(b64key) {
    return crypto.subtle.importKey("pkcs8", unb64(b64key), { name: "X25519" }, false, ["deriveKey"]);
  }
  async function importPublic(b64key) {
    return crypto.subtle.importKey("raw", unb64(b64key), { name: "X25519" }, false, []);
  }
  async function deriveShared(myPrivB64, theirPubB64) {
    const myPriv = await importPrivate(myPrivB64);
    const theirPub = await importPublic(theirPubB64);
    return crypto.subtle.deriveKey({ name: "X25519", public: theirPub }, myPriv, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function encrypt(key, plaintext) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
    return { ciphertext: b64(ct), iv: b64(iv) };
  }
  async function decrypt(key, ciphertextB64, ivB64) {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(ivB64) }, key, unb64(ciphertextB64));
    return dec.decode(pt);
  }
  async function exportAesKey(key) {
    const raw = await crypto.subtle.exportKey("raw", key);
    return b64(raw);
  }
  async function importAesKey(b64key) {
    return crypto.subtle.importKey("raw", unb64(b64key), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  }
  return { genKeypair, deriveShared, encrypt, decrypt, exportAesKey, importAesKey, b64, unb64 };
})();
