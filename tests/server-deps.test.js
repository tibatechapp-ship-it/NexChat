// server-deps.test.js — deploy contract for the server's runtime dependencies.
//
// Render installs exactly what `server/package.json` declares. Any module the
// server `require()`s but that file does not declare "works" only on developer
// machines (where it happens to be hoisted or hand-installed) and silently
// breaks in production. This is exactly how push notifications were lost:
// `firebase-admin` was required by push.js but declared nowhere, so the
// production install never had it and push quietly disabled itself.
//
// This guard fails the suite the moment an undeclared require appears.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = join(ROOT, 'server');
const pkg = JSON.parse(readFileSync(join(SERVER, 'package.json'), 'utf8'));
const declared = new Set(Object.keys(pkg.dependencies || {}));

// Node built-ins that never need a package.json entry.
const BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants',
  'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs',
  'http', 'http2', 'https', 'inspector', 'module', 'net', 'os', 'path',
  'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl',
  'stream', 'string_decoder', 'test', 'timers', 'tls', 'tty', 'url', 'util',
  'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]);

const REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

function externalRequiresOf(file) {
  const src = readFileSync(join(SERVER, file), 'utf8');
  const out = [];
  let m;
  REQUIRE_RE.lastIndex = 0;
  while ((m = REQUIRE_RE.exec(src))) {
    const req = m[1];
    if (req.startsWith('.') || req.startsWith('/') || req.startsWith('node:')) continue;
    // Scoped packages (@scope/name) keep two path segments; plain ones keep one.
    const base = req.startsWith('@') ? req.split('/').slice(0, 2).join('/') : req.split('/')[0];
    if (BUILTINS.has(base)) continue;
    out.push(base);
  }
  return out;
}

const serverFiles = readdirSync(SERVER).filter((f) => f.endsWith('.js'));

describe('server deploy contract (declared dependencies)', () => {
  it('declares firebase-admin — push must not depend on install luck', () => {
    expect(declared.has('firebase-admin')).toBe(true);
  });

  it('has at least one server entry scanned (guard is not a no-op)', () => {
    expect(serverFiles).toContain('server.js');
    expect(serverFiles).toContain('push.js');
  });

  it.each(serverFiles)('%s requires only declared modules', (file) => {
    const missing = externalRequiresOf(file).filter((name) => !declared.has(name));
    expect(missing).toEqual([]);
  });
});
