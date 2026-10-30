// Rasan Panic — مسح الذعر + وضع الإضطرار (P2 #11 — نمط Briar).
//
// ثلاث طبقات تعمل معاً:
// 1. قفل اختياري برمز (4-8 أرقام): شاشة قفل فوق التطبيق عند فتحه.
// 2. رمز إضطرار: إدخاله على شاشة القفل يمسح كل البيانات المحلية فوراً
//    ويعرض شاشة دخول فارغة (الديكور) — لا أحد يميّز أنه حدث شيء.
// 3. مسح محلي فوري + مسح الحساب عن بُعد (server/panic.js — بكلمة المرور).
//
// الأرقام تُخزَّن مُشتقة PBKDF2-SHA256 (200k) بملح عشوائي — النص الأصلي
// لا يُخزَّن أبداً. كل منطق التحقق هنا نقي ويعمل في Node للاختبارات.

const LOCK_KEY = "rasan_lock_pin";
const DURESS_KEY = "rasan_duress_pin";
const PBKDF2_ITERATIONS = 200000;

const enc = new TextEncoder();

function b64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function unb64(s) { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }

// مقارنة ثابتة الزمن — لا تسريب بجانب التوقيت.
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function pbkdf2Hex(pin, saltB64, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(String(pin)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: unb64(saltB64), iterations },
    key, 256
  );
  return b64(bits);
}

function randomSaltB64() { return b64(crypto.getRandomValues(new Uint8Array(16))); }

/** صيغة رمز مقبول: 4-8 أرقام. */
export function isValidPin(pin) {
  return typeof pin === "string" && /^[0-9]{4,8}$/.test(pin);
}

/** يبني سجل تخزين للرمز — يُخزَّن JSON في localStorage. */
export async function makePinRecord(pin) {
  if (!isValidPin(pin)) throw new Error("bad pin");
  const salt = randomSaltB64();
  const hash = await pbkdf2Hex(pin, salt, PBKDF2_ITERATIONS);
  return { v: 1, salt, iterations: PBKDF2_ITERATIONS, hash };
}

/** يتحقق من رمز مقابل سجل مخزَّن — بلا أي استثناء على مدخل تالف. */
export async function verifyPin(pin, record) {
  try {
    if (!record || record.v !== 1 || !isValidPin(pin)) return false;
    const hash = await pbkdf2Hex(pin, record.salt, record.iterations);
    return safeEqual(hash, record.hash);
  } catch { return false; }
}

/** قرار الإدخال على شاشة القفل: الإضطرار يفوز دائماً على القفل عند التطابق. */
export async function evaluateEntry(pin, lockRecord, duressRecord) {
  if (duressRecord && (await verifyPin(pin, duressRecord))) return "wipe";
  if (lockRecord && (await verifyPin(pin, lockRecord))) return "unlock";
  return "deny";
}

// ===== المسح المحلي — Briar الذري: كل بيانات رسن على هذا الجهاز =====

const RASAN_LS_PREFIX = "rasan_";

export function sweepLocalStorage() {
  const doomed = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (typeof k === "string" && k.startsWith(RASAN_LS_PREFIX)) doomed.push(k);
  }
  for (const k of doomed) localStorage.removeItem(k);
  try { sessionStorage.clear(); } catch {}
  return doomed;
}

/** مسح IndexedDB المعروف + كل قواعد البيانات الممكنة عند توفر databases(). */
export async function wipeIndexedDB() {
  const names = new Set(["rasan-sessions"]);
  try {
    const dbs = await indexedDB.databases?.();
    if (Array.isArray(dbs)) for (const d of dbs) if (d?.name) names.add(d.name);
  } catch {}
  await Promise.all([...names].map((name) => new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch { resolve(); }
  })));
  return [...names];
}

/** إلغاء Service Worker وحذف كل الكاشات (أصل رسن بالكامل لنا). */
export async function wipeServiceWorker() {
  try {
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => {})));
    }
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => {})));
    }
  } catch {}
}

/**
 * المسح المحلي الكامل: localStorage + sessionStorage + IndexedDB + SW/caches.
 * يعمل بلا شبكة إطلاقاً — لحظي من منظور المستخدم.
 */
export async function wipeLocal() {
  sweepLocalStorage();
  await wipeIndexedDB();
  await wipeServiceWorker();
}

/** قراءة/كتابة سجلات الرموز — معزولة هنا لتنظيف أسهل. */
export function readRecord(storage, key) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const rec = JSON.parse(raw);
    return rec && rec.v === 1 ? rec : null;
  } catch { return null; }
}
export function writeRecord(storage, key, record) {
  try { storage.setItem(key, JSON.stringify(record)); return true; } catch { return false; }
}
export function clearRecord(storage, key) {
  try { storage.removeItem(key); } catch {}
}

// ===== ربط الواجهة — يعمل في المتصفح فقط (اختبارات Node تستورد الدوال فقط) =====

