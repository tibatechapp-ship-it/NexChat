import test from "node:test";
import assert from "node:assert/strict";

import "./setup.js";
import { state, addPeer } from "../src/state/appState.js";
import {
  renderApp,
  renderMessages,
  renderRoomList,
  renderPeers,
  describePeerCount,
} from "../src/components/uiRenderer.js";

test("renderMessages يهرّب محتوى الرسالة (XSS)", () => {
  state.messages.push({
    author: '<img src=x onerror="alert(1)">',
    initials: "<b>",
    time: "10:00",
    text: "<script>alert('xss')</script>",
    mine: false,
    transport: "mesh",
  });
  const rendered = renderMessages();
  assert.ok(rendered.includes("&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;"));
  assert.ok(rendered.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
  assert.ok(!rendered.includes("<script>alert"));
  state.messages.pop();
});

test("renderMessages يميّز رسائل صاحب الجهاز ووسيلة النقل", () => {
  const html = renderMessages();
  const mine = html.match(/class="message mine"/g) ?? [];
  assert.ok(mine.length >= 1);
  assert.ok(html.includes('class="route mesh"'));
});

test("renderRoomList يعلّم الغرفة النشطة ويهرّب الأسماء", () => {
  const html = renderRoomList();
  assert.ok(html.includes("active"));
  assert.ok(html.includes("ساحة الحي"));
  assert.ok(html.includes("data-room="));
});

test("renderPeers يعرض حالة فارغة عند عدم وجود عقد", () => {
  state.peers.clear();
  const html = renderPeers();
  assert.ok(html.includes("peer-empty"));
  assert.ok(html.includes("لا توجد عقد أخرى بعد"));
});

test("renderPeers يعرض العقد الحقيقية فقط", () => {
  state.peers.clear();
  addPeer("node-abc123", Date.now());
  const html = renderPeers();
  assert.ok(html.includes("node-abc"), "يعرض بداية معرف العقدة");
  assert.ok(html.includes("متصل عبر Mesh"));
  assert.ok(!html.includes("ليان"), "لا أسماء تجريبية");
  assert.ok(!html.includes("سامر"));
  assert.ok(!html.includes("ندى"));
});

test("describePeerCount يصوغ الأعداد بالعربية", () => {
  assert.equal(describePeerCount(0), "لا عقد قريبة بعد");
  assert.equal(describePeerCount(1), "عقدة واحدة قريبة");
  assert.equal(describePeerCount(2), "عقدتان قريبتان");
  assert.equal(describePeerCount(5), "5 عقد قريبة");
  assert.equal(describePeerCount(12), "12 عقدة قريبة");
});

test("renderApp يبني الهيكل كاملاً ويستخدم الحالة الفعلية", () => {
  state.peers.clear();
  const html = renderApp();
  assert.ok(html.includes('<main class="shell">'));
  assert.ok(html.includes(state.activeRoom));
  assert.ok(html.includes('id="composer"'));
  assert.ok(html.includes("لا عقد قريبة بعد"));
});
