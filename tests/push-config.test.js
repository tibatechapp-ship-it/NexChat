// push-config.test.js — deploy contract for the FCM push credential chain.
//
// The production shape: Render runs the server and reads env vars declared in
// render.yaml (sync:false values are pasted once at blueprint apply). The
// GitHub secret FCM_SERVICE_ACCOUNT_JSON mirrors the Render env var name and
// server/push.js reads it directly — no credential file ever lands in the
// repo or the image. These guards keep that chain wired end-to-end.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('push credential chain (env JSON, Render-friendly)', () => {
  const push = read('server/push.js');
  const blueprint = read('render.yaml');

  it('push.js reads FCM_SERVICE_ACCOUNT_JSON env directly (no file needed)', () => {
    expect(push).toMatch(/FCM_SERVICE_ACCOUNT_JSON/);
    expect(push).toMatch(/JSON\.parse\(envJson\)/);
  });

  it('push.js still degrades gracefully and warns when nothing is set', () => {
    expect(push).toMatch(/\[push\] disabled — no FCM credentials/);
    expect(push).toMatch(/console\.warn/);
  });

  it('render.yaml declares both credential env vars as sync:false', () => {
    expect(blueprint).toMatch(/key:\s*FCM_SERVICE_ACCOUNT_JSON\s*\n\s*sync:\s*false/);
    expect(blueprint).toMatch(/key:\s*FCM_CREDENTIALS\s*\n\s*sync:\s*false/);
  });

  it('no service-account material ever lands in the tree', () => {
    const server = read('server/server.js');
    expect(push + blueprint + server).not.toMatch(/"private_key"\s*:/);
    expect(push + blueprint + server).not.toMatch(/-----BEGIN PRIVATE KEY-----/);
  });
});