export async function initPanicUI({ api } = {}) {
  if (typeof document === "undefined") return;

  const $ = (id) => document.getElementById(id);
  const lockRec = () => readRecord(localStorage, LOCK_KEY);
  const duressRec = () => readRecord(localStorage, DURESS_KEY);

  // --- شاشة القفل ---
  let attempts = 0;
  let cooldownUntil = 0;

  async function showLock() {
    if (!lockRec() || !localStorage.getItem("rasan_token")) return; // لا رمز ولا جلسة → لا قفل
    $("lock-overlay").classList.remove("hidden");
    $("lock-pin").value = "";
    setTimeout(() => $("lock-pin").focus(), 50);
  }

  async function tryEntry() {
    const now = Date.now();
    if (now < cooldownUntil) return;
    const pin = $("lock-pin").value;
    const verdict = await evaluateEntry(pin, lockRec(), duressRec());
    if (verdict === "unlock") {
      $("lock-overlay").classList.add("hidden");
      attempts = 0;
      return;
    }
    if (verdict === "wipe") {
      // الإضطرار: مسح ذري فوري ثم شاشة دخول نظيفة — الديكور (Briar).
      await wipeLocal();
      location.reload();
      return;
    }
    attempts++;
    if (attempts >= 5) {
      cooldownUntil = now + 30000;
      attempts = 0;
      $("lock-err").textContent = "محاولات كثيرة — انتظر 30 ثانية";
    } else {
      $("lock-err").textContent = "رمز خاطئ";
    }
  }

  $("lock-unlock").addEventListener("click", tryEntry);
  $("lock-pin").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); tryEntry(); } });

  // --- نافذة الخصوصية ---
  function openPanicModal() { $("panic-modal").classList.remove("hidden"); refreshPanicState(); }
  function closePanicModal() { $("panic-modal").classList.add("hidden"); }
  $("lock-btn").addEventListener("click", openPanicModal);
  $("panic-close").addEventListener("click", closePanicModal);

  function refreshPanicState() {
    $("panic-lock-state").textContent = lockRec() ? "القفل مفعّل" : "القفل غير مفعّل";
    $("panic-duress-state").textContent = duressRec() ? "رمز الإضطرار مضبوط" : "غير مضبوط";
  }

  async function setPinPair(keyLabel, inputId, otherKey) {
    const a = $(inputId).value.trim();
    const b = $(inputId + "2").value.trim();
    if (!isValidPin(a) || a !== b) { $(inputId + "-err").textContent = "أدخل نفس الرمز (4-8 أرقام) في الحقلين"; return; }
    if (otherKey) {
      const other = readRecord(localStorage, otherKey);
      if (other && await verifyPin(a, other)) { $(inputId + "-err").textContent = "يجب أن يختلف عن الرمز الآخر"; return; }
    }
    writeRecord(localStorage, keyLabel, await makePinRecord(a));
    $(inputId).value = ""; $(inputId + "2").value = ""; $(inputId + "-err").textContent = "";
    refreshPanicState();
  }

  $("lock-set").addEventListener("click", () => setPinPair(LOCK_KEY, "lock-new", DURESS_KEY));
  $("lock-clear").addEventListener("click", () => { clearRecord(localStorage, LOCK_KEY); refreshPanicState(); });
  $("duress-set").addEventListener("click", () => setPinPair(DURESS_KEY, "duress-new", LOCK_KEY));
  $("duress-clear").addEventListener("click", () => { clearRecord(localStorage, DURESS_KEY); refreshPanicState(); });

  // قفل الآن — يعرض شاشة القفل فوراً
  $("lock-now").addEventListener("click", () => { closePanicModal(); showLock(); });

  // المسح المحلي الفوري — يتطلب كتابة كلمة التأكيد
  $("local-wipe-btn").addEventListener("click", async () => {
    if ($("local-wipe-confirm").value.trim() !== "امسح") {
      $("local-wipe-err").textContent = 'اكتب "امسح" للتأكيد';
      return;
    }
    await wipeLocal();
    location.reload();
  });

  // المسح عن بُعد — حذف الحساب من الخادم بكلمة المرور ثم المسح المحلي
  $("remote-wipe-btn").addEventListener("click", async () => {
    const password = $("remote-wipe-password").value;
    if (!password) { $("remote-wipe-err").textContent = "أدخل كلمة المرور"; return; }
    const token = localStorage.getItem("rasan_token");
    if (!token) { $("remote-wipe-err").textContent = "لا جلسة نشطة"; return; }
    try {
      const r = await fetch("/api/account/wipe", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ password }),
      });
      if (!r.ok) {
        $("remote-wipe-err").textContent = r.status === 401 ? "كلمة المرور خاطئة" : "تعذر المسح (" + r.status + ")";
        return;
      }
      await wipeLocal();
      location.reload();
    } catch {
      $("remote-wipe-err").textContent = "تعذر الاتصال بالخادم";
    }
  });

  // شاشة القفل تظهر عند الإقلاع إن كان القفل مضبوطاً وهناك جلسة
  showLock();
}

// تمرير api (اختياري) لأغراض الاختبار فقط
if (typeof module !== "undefined" && module.exports) {
  module.exports = { initPanicUI };
}

// التشغيل الذاتي في المتصفح فقط: عنصر زر القفل موجود في index.html الفعلي
// (وغيابه في بيئات الاختبار يمنع أي ربط DOM هناك).
if (typeof document !== "undefined" && document.getElementById("lock-btn")) {
  initPanicUI().catch((e) => { try { console.error("panic UI failed", e); } catch {} });
}
