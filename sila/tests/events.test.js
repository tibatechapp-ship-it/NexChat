import test from "node:test";
import assert from "node:assert/strict";

import "./setup.js";

/**
 * عنصر وهمي يدعم `closest(selector)` كما يفعل DOM الحقيقي —
 * يكفي لاختبار التفويض (event delegation) بلا jsdom.
 */
function fakeTarget({ transport, room, id } = {}) {
  const element = {
    dataset: {
      ...(transport ? { transport } : {}),
      ...(room ? { room } : {}),
    },
    closest(selector) {
      if (selector === "[data-transport]") return element.dataset.transport ? element : null;
      if (selector === "[data-room]") return element.dataset.room ? element : null;
      if (id && selector === id) return element;
      return null;
    },
  };
  return element;
}

function installFakeDom() {
  const root = {
    handlers: {},
    addEventListener(type, fn) {
      this.handlers[type] = fn;
    },
    dispatch(type, event) {
      assert.ok(this.handlers[type], `لا مستمع لحدث ${type}`);
      return this.handlers[type](event);
    },
  };
  globalThis.document = {
    querySelector: (selector) => (selector === "#app" ? root : null),
  };
  return root;
}

test("bindEvents يفوض النقر لوسيلة النقل", async () => {
  const root = installFakeDom();
  const { bindEvents } = await import("../src/components/eventHandlers.js");
  const calls = [];
  const handlers = {
    onTransportChange: (value) => calls.push(["transport", value]),
    onRoomChange: (value) => calls.push(["room", value]),
    onSendMessage: () => calls.push(["send"]),
    onRefreshPeers: () => calls.push(["refresh"]),
    onShareRoom: () => calls.push(["share"]),
    onCreateRoom: () => calls.push(["create"]),
  };
  bindEvents(handlers);

  root.dispatch("click", { target: fakeTarget({ transport: "internet" }) });
  root.dispatch("click", { target: fakeTarget({ room: "فريق الرحلة" }) });
  root.dispatch("click", { target: fakeTarget({ id: "#refresh-peers" }) });
  root.dispatch("click", { target: fakeTarget({ id: "#share-room" }) });
  root.dispatch("click", { target: fakeTarget({ id: "#new-room" }) });

  assert.deepEqual(calls, [
    ["transport", "internet"],
    ["room", "فريق الرحلة"],
    ["refresh"],
    ["share"],
    ["create"],
  ]);
});

test("bindEvents يتجاهل النقر خارج الأهداف المعروفة", async () => {
  const root = installFakeDom();
  const { bindEvents } = await import("../src/components/eventHandlers.js");
  let called = 0;
  bindEvents({
    onTransportChange: () => called++,
    onRoomChange: () => called++,
    onSendMessage: () => called++,
    onRefreshPeers: () => called++,
    onShareRoom: () => called++,
    onCreateRoom: () => called++,
  });
  root.dispatch("click", { target: fakeTarget() });
  assert.equal(called, 0);
});

test("bindEvents يمنع إرسال النموذج الافتراضي داخل #composer", async () => {
  const root = installFakeDom();
  const { bindEvents } = await import("../src/components/eventHandlers.js");
  let sent = 0;
  let prevented = false;
  bindEvents({
    onTransportChange: () => {},
    onRoomChange: () => {},
    onSendMessage: () => sent++,
    onRefreshPeers: () => {},
    onShareRoom: () => {},
    onCreateRoom: () => {},
  });

  root.dispatch("submit", {
    target: fakeTarget({ id: "#composer" }),
    preventDefault: () => {
      prevented = true;
    },
  });

  assert.equal(sent, 1);
  assert.equal(prevented, true);
});
