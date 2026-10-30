/**
 * بيئة اختبار بسيطة بلا اعتماديات خارجية.
 *
 * - `navigator` موجود أصلاً في Node، لكن بدون `onLine` — نضبطه.
 * - `BroadcastChannel` الحقيقي غير متاح في Node، فنستعمل حافلة داخلية
 *   تسمح لعقدتين بالتحادث فعلياً داخل الاختبار.
 */
export const channels = new Map();

class FakeBroadcastChannel {
  constructor(name) {
    this.name = name;
    this.onmessage = null;
    this.closed = false;
    if (!channels.has(name)) channels.set(name, new Set());
    channels.get(name).add(this);
  }

  postMessage(data) {
    if (this.closed) throw new Error("BroadcastChannel is closed");
    for (const channel of channels.get(this.name) ?? []) {
      if (channel === this || channel.closed) continue;
      // النسخة الحقيقية تمرّر الحدث بشكل غير متزامن — نفس السلوك هنا.
      queueMicrotask(() => channel.onmessage?.({ data }));
    }
  }

  close() {
    this.closed = true;
    channels.get(this.name)?.delete(this);
  }
}

globalThis.BroadcastChannel = FakeBroadcastChannel;

if (typeof globalThis.navigator !== "object" || globalThis.navigator === null) {
  globalThis.navigator = { onLine: true };
} else if (typeof globalThis.navigator.onLine === "undefined") {
  Object.defineProperty(globalThis.navigator, "onLine", {
    value: true,
    configurable: true,
  });
}
