// rtc.test.js — عقد النقل المباشر جهاز-إلى-جهاز (WebRTC) في صلة.
//
// تقنية Meshenger (P1): الإشارة (SDP/ICE) تمر موجّهة عبر مساحة /sila،
// والبيانات تسير مباشرة بين الجهازين بلا خادم وسيط. الضمانات هنا:
// 1. التوجيه صارم: للهدف المعلن فقط، ولا يوجَّه للنفس، ولا لجهاز غير متصل.
// 2. سقوف بايت صارمة على SDP وICE — لا حمولات ضخمة عبر الموجّه.
// 3. العميل يفشل بهدوء حيث RTCPeerConnection غير متاح (بيئات الاختبار).
// 4. إزالة التكرار في addMessage تجعل النقل المزدوج آمناً بلا رسائل مكررة.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import "./setup.js";
import { RtcService } from "../src/services/rtcService.js";
import { state, addMessage } from "../src/state/appState.js";
import { newMessageId } from "../src/utils/helpers.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

test("موجّه sila-mesh يوجّه إشارات RTC للهدف المتصل فقط", () => {
  const mesh = read("server/sila-mesh.js");
  expectRelay(mesh, "sila:rtc:offer");
  expectRelay(mesh, "sila:rtc:answer");
  expectRelay(mesh, "sila:rtc:ice");
});

function expectRelay(mesh, event) {
  // كل حدث يمر عبر relayRtc مع سقفه الخاص
  assert.ok(mesh.includes(`socket.on("${event}"`), `${event} handler missing`);
  // التوجيه المزدوج (من → إلى) مع فحص وجود الهدف قبل الإرسال
  assert.ok(mesh.includes('nsp.sockets.get(to)'), "must resolve the target socket");
  assert.ok(mesh.includes("target.emit(event"), "must emit the relayed event");
}

test("موجّه sila-mesh يرفض التوجيه للنفس وللأهداف غير المتصلة — بلا طوابير", () => {
  const mesh = read("server/sila-mesh.js");
  assert.ok(mesh.includes("to === socket.id"), "self-relay must be rejected");
  assert.ok(mesh.includes("if (!target) return;"), "no queuing for offline targets");
});

test("سقوف بايت صارمة: SDP ≤ 20000 و ICE ≤ 2048 مع فحص طول فعلي", () => {
  const mesh = read("server/sila-mesh.js");
  assert.ok(mesh.includes("MAX_SDP_BYTES = 20000"));
  assert.ok(mesh.includes("MAX_ICE_BYTES = 2048"));
  assert.ok(mesh.includes("Buffer.byteLength(payload, \"utf8\") > maxBytes"));
});

test("الإشارات تخضع لنفس محدّد المعدل ويبقى الجسر بلا DB ولا تخزين", () => {
  const mesh = read("server/sila-mesh.js");
  // relayRtc داخل نطاق rateLimited (نفس حد 10 رسائل/10ث للرسائل والإشارات)
  assert.ok(mesh.includes("if (rateLimited()) {"), "relay must be rate limited");
  assert.ok(!/require\("\.\/db"\)/.test(mesh), "no db");
  assert.ok(!/INSERT INTO|writeFile/i.test(mesh), "no persistence");
});

test("RtcService يفشل بهدوء حيث RTCPeerConnection غير متاح", () => {
  // بيئة node بلا RTCPeerConnection: enabled=false وبلا أي ربط أحداث
  const fakeBridge = { socket: { on() {}, emit() {}, id: "n1" } };
  const svc = new RtcService(fakeBridge);
  assert.equal(svc.enabled, false);
  assert.equal(svc.send({ text: "مرحباً" }), false);
  assert.equal(svc.openChannels(), 0);
});

test("إزالة التكرار في addMessage تجعل النقل المزدوج آمناً", () => {
  const id = newMessageId();
  const msg = { id, author: "سامر", initials: "س", time: "10:00", text: "مرحباً", mine: false };
  const snapshot = state.messages.slice();
  state.messages.length = 0; // عزّز الحالة لهذا الاختبار
  try {
    assert.equal(addMessage({ ...msg, transport: "p2p" }), true);
    assert.equal(addMessage({ ...msg, transport: "net" }), false); // نفس id — مرفوض
    assert.equal(addMessage({ ...msg, transport: "mesh" }), false);
    assert.equal(state.messages.filter((m) => m.id === id).length, 1);
  } finally {
    state.messages.length = 0;
    state.messages.push(...snapshot); // استعادة الحالة الأصلية
  }
});

test("رسالة الإرسال تحمل id مشترك بين المسارات (newMessageId)", () => {
  const main = read("sila/src/main.js");
  assert.ok(main.includes("id: newMessageId()"), "outgoing messages must carry an id");
  assert.ok(main.includes("rtcService.send(message)"), "P2P path must be attempted");
  assert.ok(main.includes("netBridge.send(message)"), "server path must always be attempted");
});
