/**
 * rtcService — نقل صلة مباشر جهاز-إلى-جهاز عبر WebRTC DataChannel (P1).
 *
 * تقنية Meshenger: الإشارة (SDP/ICE) تمر عبر مساحة /sila في الخادم، أما
 * البيانات نفسها (رسائل المحادثة) فتسير مباشرة بين الجهازين على الشبكة
 * المحلية — بلا خادم وسيط للبيانات. يُستخدم كترقية لنقل الخادم لا كبديل:
 * كل رسالة تُرسل بالمسارين مع id مشترك، والاستقبال يزيل التكرار (نمط
 * النقل المزدوج في BitChat) — فإذا سقط أحد المسارين وصلت الرسالة بالآخر.
 *
 * كسر تعارض العرض (glare): عند رصد حضور عقدة جديدة يبدأ العرض من صاحب
 * معرّف المقبس الأكبر حصراً (كسر تعارض حتمي) — الطرف الآخر يجيب فقط.
 *
 * بلا STUN/TURN: مرشحات مضيف فقط — اتصال صريح للشبكة المحلية. يفشل بهدوء
 * حيث RTCPeerConnection غير متاح (متصفحات قديمة/بيئات اختبار) ويبقى نقل
 * BroadcastChannel + الخادم يعمل وحده.
 */

export class RtcService {
  constructor(netBridge) {
    this.netBridge = netBridge;
    this.channels = new Map(); // peerId -> RTCDataChannel مفتوحة
    this.pcs = new Map();      // peerId -> RTCPeerConnection
    this.pendingIce = new Map(); // peerId -> مرشحات وصلت قبل جهوزية الوصف البعيد
    this.onMessageCallback = null;
    this.onChannelsChangeCallback = null;
    // يفشل بهدوء حيث لا يوجد RTCPeerConnection أو مقبس الخادم
    this.enabled =
      typeof RTCPeerConnection !== "undefined" && !!netBridge?.socket;
    if (this.enabled) this._wire();
  }

  _wire() {
    const s = this.netBridge.socket;
    s.on("sila:presence", (data) => {
      if (data?.from) this._maybeOffer(data.from);
    });
    s.on("sila:rtc:offer", (d) => { this._onOffer(d); });
    s.on("sila:rtc:answer", (d) => { this._onAnswer(d); });
    s.on("sila:rtc:ice", (d) => { this._onIce(d); });
  }

  /** عرض اتصال مباشر: فقط لمن يملك المعرّف الأكبر (كسر تعارض حتمي). */
  _maybeOffer(peerId) {
    if (!this.enabled) return;
    if (!peerId || peerId === this.netBridge.socket.id) return;
    if (this.channels.has(peerId) || this.pcs.has(peerId)) return;
    if (this.netBridge.socket.id <= peerId) return; // الطرف الآخر يبدأ
    this._connect(peerId, true);
  }

  _connect(peerId, initiator) {
    if (!this.enabled || this.pcs.has(peerId)) return;
    const pc = new RTCPeerConnection({ iceServers: [] }); // LAN-direct: مضيف فقط
    this.pcs.set(peerId, pc);
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        try {
          this.netBridge.socket.emit("sila:rtc:ice", { to: peerId, payload: JSON.stringify(e.candidate) });
        } catch {}
      }
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) this._drop(peerId);
    };
    if (initiator) {
      const ch = pc.createDataChannel("sila", { ordered: true });
      this._bindChannel(peerId, ch);
      pc.createOffer()
        .then(async (offer) => {
          await pc.setLocalDescription(offer);
          this.netBridge.socket.emit("sila:rtc:offer", { to: peerId, payload: JSON.stringify(pc.localDescription) });
        })
        .catch(() => this._drop(peerId));
    } else {
      pc.ondatachannel = (e) => this._bindChannel(peerId, e.channel);
    }
  }

  _bindChannel(peerId, ch) {
    ch.onopen = () => {
      this.channels.set(peerId, ch);
      this.onChannelsChangeCallback?.(this.channels.size);
    };
    ch.onclose = () => this._drop(peerId);
    ch.onmessage = (e) => {
      try {
        const message = JSON.parse(String(e.data));
        if (message && typeof message.text === "string") {
          this.onMessageCallback?.({ from: peerId, message: { ...message, transport: "p2p" } });
        }
      } catch {}
    };
  }

  async _onOffer({ from, payload } = {}) {
    if (!this.enabled || typeof payload !== "string") return;
    if (!from || from === this.netBridge.socket.id) return;
    let pc = this.pcs.get(from);
    if (!pc) { this._connect(from, false); pc = this.pcs.get(from); }
    if (!pc) return;
    try {
      await pc.setRemoteDescription(JSON.parse(payload));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.netBridge.socket.emit("sila:rtc:answer", { to: from, payload: JSON.stringify(pc.localDescription) });
      await this._flushIce(from);
    } catch { this._drop(from); }
  }

  async _onAnswer({ from, payload } = {}) {
    const pc = this.pcs.get(from);
    if (!pc || typeof payload !== "string") return;
    try {
      await pc.setRemoteDescription(JSON.parse(payload));
      await this._flushIce(from);
    } catch { this._drop(from); }
  }

  async _onIce({ from, payload } = {}) {
    const pc = this.pcs.get(from);
    if (!pc || typeof payload !== "string") return;
    if (!pc.remoteDescription) {
      if (!this.pendingIce.has(from)) this.pendingIce.set(from, []);
      this.pendingIce.get(from).push(payload);
      return;
    }
    try { await pc.addIceCandidate(JSON.parse(payload)); } catch {}
  }

  async _flushIce(peerId) {
    const pc = this.pcs.get(peerId);
    const list = this.pendingIce.get(peerId) || [];
    this.pendingIce.delete(peerId);
    for (const c of list) { try { await pc?.addIceCandidate(JSON.parse(c)); } catch {} }
  }

  _drop(peerId) {
    this.channels.delete(peerId);
    const pc = this.pcs.get(peerId);
    if (pc) { try { pc.close(); } catch {} }
    this.pcs.delete(peerId);
    this.pendingIce.delete(peerId);
    this.onChannelsChangeCallback?.(this.channels.size);
  }

  /**
   * إرسال عبر القنوات المفتوحة — يعيد true إذا وصلت لقناة واحدة على الأقل.
   * الرسالة نفسها تُرسل أيضاً عبر netBridge من main.js (نقل مزدوج + de-dup).
   */
  send(message) {
    if (!this.channels.size) return false;
    let data;
    try { data = JSON.stringify(message); } catch { return false; }
    let sent = false;
    for (const ch of this.channels.values()) {
      if (ch.readyState === "open") {
        try { ch.send(data); sent = true; } catch {}
      }
    }
    return sent;
  }

  /** عدد القنوات المباشرة المفتوحة الآن (لشارة P2P في الواجهة). */
  openChannels() { return this.channels.size; }

  onMessage(cb) { this.onMessageCallback = cb; }
  onChannelsChange(cb) { this.onChannelsChangeCallback = cb; }
}
