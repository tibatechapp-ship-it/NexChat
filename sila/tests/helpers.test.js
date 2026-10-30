import test from "node:test";
import assert from "node:assert/strict";

import "./setup.js";
import { escapeHtml, formatTime, generateNodeId } from "../src/utils/helpers.js";

test("escapeHtml يهرّب وسوم HTML كاملة", () => {
  assert.equal(
    escapeHtml("<script>alert('x')</script>"),
    "&lt;script&gt;alert(&#039;x&#039;)&lt;/script&gt;",
  );
});

test("escapeHtml يهرّب علامات الاقتباس داخل السمات", () => {
  assert.equal(
    escapeHtml('<img src=x onerror="alert(1)">'),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
  );
});

test("escapeHtml يهرّب علامة العطف قبل بقية الوسوم", () => {
  assert.equal(escapeHtml("a & b"), "a &amp; b");
});

test("escapeHtml يحوّل القيم غير النصية بدل الانهيار", () => {
  assert.equal(escapeHtml(42), "42");
  assert.equal(escapeHtml(null), "null");
  assert.equal(escapeHtml(undefined), "undefined");
});

test("generateNodeId يعيد 8 أحرف سداسية عشرية", () => {
  assert.match(generateNodeId(), /^[0-9a-f]{8}$/);
});

test("formatTime يعيد وقتاً بصيغة ساعة:دقيقة", () => {
  // اللغة العربية قد تستعمل أرقاماً هندية (٠٩:٠٥) — نقبل الشكلين.
  assert.match(
    formatTime(new Date(2026, 0, 1, 9, 5)),
    /^[\d٠-٩]{1,2}:[\d٠-٩]{2}(\s*[صم])?$/u,
  );
});
