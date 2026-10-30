import test from "node:test";
import assert from "node:assert/strict";

import "./setup.js";
import {
  state,
  rooms,
  addMessage,
  addPeer,
  getPeerCount,
  setTransport,
  setActiveRoom,
  setRoomCount,
} from "../src/state/appState.js";

test("الحالة الابتدائية سليمة", () => {
  assert.equal(state.transport, "mesh");
  assert.equal(state.activeRoom, "ساحة الحي");
  assert.ok(Array.isArray(state.messages));
  assert.ok(Array.isArray(rooms));
  assert.ok(state.peers instanceof Map);
});

test("addMessage يضيف رسالة واحدة في كل نداء", () => {
  const before = state.messages.length;
  addMessage({ author: "أ", text: "مرحبا", mine: true });
  assert.equal(state.messages.length, before + 1);
  assert.equal(state.messages.at(-1).text, "مرحبا");
});

test("addPeer يسجّل العقدة مرة واحدة ويحدّث طابعها الزمني", () => {
  addPeer("peer-a", 1000);
  assert.equal(state.peers.get("peer-a"), 1000);
  addPeer("peer-a", 2000);
  assert.equal(state.peers.get("peer-a"), 2000);
  assert.equal(state.peers.size, 1);
});

test("getPeerCount يعكس العقد الحقيقية فقط (لا أرقام تجريبية)", () => {
  state.peers.clear();
  assert.equal(getPeerCount(), 0);
  addPeer("p1", 1);
  assert.equal(getPeerCount(), 1);
  addPeer("p2", 2);
  assert.equal(getPeerCount(), 2);
});

test("setTransport و setActiveRoom يغيّران الحالة", () => {
  setTransport("internet");
  assert.equal(state.transport, "internet");
  setActiveRoom("فريق الرحلة");
  assert.equal(state.activeRoom, "فريق الرحلة");
});

test("setRoomCount يحدّث العدّاد من مصدر حقيقي فقط", () => {
  const room = rooms.find((r) => r.name === "ملاحظات عامة");
  const before = room.count;

  setRoomCount("ملاحظات عامة", 34);
  assert.equal(room.count, 34);

  // قيم غير صالحة من الخادم لا تفسد العدّاد
  setRoomCount("ملاحظات عامة", 0);
  setRoomCount("ملاحظات عامة", -5);
  setRoomCount("ملاحظات عامة", 1.5);
  setRoomCount("ساحة غير موجودة", 99);
  assert.equal(room.count, 34);

  room.count = before;
});
