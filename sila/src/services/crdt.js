/**
 * crdt — أنواع بيانات مكرَّرة تلتقي (CRDT) للوحة صلة المشتركة.
 *
 * P2 #12 من بحث الميزات — نمط Offline Protocol: مستندات صغيرة للحالة
 * المشتركة (قائمة + عدّاد) تتزامن عبر عقد الشبكة حتى مع وصول العمليات
 * بترتيب مختل، تكرار، أو تأخير طويل — فتتقارب كل النسخ على نفس الحالة
 * أخيراً بلا خادم مركزي للحقيقة.
 *
 * الأنواع هنا:
 * - GCounter: عدّاد ينمو فقط (كل عقدة تزيد خانتها فقط، الدمج يأخذ الأكبر)
 *   — مثالي لعدّادات مشتركة (عدد المشاركين، التسلسل...).
 * - LWWList: قائمة عناصر بـ"آخر كاتب يفوز" مع كسر تعادل حتمي: عنصر
 *   يُعرَّف بمعرّف فريد، الإضافة/الحذف يحملان طابعاً زمنياً، وفي التساوي
 *   الحذف يفوز (الأكثر أماناً — عنصر حُذف لا يعود بالظهور).
 *
 * كل شيء دوال نقية + فئات بلا I/O — تُستخدم من main.js وتُختبر في Node.
 */

/** عدّاد ينمو فقط (Grow-only Counter). */
export class GCounter {
  constructor(counts = {}) {
    this.counts = { ...counts }; // nodeId -> number
  }

  /** زيادة خانة هذه العقدة فقط — لا أحد غيرها يعدّلها. */
  inc(nodeId, by = 1) {
    const n = Number(by);
    if (!Number.isFinite(n) || n <= 0) return this.value();
    this.counts[nodeId] = (this.counts[nodeId] || 0) + Math.floor(n);
    return this.value();
  }

  value() {
    let sum = 0;
    for (const k in this.counts) sum += this.counts[k] || 0;
    return sum;
  }

  /**
   * الدمج استبدالي: الأكبر لكل خانة يفوز — تجميعي وتبادلي وانتصامي.
   * يرجع this ليتسلسل (consistent مع LWWList.merge).
   */
  merge(other) {
    const src = other instanceof GCounter ? other.counts : (other || {});
    for (const k in src) {
      const v = Number(src[k]) || 0;
      if (v > (this.counts[k] || 0)) this.counts[k] = v;
    }
    return this;
  }

  toJSON() { return { ...this.counts }; }
  static fromJSON(data) { return new GCounter(data && typeof data === "object" ? data : {}); }
}

/**
 * قائمة عناصر بآخر-كاتب-يفوز. الحالة الداخلية: خريطة
 * id -> { value, ts, del }. القاعدة: (ts الأكبر يفوز) وعند التساوي
 * الحذف يفوز على الإضافة — حتمي مهما اختلف ترتيب الوصول.
 */
export class LWWList {
  constructor(elements = {}) {
    this.elements = {};
    for (const id in elements) {
      const e = elements[id];
      if (!e || typeof e !== "object") continue;
      this.elements[id] = {
        value: typeof e.value === "string" ? e.value : "",
        ts: Number(e.ts) || 0,
        del: !!e.del,
      };
    }
  }

  add(id, value, ts) {
    const t = Number(ts) || 0;
    const cur = this.elements[id];
    if (!cur || t > cur.ts || (t === cur.ts && cur.del)) {
      this.elements[id] = { value: String(value ?? ""), ts: t, del: false };
    }
  }

  remove(id, ts) {
    const t = Number(ts) || 0;
    const cur = this.elements[id];
    if (!cur) {
      // حذف لعملية لم تصل بعد (shadows): نحفظ القبر الحجري (tombstone) كي
      // لا تعيد الإضافة المتأخرة إحياء العنصر.
      this.elements[id] = { value: "", ts: t, del: true };
      return;
    }
    if (t > cur.ts || (t === cur.ts && !cur.del)) {
      cur.del = true;
      cur.ts = Math.max(cur.ts, t);
    }
  }

  /** دمج حالة أخرى (أو نسخة JSON) — عنصراً بعنصر بنفس قواعد الإضافة/الحذف. */
  merge(other) {
    const src = other instanceof LWWList ? other.elements : (other || {});
    for (const id in src) {
      const e = src[id];
      if (!e || typeof e !== "object") continue;
      if (e.del) this.remove(id, e.ts);
      else this.add(id, e.value, e.ts);
    }
    return this;
  }

  /** العناصر الحية مرتبة بـ(ts ثم id) — ترتيب حتمي متطابق في كل النسخ. */
  toList() {
    return Object.entries(this.elements)
      .filter(([, e]) => !e.del)
      .sort((a, b) => a[1].ts - b[1].ts || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([id, e]) => ({ id, value: e.value, ts: e.ts }));
  }

  size() { return this.toList().length; }
  has(id) { return !!this.elements[id] && !this.elements[id].del; }

