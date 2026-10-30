import test from "node:test";
import assert from "node:assert/strict";

import "./setup.js";
import { MeshService } from "../src/services/meshService.js";

/** يمنح الحلقة الدقيقة فرصة لتسليم الرسائل غير المتزامنة. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("announcePresence ينشر رسالة حضور من معرف العقدة", async () => {
  const node = new MeshService("node-1", "room-presence");
  const seen = [];
  node.channel.onmessage = null;
  node.announcePresence();
  // نلتقط ما بعد من القناة الشقيقة
  const other = new MeshService("node-2", "room-presence");
  other.onPresence((data) => seen.push(data));
  node.announcePresence();
  await flush();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].from, "node-1");
  assert.equal(seen[0].type, "presence");
  assert.ok(typeof seen[0].at === "number");
  node.close();
  other.close();
});

test("sendMessage يسلّم الرسالة إلى عقدة أخرى على نفس القناة", async () => {
  const sender = new MeshService("node-a", "room-message");
  const receiver = new MeshService("node-b", "room-message");
  const received = [];
  receiver.onMessage((data) => received.push(data));

  sender.sendMessage({ text: "مرحبا" });
  await flush();

  assert.equal(received.length, 1);
  assert.equal(received[0].from, "node-a");
  assert.deepEqual(received[0].message, { text: "مرحبا" });
  sender.close();
  receiver.close();
});

test("العقدة تتجاهل رسائلها الخاصة", async () => {
  const self = new MeshService("node-self", "room-self");
  let hits = 0;
  self.onMessage(() => hits++);
  self.sendMessage({ text: "ذاتي" });
  await flush();
  assert.equal(hits, 0);
  self.close();
});

test("close يوقف القناة عن الاستقبال", async () => {
  const sender = new MeshService("node-x", "room-close");
  const receiver = new MeshService("node-y", "room-close");
  let hits = 0;
  receiver.onMessage(() => hits++);
  receiver.close();

  sender.sendMessage({ text: "بعد الإغلاق" });
  await flush();

  assert.equal(hits, 0);
  assert.throws(() => receiver.sendMessage({ text: "x" }), /closed/);
  sender.close();
});
