/**
 * netBridge — نقل صلة عبر خادم رسن (نفس الأصل) بين أجهزة مختلفة.
 *
 * BroadcastChannel يصل فقط بين تبويبات نفس المتصفح. هذا الجسر يضيف النقل
 * الحقيقي عبر مساحة /sila في Socket.IO (server/sila-mesh.js): كل جهاز يفتح
 * الصفحة من الخادم يصبح عقدة في نفس الساحة — على الشبكة المحلية يعمل بلا
 * إنترنت خارجي، وعبر الإنترنت عند توفره (واجهة هجينة كما صُممت صلة).
 *
 * يعمل إذا وُجد window.io فقط (يحمَّل من /socket.io/socket.io.js على نفس
 * الأصل). خلاف ذلك يبقى صامتاً والتطبيق يعمل بنقل BroadcastChannel وحده.
 *
 * الأمان: رسائل هذه المساحة غير مشفرة طرف-لطرف (نموذج أولي) — راجع
 * docs/FEATURE_RESEARCH.md وقسم الأمان في README.
 */

const DEFAULT_ROOM = "square";

export class NetBridge {
  constructor(nodeId, room = DEFAULT_ROOM) {
    this.nodeId = nodeId;
    this.room = room;
    this.socket = null;
    this.connected = false;
    this.onMessageCallback = null;
    this.onPresenceCallback = null;
    this.onLeaveCallback = null;
    this.onStateChangeCallback = null;
  }

  connect() {
    if (typeof window === "undefined" || typeof window.io !== "function") return false;

    this.socket = window.io("/sila", { transports: ["websocket", "polling"], timeout: 4000 });

    this.socket.on("connect", () => {
      this.connected = true;
      this.socket.emit("sila:join", { room: this.room });
      this.announce();
      this.onStateChangeCallback?.(true);
    });

    this.socket.on("disconnect", () => {
      this.connected = false;
      this.onStateChangeCallback?.(false);
    });

    this.socket.on("sila:message", (data) => {
      if (!data || data.from === this.socket.id) return;
      this.onMessageCallback?.({ from: data.from, message: { ...data.message, transport: "net" } });
    });

    this.socket.on("sila:presence", (data) => {
      if (!data || data.from === this.socket.id) return;
      this.onPresenceCallback?.({ from: data.from, at: data.at || Date.now() });
    });

    this.socket.on("sila:leave", (data) => {
      if (!data) return;
      this.onLeaveCallback?.({ from: data.from, at: data.at || Date.now() });
    });

    return true;
  }

  /** إرسال مزدوج المسار يُستدعى من main.js بجانب MeshService.sendMessage. */
  send(message) {
    if (!this.connected) return false;
    this.socket.emit("sila:message", { room: this.room, message });
    return true;
  }

  announce() {
    if (!this.connected) return;
    this.socket.emit("sila:presence", { room: this.room });
  }

  peersCount() {
    if (!this.connected) return Promise.resolve(0);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(0), 1500);
      this.socket.once("sila:peers", (d) => {
        clearTimeout(t);
        resolve(d?.count || 0);
      });
      this.socket.emit("sila:peers", { room: this.room });
    });
  }

  onMessage(cb) { this.onMessageCallback = cb; }
  onPresence(cb) { this.onPresenceCallback = cb; }
  onLeave(cb) { this.onLeaveCallback = cb; }
  onStateChange(cb) { this.onStateChangeCallback = cb; }

  close() {
    if (this.socket) this.socket.disconnect();
    this.connected = false;
  }
}
