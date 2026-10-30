/**
 * crdt.test.js — اختبارات اللوحة المشتركة (CRDT — P2 #12).
 *
 * الضمانة الجوهرية: **التقارب** — كل النسخ تصل لنفس الحالة بغض النظر عن
 * ترتيب وصول العمليات أو تكرارها أو انقطاع العقد. هذه الخصائص تشترطها
 * الرياضيات (التجميع/التبادل/الانتصام) وكل اختبار هنا يتحقق من جانب منها.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GCounter, LWWList, SharedBoard, newOpId } from "../src/services/crdt.js";

describe("GCounter — عدّاد ينمو فقط", () => {
  test("زيادة كل عقدة على خانتها فقط ويجمع القيمة", () => {
    const c = new GCounter();
    c.inc("a", 2);
    c.inc("b", 5);
    c.inc("a", 1);
    assert.equal(c.value(), 8);
  });

  test("تجاهل الزيادة غير الموجبة", () => {
    const c = new GCounter();
    c.inc("a", 0);
    c.inc("a", -3);
    assert.equal(c.value(), 0);
  });

  test("الدمج تبادلي وانتصامي (نفس النتيجة بأي ترتيب وبأي تكرار)", () => {
    const a = new GCounter({ a: 3 });
    const b = new GCounter({ b: 4 });
    const ab1 = new GCounter({ a: 3 }).merge(b);
    const ab2 = new GCounter({ b: 4 }).merge(a);
    assert.equal(ab1.value(), 7);
    assert.equal(ab2.value(), 7);
    // انتصام: دمج متكرر لا يغيّر شيئاً
    assert.equal(new GCounter(ab1.toJSON()).merge(ab2).value(), 7);
  });

  test("الدمج يأخذ الأكبر لكل خانة — لا جمع مزدوج عند مزج النسخ", () => {
    const a = new GCounter({ a: 10 });
    const b = new GCounter({ a: 4, b: 2 });
    a.merge(b);
    assert.deepEqual(a.toJSON(), { a: 10, b: 2 });
    assert.equal(a.value(), 12);
  });
});

describe("LWWList — قائمة آخر-كاتب-يفوز", () => {
  test("إضافة ثم حذف ثم إضافة متأخرة: الحذف الأحدث يفوز", () => {
    const l = new LWWList();
    l.add("x", "قيمة", 100);
    l.remove("x", 200);
    // إضافة متأخرة بطابع أقدم — يجب ألا تُحيي العنصر
    l.add("x", "قيمة", 150);
    assert.equal(l.size(), 0);
  });

  test("كسر التعادل: الحذف يفوز عند تساوي الطابع الزمني", () => {
    const l = new LWWList();
    l.add("x", "قيمة", 100);
    l.remove("x", 100);
    assert.equal(l.size(), 0);
  });

  test("الترتيب حتمي: (ts ثم id) بغض النظر عن ترتيب الوصول", () => {
    const build = (order) => {
      const l = new LWWList();
      for (const [id, ts] of order) l.add(id, "v-" + id, ts);
      return l.toList();
    };
    const x1 = build([["b", 2], ["a", 1], ["c", 2]]);
    const x2 = build([["c", 2], ["b", 2], ["a", 1]]);
    assert.deepEqual(x1, x2);
    assert.deepEqual(x1.map((e) => e.id), ["a", "b", "c"]);
  });

  test("حذف ظل (rem قبل add): القبر الحجري يمنع إحياء العنصر", () => {
    const l = new LWWList();
    l.remove("ghost", 500); // حذف لعنصر لم تصل إضافته بعد
    l.add("ghost", "متأخر", 100);
    assert.equal(l.size(), 0);
    // لكن إضافة أحدث من الحذف تعمل طبيعياً
    l.add("ghost", "أحدث", 600);
    assert.equal(l.size(), 1);
  });

  test("دمج نسختين مختلفتين يتقارب في الاتجاهين", () => {
    const a = new LWWList();
    const b = new LWWList();
    a.add("1", "عند أ", 100);
    b.add("2", "عند ب", 200);
    b.remove("1", 300);
    a.merge(b);
    b.merge(a);
    assert.deepEqual(a.toList(), b.toList());
    assert.deepEqual(a.toList(), [{ id: "2", value: "عند ب", ts: 200 }]);
  });
});

describe("SharedBoard — العمليات وإزالة التكرار", () => {
  test("زيادتان متتاليتان لنفس العقدة تُجمعان (لا يبتلع الدمج الأكبر)", () => {
    const b = new SharedBoard("n1");
    b.increment();
    b.increment(3);
    assert.equal(b.counter.value(), 4);
  });

  test("إزالة التكرار بمعرف العملية: النسخة الثانية عبر مسار آخر تُرفض", () => {
    const b = new SharedBoard("n1");
    const op = { t: "inc", n: "n2", by: 1, oid: "same-oid" };
    assert.equal(b.applyOp(op), true);
    assert.equal(b.applyOp({ ...op }), false); // وصلت من مسار ثانٍ
    assert.equal(b.counter.value(), 1);
  });

  test("إزالة التكرار بالمحتوى لعمليات بلا معرّف", () => {
    const b = new SharedBoard("n1");
    const op = { t: "inc", n: "n2", by: 2 };
    assert.equal(b.applyOp(op), true);
    assert.equal(b.applyOp(JSON.parse(JSON.stringify(op))), false);
    assert.equal(b.counter.value(), 2);
  });

  test("العمليات غير الصالحة تُرفض دون أن تفسد الحالة", () => {
    const b = new SharedBoard("n1");
    assert.equal(b.applyOp(null), false);
    assert.equal(b.applyOp({}), false);
    assert.equal(b.applyOp({ t: "inc", n: "" }), false);
    assert.equal(b.applyOp({ t: "add", el: "x", v: 42 }), false); // قيمة غير نصية
    assert.equal(b.applyOp({ t: "unknown" }), false);
    assert.equal(b.counter.value(), 0);
    assert.equal(b.list.size(), 0);
  });

  test("النشر عبر onOp والتغيير عبر onChange", () => {
    const b = new SharedBoard("n1");
    const emitted = [];
    let changes = 0;
    b.onOp((op) => emitted.push(op));
    b.onChange(() => changes++);
    b.increment();
    b.addItem("عنصر");
    assert.equal(emitted.length, 2);
    assert.equal(changes, 2);
    assert.equal(emitted[0].t, "inc");
    assert.equal(emitted[1].t, "add");
  });

  test("التقارب الكامل: عقدتان تبادلان عمليات مختلطة ومكررة ومتأخرة", () => {
    const alice = new SharedBoard("alice");
    const bob = new SharedBoard("bob");

    const aOps = [];
    const bOps = [];
    alice.onOp((op) => bOps.push(op));
    bob.onOp((op) => aOps.push(op));

    alice.increment();
    bob.increment();
    alice.addItem("حليب");
    bob.addItem("خبز");
    alice.increment(2);

    // وصول مكرر وبترتيب مختل (النقل المزدوج يعيد الرسالة أحياناً)
    // ملاحظة: aOps عمليات بوب التي يجب أن تصل لأليس، والعكس صحيح.
    for (const op of [...aOps, ...aOps].reverse()) alice.applyOp(op);
    for (const op of [...bOps, ...bOps].reverse()) bob.applyOp(op);

    assert.equal(alice.counter.value(), bob.counter.value()); // 1+1+2 = 4
    assert.equal(alice.counter.value(), 4);
    assert.deepEqual(alice.list.toList().map((e) => e.value).sort(), ["حليب", "خبز"]); // ترتيب يونيكود: ح ثم خ
    assert.deepEqual(alice.list.toList(), bob.list.toList());
  });

  test("لقطة الحالة تدمج انضماماً متأخراً بعد انقطاع طويل", () => {
    const alice = new SharedBoard("alice");
    const bob = new SharedBoard("bob");
    alice.increment();
    alice.addItem("مهمة قديمة", );
    alice.increment(5);

    // بوب انضم متأخراً — استلم لقطة alice
    bob.loadSnapshot(alice.snapshot());
    assert.equal(bob.counter.value(), 6);
    assert.equal(bob.list.size(), 1);

    // ثم استلم عمليات مكررة قديمة — لا شيء يتغير (انتصام)
    bob.loadSnapshot(alice.snapshot());
    assert.equal(bob.counter.value(), 6);
  });
});