  toJSON() {
    const out = {};
    for (const id in this.elements) out[id] = { ...this.elements[id] };
    return out;
  }
  static fromJSON(data) { return new LWWList(data && typeof data === "object" ? data : {}); }
}

let opSeq = 0;

/** معرّف عملية فريد (لإزالة التكرار عبر مسارات النقل المتعددة). */
export function newOpId(nodeId) {
  opSeq = (opSeq + 1) % 1e9;
  return "o" + Date.now().toString(36) + nodeId + opSeq.toString(36);
}

/**
 * اللوحة المشتركة: عدّاد + قائمة + نشر العمليات عبر مسارات النقل.
 * المرسل يطبّق محلياً ثم ينشر؛ المستقبل يطبّق ويتجاهل المكرَّر.
 */
export class SharedBoard {
  constructor(nodeId) {
    this.nodeId = String(nodeId);
    this.counter = new GCounter();
    this.list = new LWWList();
    this.seen = new Set(); // معرفات العمليات المستلمة (إزالة تكرار النقل المزدوج)
    this.onOpCallback = null;
    this.onChangeCallback = null;
  }

  onOp(cb) { this.onOpCallback = cb; }
  onChange(cb) { this.onChangeCallback = cb; }

  _emit(op) {
    if (this.onOpCallback) { try { this.onOpCallback(op); } catch {} }
  }

  /** تطبيق عملية واردة (من أي مسار) — يرجع true إذا غيّرت الحالة. */
  applyOp(op) {
    if (!op || typeof op !== "object" || typeof op.t !== "string") return false;

    // لقطة كاملة من عقدة انضمت حديثاً / عادت من الانقطاع — دمج حالة
    // (state-based) ولذلك لا يحتاج إزالة تكرار: الدمج انتصامي.
    if (op.t === "state") {
      const before = this.snapshot();
      this.counter.merge(GCounter.fromJSON(op.counter));
      this.list.merge(LWWList.fromJSON(op.list));
      const changed = JSON.stringify(before) !== JSON.stringify(this.snapshot());
      if (changed && this.onChangeCallback) { try { this.onChangeCallback(); } catch {} }
      return changed;
    }

    // إزالة تكرار النقل المزدوج: بمعرف العملية إن وُجد وإلا بمحتواها.
    // مهم خصوصاً للزيادة (inc): غير انتصامية، والتكرار يضاعف العد.
    const key = op.oid != null ? "i:" + String(op.oid) : "c:" + JSON.stringify(op);
    if (this.seen.has(key)) return false;

    let valid = false;
    switch (op.t) {
      case "inc": {
        if (typeof op.n !== "string" || !op.n.length || op.n.length > 64) return false;
        const by = Math.max(1, Math.floor(Number(op.by) || 1));
        // عقدة واحدة تملك خانتها فقط — جمع على الخانة، والدمج (للقطع) يأخذ الأكبر.
        this.counter.counts[op.n] = (this.counter.counts[op.n] || 0) + by;
        valid = true;
        break;
      }
      case "add": {
        if (typeof op.el !== "string" || !op.el.length || op.el.length > 64) return false;
        if (typeof op.v !== "string" || op.v.length > 200) return false;
        this.list.add(op.el, op.v, Number(op.ts) || 0);
        valid = true;
        break;
      }
      case "rem": {
        if (typeof op.el !== "string" || !op.el.length || op.el.length > 64) return false;
        this.list.remove(op.el, Number(op.ts) || 0);
        valid = true;
        break;
      }
      default:
        return false;
    }

    if (!valid) return false;
    this.seen.add(key);
    if (this.seen.size > 5000) {
      const it = this.seen.values();
      for (let i = 0; i < 1000; i++) this.seen.delete(it.next().value);
    }
    if (this.onChangeCallback) { try { this.onChangeCallback(); } catch {} }
    return true;
  }

  // --- العمليات المحلية: تطبيق + نشر ---
  increment(by = 1) {
    const op = { t: "inc", n: this.nodeId, by: Math.max(1, Math.floor(Number(by) || 1)), oid: newOpId(this.nodeId) };
    this.applyOp(op); // ملاحظة: applyOp يرى oid يُسجَّل أيضاً
    this._emit(op);
    return op;
  }

  addItem(value) {
    const op = { t: "add", el: newOpId(this.nodeId), v: String(value ?? "").slice(0, 200), ts: Date.now(), oid: newOpId(this.nodeId) };
    this.applyOp(op);
    this._emit(op);
    return op;
  }

  removeItem(id) {
    const op = { t: "rem", el: String(id), ts: Date.now(), oid: newOpId(this.nodeId) };
    this.applyOp(op);
    this._emit(op);
    return op;
  }

  /** لقطة تُرسل لعقدة انضمت حديثاً. */
  snapshot() {
    return { t: "state", counter: this.counter.toJSON(), list: this.list.toJSON() };
  }

  loadSnapshot(op) { return this.applyOp(op); }
}
