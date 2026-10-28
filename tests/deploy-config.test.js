// Deploy-contract guards.
//
// Rasan has ONE deployable shape: a single Node process that serves the static
// client, the REST API and Socket.IO on the same origin, with SQLite on a
// mounted disk. These tests fail if that shape drifts — a second deploy target
// appears, the platform is told to deploy on every push, or /health stops
// reporting which commit is live (which is the only proof a deploy landed).

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('single deploy path (Render)', () => {
  const blueprint = read('render.yaml');

  it('keeps the server as the only service, with its disk', () => {
    expect(blueprint).toMatch(/rootDir:\s*server/);
    expect(blueprint).toMatch(/startCommand:\s*node server\.js/);
    expect(blueprint).toMatch(/mountPath:\s*\/opt\/render\/project\/src\/data/);
    expect(blueprint).toMatch(/healthCheckPath:\s*\/health/);
  });

  it('does not deploy on push — CI decides', () => {
    expect(blueprint).toMatch(/autoDeploy:\s*false/);
  });

  it('runs one instance (SQLite disk + in-memory sockets)', () => {
    expect(blueprint).toMatch(/numInstances:\s*1/);
  });

  it('generates its own secrets instead of committing them', () => {
    expect(blueprint).toMatch(/key:\s*JWT_SECRET\s*\n\s*generateValue:\s*true/);
    expect(blueprint).not.toMatch(/sk_|password:\s*\S/i);
  });
});

describe('no competing deploy target', () => {
  const forbidden = ['vercel.json', 'netlify.toml', 'fly.toml', 'Procfile', 'railway.json', 'app.json'];

  it.each(forbidden)('%s does not exist', (file) => {
    expect(existsSync(join(ROOT, file))).toBe(false);
  });

  it('no workflow invokes another platform', () => {
    const workflow = read('.github/workflows/deploy-render.yml');
    expect(workflow).not.toMatch(/vercel|netlify|railway|flyctl/i);
  });
});

describe('deploy workflow', () => {
  const workflow = read('.github/workflows/deploy-render.yml');

  it('runs only after a successful ci run on main', () => {
    expect(workflow).toMatch(/workflow_run:/);
    expect(workflow).toMatch(/workflows:\s*\["ci"\]/);
    expect(workflow).toMatch(/conclusion == 'success'/);
    expect(workflow).toMatch(/head_branch == 'main'/);
  });

  it('fails loudly when the hook secret is missing', () => {
    expect(workflow).toMatch(/RENDER_DEPLOY_HOOK is missing/);
    expect(workflow).toMatch(/exit 1/);
  });

  it('verifies the live commit, not just an HTTP 200', () => {
    expect(workflow).toMatch(/commit/);
    expect(workflow).toMatch(/live/);
  });
});

describe('the app is deployable as one unit', () => {
  const server = read('server/server.js');

  it('serves the client from the same origin as the API', () => {
    expect(server).toMatch(/express\.static\(path\.join\(__dirname, "\.\.", "web"\)/);
  });

  it('reports the commit it is serving', () => {
    expect(server).toMatch(/RENDER_GIT_COMMIT/);
    expect(server).toMatch(/app\.get\("\/health"/);
    expect(server).toMatch(/commit:\s*COMMIT/);
  });
});

describe('no deploy hook in the tree', () => {
  it('the hook URL lives in secrets only', () => {
    const server = read('server/server.js');
    expect(server).not.toMatch(/api\.render\.com\/deploy/);
    expect(read('.github/workflows/deploy-render.yml')).not.toMatch(/https:\/\/api\.render\.com\/deploy\/[A-Za-z0-9]{20,}/);
  });
});
