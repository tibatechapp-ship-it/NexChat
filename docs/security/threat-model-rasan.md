# Threat Model — Rasan

**Version:** 2.0
**Date:** 2026-10-27
**Status:** T1 MITIGATED (crypto + UI layers proven by 15 tests)

## Scope
1:1 messaging over Web Crypto (ECDH P-256 + AES-GCM), PWA, 12 languages,
zero runtime dependencies except vendored qrcode-generator (MIT, ~20KB).

## Findings

| ID | Severity | Finding | Status | Evidence |
|---|---|---|---|---|
| T1 | HIGH | MITM on key exchange — no TOFU/safety numbers/QR | **MITIGATED** | commit 0365ed3; 15 tests |
| T2 | MED | No AAD → replay/reordering possible | **MITIGATED** | session.js AAD (msgIndex + sender fp) |
| T3 | MED | No forward secrecy (long-term keys) | **MITIGATED** | per-session ephemeral + key erasure |
| T4 | LOW | HKDF empty salt | OPEN (low risk) | — |
| T5 | OK | IV birthday bound | SAFE | analysis |
| T6 | OK | Recovery code 192-bit + 600k PBKDF2 | SAFE | — |
| T7 | LOW | Group key extractable | OPEN | — |
| T8 | MED | No sender identity binding | OPEN (partially covered by T1 signing) | — |
| T9 | INFO | state.myKeys verify | ADDRESSED | — |
| T10 | MED | No key pinning/rotation | **PARTIAL** | TOFU pins; no rotation UI |

## T1 — Mitigation Detail

**Attack:** Active MITM substitutes public keys during ECDH exchange → intercepts all messages.

**Mitigation layers:**
1. **Identity keypair** (ECDSA P-256, long-term) signs every ephemeral ECDH key.
2. **TOFU store** (IndexedDB) pins the peer's identity key on first contact.
3. **`tofuCheck`** returns `new` / `same` / `changed`. On `changed`:
   - `changedAt` timestamp recorded
   - stored key **NOT replaced** (preserves detection)
4. **Safety Numbers** — SHA-256 of sorted identity keys → 12×5 digits (Signal-style).
   Both parties compute the same number.
5. **QR verification** — payload `{v,u,k}` (public only) for in-person verification.
6. **UI warning** — danger banner + input disabled on `changed`.

**Tests proving mitigation** (tests/identity.test.js + tests/ui-identity.test.js, 15 passing):
- `generateSafetyNumber` symmetry — Alice/Bob get identical numbers
- `generateSafetyNumber` differs on key change
- ephemeral signature round-trip
- MITM on signature rejected
- TOFU: changed key → 'changed', no replacement
- QR: no private key leak
- QR: rejects invalid version / missing fields
- UI: danger banner + input disabled on 'changed'
- UI: warning banner on 'new'
- UI: success banner on 'same' + verified
- UI: confirmVerified saves verified state

**Residual risk:**
- User must actually compare safety numbers / scan QR — TOFU alone only warns on change, doesn't prevent first-contact MITM.

## T3 — Forward Secrecy (MITIGATED)
Per-session ephemeral ECDH keys (signed by long-term identity key).
Session key derived from ephemeral×ephemeral. Key erasure on endSession.
Compromise of long-term key later ≠ decrypt past sessions.
Tests: session.test.js (endSession nulls all key material).

## T2 — AAD (MITIGATED)
AES-GCM now uses Additional Authenticated Data: {sender, recipient, msgIndex, conversationId}.
Replay/reorder/spoof → decrypt fails. Tests: session.test.js (2 cases).

## T8 — Sender binding (open)
Recipient does not cryptographically verify sender identity inside the
envelope. Partially mitigated by T1 (ephemeral signing). Fix: include sender
identity key fingerprint in signed payload.
