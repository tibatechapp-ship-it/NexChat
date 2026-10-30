/**
 * sila-mesh — جسر «صلة» المحلي على خادم رسن.
 *
 * صلة (أصلها wifi-chat) واجهة تواصل هجينة: Mesh محلي + إنترنت. طبقة الـ Mesh
 * الأصلية فيها كانت BroadcastChannel فقط (بين تبويبات نفس المتصفح). هذه
 * الوحدة تكمل "المرحلة التالية" المذكورة في README صلة: نقل حقيقي بين
 * أجهزة مختلفة عبر Socket.IO على نفس الأصل — فعند تشغيل الخادم على شبكة
 * محلية يعمل التواصل بلا إنترنت خارجي، وعبر الإنترنت عند توفره.
 *
 * ضمانات العزل الصارم عن نواة رسن:
 * - لا وصول لقاعدة البيانات إطلاقاً: لا يتطلب ./db ولا ./auth — مساحة
 *   تجريبية (prototype) منفصلة تماماً، لا حسابات ولا جلسات ولا سجل.
 * - لا تخزين: كل شيء في الذاكرة ويموت بالإتصال.
 * - التشفير: رسائل صلة هنا غير مشفرة طرف-لطرف (خلافاً لنواة رسن E2EE) —
 *   لذلك يُعلَن ذلك صراحة في الواجهة والتوثيق، والمساحة مخصصة للتجربة.
 * - حدود صارمة: نص ≤ 4000 بايت، 10 رسائل/10 ثوان لكل مقبس، غرف ≤ 8 لكل
 *   مقبس واسم ≤ 32 حرفاً بدون محارف تحكم.
 */

const MAX_TEXT_BYTES = 4000;
const MAX_AUTHOR_CHARS = 32;
const MAX_ROOMS_PER_SOCKET = 8;
const MAX_ROOM_NAME = 32;
const RATE_WINDOW_MS = 10000;
const RATE_MAX = 10;
// سقوف إشارات WebRTC (تقنية Meshenger — P1): SDP/ICE تمر موجّهة فقط،
// والبيانات نفسها تسير مباشرة بين الجهازين بلا خادم وسيط.
const MAX_SDP_BYTES = 20000;
const MAX_ICE_BYTES = 2048;

function validRoomName(name) {
  if (typeof name !== "string") return false;
  if (!name.length || name.length > MAX_ROOM_NAME) return false;
  for (const ch of name) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code === 127) return false; // لا محارف تحكم
  }
  return true;
}

function sanitizeMessage(input) {
  if (!input || typeof input !== "object") return null;
  const { author, initials, time, text, transport } = input;
  if (typeof text !== "string" || !text.trim()) return null;
  if (Buffer.byteLength(text, "utf8") > MAX_TEXT_BYTES) return null;
  if (typeof author !== "string" || author.length > MAX_AUTHOR_CHARS) return null;
  return {
    author: author.slice(0, MAX_AUTHOR_CHARS),
    initials: typeof initials === "string" ? initials.slice(0, 2) : "؟",
    time: typeof time === "string" ? time.slice(0, 10) : "",
    text,
    transport: transport === "net" ? "net" : "mesh",
  };
}

/**
 * يعلّق مساحة /sila على خادم Socket.IO القائم — بلا أي تعديل في سلوكه الحالي.
 * @param {import("socket.io").Server} io
 */
function init(io) {
  const nsp = io.of("/sila");

  nsp.on("connection", (socket) => {
    socket._silaWindow = Date.now();
    socket._silaCount = 0;
    socket._silaRooms = new Set(["square"]);
    socket.join("square");

    socket.emit("sila:hello", { room: "square", at: Date.now() });
    nsp.to("square").emit("sila:presence", { from: socket.id, at: Date.now() });

    const rateLimited = () => {
      const now = Date.now();
      if (now - socket._silaWindow > RATE_WINDOW_MS) {
        socket._silaWindow = now;
        socket._silaCount = 0;
      }
      socket._silaCount++;
      return socket._silaCount > RATE_MAX;
    };

    // الانضمام لغرف إضافية (ساحات صلة) — انضمام فقط، لا انشاء دائم.
    socket.on("sila:join", ({ room } = {}) => {
      if (!validRoomName(room)) return;
      if (socket._silaRooms.size >= MAX_ROOMS_PER_SOCKET) return;
      socket._silaRooms.add(room);
      socket.join(room);
      socket.emit("sila:joined", { room });
    });

    // تمرير الرسالة لكل من في نفس الغرف — بدون حفظ ولا فحص هوية (مساحة صلة).
    socket.on("sila:message", ({ message, room } = {}) => {
      if (rateLimited()) {
        socket.emit("sila:rejected", { reason: "rate_limit" });
        return;
      }
      const clean = sanitizeMessage(message);
      if (!clean) {
        socket.emit("sila:rejected", { reason: "invalid_message" });
        return;
      }
      const target = validRoomName(room) && socket._silaRooms.has(room) ? room : "square";
      nsp.to(target).emit("sila:message", { from: socket.id, message: clean, at: Date.now() });
    });

    // إعلان الحضور عبر الخادم (يقابل announcePresence في BroadcastChannel).
    socket.on("sila:presence", () => {
      if (rateLimited()) return;
      for (const room of socket._silaRooms) {
        nsp.to(room).emit("sila:presence", { from: socket.id, at: Date.now() });
      }
    });

    // عدّاد العقد القريبة عبر الخادم.
    socket.on("sila:peers", ({ room } = {}) => {
      const target = validRoomName(room) && socket._silaRooms.has(room) ? room : "square";
      socket.emit("sila:peers", { room: target, count: nsp.adapter.rooms.get(target)?.size || 0 });
    });

    // --- إشارات WebRTC (LAN-direct — بلا تخزين ولا طوابير) ---
    // توجيه صارم: للجهاز الهدف فقط، ويجب أن يكون متصلاً الآن على المساحة،
    // ولا يجوز التوجيه للنفس. أي فشل يُسكت — العميل يعود للنقل عبر الخادم.
    const relayRtc = (event, { to, payload } = {}, maxBytes) => {
      if (rateLimited()) {
        socket.emit("sila:rejected", { reason: "rate_limit" });
        return;
      }
      if (typeof to !== "string" || !to.length || to === socket.id) return;
      if (typeof payload !== "string" || !payload.length || Buffer.byteLength(payload, "utf8") > maxBytes) return;
      const target = nsp.sockets.get(to);
      if (!target) return; // لا طوابير ولا احتفاظ — الجهاز غير موجود الآن
      target.emit(event, { from: socket.id, payload });
    };

    socket.on("sila:rtc:offer", (d) => relayRtc("sila:rtc:offer", d, MAX_SDP_BYTES));
    socket.on("sila:rtc:answer", (d) => relayRtc("sila:rtc:answer", d, MAX_SDP_BYTES));
    socket.on("sila:rtc:ice", (d) => relayRtc("sila:rtc:ice", d, MAX_ICE_BYTES));

    socket.on("disconnect", () => {
      for (const room of socket._silaRooms) {
        nsp.to(room).emit("sila:leave", { from: socket.id, at: Date.now() });
      }
    });
  });

  return nsp;
}

module.exports = { init, validRoomName, sanitizeMessage, MAX_TEXT_BYTES, RATE_MAX, MAX_SDP_BYTES, MAX_ICE_BYTES };
