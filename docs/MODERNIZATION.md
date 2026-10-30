# MODERNIZATION — chore/modernize (2026-10-30)

Safe, high-impact modernization pass. No major-version bumps, no API changes,
no `git push` from this branch without review.

---

## 1. Security audit (npm audit)

| Surface | Command | Result |
|---|---|---|
| Root (web client + tests) | `npm audit` | ✅ **0 vulnerabilities** |
| `server/` (express + socket.io) | `npm audit` | ✅ **0 vulnerabilities** |

Resolved versions audited: `express 4.22.3`, `socket.io 4.8.4`,
`jsonwebtoken 9.0.3`, `bcryptjs 2.4.3`, `helmet 7.2.0`,
`express-rate-limit 7.5.1`, `multer 1.4.5-lts.2`.

**Action:** none required — no CVEs at the current resolution set, so nothing
was bumped (per ground rule: security patches only, no majors).

**يحتاج قرار:** `multer` 1.4.x is on the LTS line; upstream's current major is
2.x. The audit DB reports it clean, but if you want the actively-developed
major anyway, that is a **major-version bump requiring your approval** (the
API is compatible for the simple disk upload used here — `multer({ dest })` —
but the rule is the rule).

## 2. Unused dependencies

Exhaustive import scan (`require`/`from` across `server/`, `web/`, `tests/`,
`vitest.config.js`):

* **All 7 server dependencies are used** (`express`, `socket.io`, `jsonwebtoken`,
  `bcryptjs`, `multer`, `helmet`, `express-rate-limit` — 1+ call sites each).
* **All 4 root devDependencies are used** (`vitest`, `@vitest/coverage-v8`,
  `fake-indexeddb`, `jsdom` — referenced by the config/tests).

**Action:** nothing to remove — the dependency list is already minimal.

**Second pass — one flag, resolved in the third pass (2026-10-30):**
`server/push.js` did `try { admin = require("firebase-admin") } catch { admin = null }`
and the package was declared **nowhere** — not in `dependencies`, not in
`optionalDependencies`, absent from the lockfile. Consequence: Render installs
from `server/package.json`, so production never had `firebase-admin` and push
notifications silently disabled themselves (`[push] disabled` at info level,
easy to miss). Decision applied — **declare `firebase-admin@^13.10.0` in
`dependencies`**: push is a core product feature and must not depend on
install luck. Version 13.x (not 14.x) deliberately: 14 requires Node >= 22
while the server declares `>=20`; 13 requires only >= 18, matching the
declared engine range. Runtime degradation stays graceful (no FCM credentials
→ disabled with a warning), and the "disabled" messages are now
`console.warn` so they surface in production logs instead of hiding among
info lines. Two accompanying hardenings: the dead prototype
`server/src/index.js` (unreferenced; required undeclared `cors`/`uuid`) is
removed, and `tests/server-deps.test.js` is added — a deploy-contract guard
that fails the suite if the server ever requires a module missing from
`server/package.json`, so this bug class cannot return.

**Fourth pass — the push chain is now end-to-end completable (2026-10-30):**
with `firebase-admin` declared (third pass) and the mobile client registering
tokens after login (PR #14), the last gap was production credentials delivery:
`server/push.js` now reads `FCM_SERVICE_ACCOUNT_JSON` (the whole service-account
JSON as one env var — matches the GitHub secret of that name) before falling
back to `FCM_CREDENTIALS`/file, `render.yaml` declares both as `sync: false`,
`docs/PUSH-SETUP.md` documents the Render path, and `tests/push-config.test.js`
guards the chain. Setting the env on Render is the only manual step left.

## 3. Dev experience (added)

| File | Purpose |
|---|---|
| `Makefile` | Unified entrypoints: `make install` / `make test` (vitest gate) / `make lint` / `make verify` (lint + tests) / `make clean` |
| `.editorconfig` | Repo-wide formatting contract (2-space for JS/YAML/JSON, tabs for Makefile, 4-space Dart for `mobile/`) |

`pre-commit` hooks were **not** added: the brief scopes them to Python
projects, and this repo has no Python. The equivalent gate here is
`make verify` (wire it into CI when you want it enforced).

## 4. Performance — first-load (lazy loading)

The auth screen used to download every script before rendering. `io()` and
`window.qrcode` were each referenced from exactly one call site
(`app.js:connectSocket`, `ui-identity.js:renderQR`), which made two surgical
lazy loads possible with no bundler and no behavior change:

| Change | Effect |
|---|---|
| `socket.io/socket.io.js` removed from `index.html`, injected on first `connectSocket()` | ≈40 KB of JS no longer blocks the logged-out auth screen |
| `vendor/qrcode.min.js` removed from `index.html`, injected the first time the verify modal renders a QR | 20.7 KB deferred until actually needed |
| `renderQR()` → async with cached load promise (double-open safe, failure falls back to the existing "QR library not loaded" text) | Same UI, zero eager cost |
| Attachment media: `img.loading="lazy"` + `decoding="async"`, `video.preload="metadata"`, `audio.preload="none"` | Conversations with many attachments stop eagerly fetching/buffering every blob |
| `sw.js` cache key `rasan-v1` → `rasan-v2` | Existing installs pick up the new shell instead of serving a stale cache |

**Net effect:** script weight executed on the first (logged-out) page load
drops from ≈120 KB to ≈57 KB — **roughly half**. Post-login behavior is
unchanged: the socket still connects inside `enterApp()` exactly as before,
just with the client fetched at that moment instead of at page load.

## 5. Verification

* `npm test` — **41/41 passing** before and after the changes (identity,
  session, ui-identity, deploy-config suites).
* `node --check` clean on all modified files (`app.js`, `ui-identity.js`).
* `npm run lint` (syntax gate) — clean.
* Second pass re-verification: `npm audit` 0 vulnerabilities (root +
  `server/`), `make test` → 41/41, lazy-load contract intact (no blocking
  `/socket.io/socket.io.js` or `/vendor/qrcode.min.js` in `index.html`;
  loaders cached on first use; SW cache `rasan-v2`).

## 6. Not touched (flagged for visibility)

* `mobile/` (Flutter): `flutter`/`dart` tooling is not available in this
  environment, so `flutter pub outdated` could not be run. Declared deps are
  all current-major (`http ^1`, `provider ^6`, `image_picker ^1`, …); a
  dedicated pass with the Flutter SDK installed is the follow-up.
* `render.yaml` / server deployment config — untouched; covered by
  `tests/deploy-config.test.js` (passing).
