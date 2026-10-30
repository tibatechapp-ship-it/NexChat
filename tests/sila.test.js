// حواجز تكامل صلة (sila) في رسن.
//
// صلة أصلها مستودع wifi-chat المدموج تحت sila/ (MIT، Vixona Technologies).
// هذه الاختبارات تضمن أن التكامل يبقى كما صُمم: مساحة /sila معزولة تماماً
// عن نواة رسن (بلا DB ولا مصادقة ولا تخزين)، عميل ثابت يعمل بلا بناء،
// وجسر نقل عبر Socket.IO على نفس الأصل — دون أي مسار نشر منافس.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('the sila bridge is attached to the running server', () => {
  const server = read('server/server.js');

  it('server requires and initializes the sila namespace', () => {
    expect(server).toMatch(/require\("\.\/sila-mesh"\)/);
    expect(server).toMatch(/silaMesh\.init\(io\)/);
  });

  it('serves the sila client as static files at /sila (no build needed)', () => {
    expect(server).toMatch(/app\.use\("\/sila",\s*express\.static/);
    expect(existsSync(join(ROOT, 'sila', 'index.html'))).toBe(true);
    expect(existsSync(join(ROOT, 'sila', 'src', 'main.js'))).toBe(true);
  });
});

describe('sila stays isolated from the Rasan core', () => {
  const silaMesh = read('server/sila-mesh.js');

  it('never touches the database, auth, or persistence', () => {
    expect(silaMesh).not.toMatch(/require\("\.\/db"\)/);
    expect(silaMesh).not.toMatch(/require\("\.\/auth"\)/);
    expect(silaMesh).not.toMatch(/db\.prepare/);
    expect(silaMesh).not.toMatch(/writeFile|appendFile/i);
  });

  it('rate-limits and size-caps the relay', () => {
    expect(silaMesh).toMatch(/RATE_MAX\s*=\s*10/);
    expect(silaMesh).toMatch(/MAX_TEXT_BYTES\s*=\s*4000/);
    expect(silaMesh).toMatch(/rate_limit/);
  });

  it('speaks on its own /sila namespace only', () => {
    expect(silaMesh).toMatch(/io\.of\("\/sila"\)/);
    expect(silaMesh).not.toMatch(/io\.of\("\/(?!sila)/);
  });
});

describe('the sila client bridges both transports', () => {
  const main = read('sila/src/main.js');
  const bridge = read('sila/src/services/netBridge.js');
  const html = read('sila/index.html');

  it('keeps BroadcastChannel and adds the server bridge (dual path)', () => {
    expect(main).toMatch(/new MeshService\(/);
    expect(main).toMatch(/new NetBridge\(/);
    expect(main).toMatch(/meshService\.sendMessage\(/);
    expect(main).toMatch(/netBridge\.send\(/);
  });

  it('loads socket.io from the same origin and degrades silently without it', () => {
    expect(html).toMatch(/\/socket\.io\/socket\.io\.js/);
    expect(bridge).toMatch(/typeof window\.io !== "function"/);
  });

  it('uses a relative module entry so static hosting works', () => {
    expect(html).toMatch(/src="\.\.\/src\/main\.js"|src="\.\//);
    expect(html).not.toMatch(/src="\/src\/main\.js"/);
  });
});

describe('provenance and hygiene of the merged sila module', () => {
  it('keeps its MIT license with the project', () => {
    const license = read('sila/LICENSE');
    expect(license).toMatch(/MIT License/);
    expect(license).toMatch(/tibatechapp-ship-it/);
  });

  it('adds no competing deploy target inside sila/', () => {
    const forbidden = ['vercel.json', 'netlify.toml', 'fly.toml', 'Procfile', 'railway.json', 'render.yaml'];
    const top = readdirSync(join(ROOT, 'sila'));
    for (const f of forbidden) expect(top).not.toContain(f);
  });

  it('the feature research document exists and covers the competitive set', () => {
    const doc = read('docs/FEATURE_RESEARCH.md');
    for (const name of ['BitChat', 'Briar', 'Bridgefy', 'Zello', 'FireChat', 'Meshtastic', 'Session']) {
      expect(doc).toContain(name);
    }
  });
});
