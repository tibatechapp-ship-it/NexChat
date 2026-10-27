# Rasan — E2EE Threat Model & Crypto Audit

**Date:** 2026-10-27
**Scope:** `web/crypto.js` (ECDH P-256 + HKDF + AES-GCM + PBKDF2 backup)
**Status:** Audit findings — fixes tracked per item.

## 1. What is protected
- 1:1 messages, group messages, files, key backup (recovery code).
- Primitives: Web Crypto only (no external libs). ECDH P-256, HKDF-SHA256, AES-GCM-256, PBKDF2-SHA256 (600k iters).

## 2. Threats & findings

| # | Threat | Severity | Finding | Status |
|---|---|---|---|---|
| T1 | MITM on key exchange | HIGH | Public keys exchanged without authentication (no TOFU / safety numbers / QR). Attacker can substitute keys. | OPEN |
| T2 | Replay / reordering | MEDIUM | AES-GCM has no AAD (no sender/recipient/timestamp/counter). Replayed ciphertexts decrypt successfully. | OPEN |
| T3 | No forward secrecy | MEDIUM | Long-term ECDH keys used for every message. Compromise of long-term key exposes all past messages. | OPEN (design) |
| T4 | HKDF empty salt | LOW | `salt: new Uint8Array(0)`. RFC-allowed but reduces entropy mixing; use a fixed app-specific salt. | OPEN |
| T5 | IV collision (birthday) | LOW | 96-bit random IV; safe up to ~2^48 messages per key. Acceptable for chat. | OK |
| T6 | Recovery code entropy | OK | 24 bytes (192 bits) + 600k PBKDF2 iters. Strong. | OK |
| T7 | Group key extractable | LOW | `extractable: true` allows export. Needed for backup but widens exposure. | ACCEPTED |
| T8 | No sender identity binding | MEDIUM | GCM tag authenticates ciphertext but not sender. Recipient cannot cryptographically prove who sent. | OPEN |
| T9 | Key backup stores `state.myKeys` | INFO | Depends on external `state`; verify it contains only keys, no plaintext. | VERIFY |
| T10 | No key pinning / rotation | MEDIUM | No mechanism to rotate or pin identity keys. | OPEN (design) |

## 3. Checklist (for fix PRs)
- [ ] Add safety numbers / QR verification for identity keys (TOFU at minimum).
- [ ] Add AAD to encrypt/decrypt: `sender || recipient || timestamp || counter`.
- [ ] Add monotonic message counter + reject replays.
- [ ] HKDF salt: use `enc.encode("rasan-v1-salt")` (non-empty).
- [ ] Document no-PFS design decision (or add Double Ratchet later).
- [ ] Group key: consider non-extractable + re-wrap on rotation.
- [ ] Verify `state.myKeys` contains only key material.

## 4. Test vectors (to add)
- ECDH symmetry: A.derive(B) === B.derive(A) (shared secret equal).
- Roundtrip: encrypt then decrypt returns original (text + file + group key).
- Tamper: flipping 1 bit in ciphertext/iv/tag must throw on decrypt.
- Wrong key: decrypt with different shared key must throw.
- Recovery: createKeyBackup then restoreFromBackup with correct code succeeds; wrong code throws.
- Replay: same (ct, iv) decrypts twice (currently) — document expected behavior until T2 fixed.

## 5. Non-goals (v1)
- No metadata protection (server sees who talks to whom).
- No anonymity / onion routing.
- No post-quantum (P-256 is not PQ-safe).

## 6. References
- Web Crypto API (W3C)
- RFC 5869 (HKDF), RFC 5116 (AES-GCM)
- Signal Double Ratchet (future work for PFS)
