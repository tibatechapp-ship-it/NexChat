import { test } from "node:test";
import assert from "node:assert/strict";

// jsdom-like minimal DOM shim
function makeDom() {
  const els = {};
  const get = (id) => els[id] || (els[id] = { classList: { add(){}, remove(){}, contains(){return false;} }, innerHTML: '', textContent: '', disabled: false, addEventListener(){} });
  globalThis.document = { getElementById: get, body: { innerHTML: '' } };
  globalThis.window = globalThis;
  // minimal qrcode stub
  globalThis.window.qrcode = undefined;
  return els;
}

test("ui-identity module loads", async () => {
  makeDom();
  await import('./ui-identity.js');
  assert.ok(true);
});
