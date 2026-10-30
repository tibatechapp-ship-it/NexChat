// groupcalls.js — المكالمات الجماعية الصوتية (WebRTC mesh — يكمل بحث الميزات P1:
// "مكالمات المجموعات متعددة الأطراف" الذي تأجّل إلى P2 ثم نُفِّذ هنا).
//
// النموذج: **mesh مكوَّن من اتصالات ثنائية** — كل مشارك يربط RTCPeerConnection
// مع كل مشارك آخر (مناسب حتى 8 مشاركين). الوسائط تسير طرف-لطرف مباشرة مشفّرة
// DTLS-SRTP كالمكالمات الثنائية — الخادم موجّه إشارات فقط (SDP/ICE)، بلا تخزين
// ولا DB: كل حالة المكالمة في الذاكرة وتموت بانتهائها.
//
// قاعدة بلا-تضارب (glare-free): **المنضمّ الأحدث هو من يرسل العروض** لكل
// المشاركين القائمين — لا يرسل اثنان عرضًا لبعضهما أبدًا فلا حاجة لـperfect
// negotiation. منضمّ لاحق؟ حالة القائمة تصله ثم يعرض على الجميع.
//
// التكامل مع المكالمات الثنائية (server.js): أثناء المكالمة الجماعية نضع
// callBusy.set(uid, { peer: null, group: true }) فيجد كل فحوص الانشغال
// القائمة (call:offer...) المستخدم مشغولًا تلقائيًا — بلا تعديل في مسارها.
// الإدخال إلى القناة/القراءة لا يتأثر: الأحداث كلها بأسماء groupcall:*/gcall:*.
//
// العزل عن صلة (sila): هذه المساحة في نطاق "/" الأساسي المصادق عليه — لا علاقة
// لها بمساحة "/sila" غير المصادقة (راجع server/sila-mesh.js).

const { db } = require("./db");

const GROUP_CALL_MAX = 8;        // سقف المشاركين — mesh واقعي حتى هذا العدد
const GC_SDP_BYTES = 32768;      // نفس سقف المكالمات الثنائية (server.js)
const GC_ICE_BYTES = 2048;
const GC_RATE_WINDOW_MS = 10000; // محدد معدل مستقل — ICE كثير ومتكرر بطبيعته
const GC_RATE_MAX = 240;

// حالة المكالمات الجماعية — في الذاكرة فقط (تموت بإعادة التشغيل عمدًا)
const rooms = new Map();   // conversationId -> { startedBy, startedAt, participants: Map<userId, {name, at}> }
const myCall = new Map();  // userId -> conversationId (المكالمة الجماعية الوحيدة للمستخدم)

// ===== دوال حالة نقية (تُختبر تشغيليًا في tests/groupcalls.test.js) =====

function getRoom(convId) { return rooms.get(convId) || null; }

/** انضمام مشارك — يفشل بلطف إن امتلأت الغرفة أو كان منضمًّا أصلًا. */
function addParticipant(convId, userId, name, now = Date.now()) {
  let room = rooms.get(convId);
  if (!room) { room = { startedBy: userId, startedAt: now, participants: new Map() }; rooms.set(convId, room); }
  if (room.participants.has(userId)) return { ok: false, reason: "already_in" };
  if (room.participants.size >= GROUP_CALL_MAX) return { ok: false, reason: "full" };
  room.participants.set(userId, { name, at: now });
  return { ok: true, room };
}

/** خروج مشارك — يُرجع عدد المتبقين ويحذف الغرفة إن فارغت. */
function removeParticipant(convId, userId) {
  const room = rooms.get(convId);
  if (!room || !room.participants.has(userId)) return { ok: false, remaining: room ? room.participants.size : 0 };
  room.participants.delete(userId);
  if (room.participants.size === 0) { rooms.delete(convId); return { ok: true, remaining: 0, emptied: true }; }
  return { ok: true, remaining: room.participants.size };
}

/** لقطة مشاركين للبث (بلا تفاصيل داخلية). */
function participantsSnapshot(room) {
  return [...room.participants.entries()].map(([userId, p]) => ({ userId, name: p.name }));
}

/** هل الطرفان في نفس الغرفة؟ (شرط تمرير كل إشارة gcall:*) */
function bothInCall(convId, aId, bId) {
  const room = rooms.get(convId);
  return !!room && room.participants.has(aId) && room.participants.has(bId);
}

function cleanupUser(io, uid) {
  const convId = myCall.get(uid);
  if (convId === undefined) return;
  myCall.delete(uid);
  const busy = callBusyRef.get(uid);
  if (busy && busy.group) callBusyRef.delete(uid); // لا نلمس اقترانات المكالمات الثنائية
  const { emptied } = removeParticipant(convId, uid);
  if (!emptied) {
    const room = rooms.get(convId);
    if (room) io.to("conv:" + convId).emit("groupcall:state", { conversationId: convId, participants: participantsSnapshot(room), startedBy: room.startedBy, startedAt: room.startedAt });
  } else {
    io.to("conv:" + convId).emit("groupcall:state", { conversationId: convId, participants: [], startedBy: null, startedAt: null });
  }
}

// callBusy يمرَّر من server.js بالمرجع — الوحدة لا تملكه (يملكه مسار المكالمات الثنائية)
let callBusyRef = new Map();

/**
 * init(io, { callBusy }) — يسجّل معالج connection ثانياً على النطاق الأساسي.
 * socket.io يدعم عدة مستمعين لـ connection فلا تعارض مع معالج server.js.
 */
function init(io, { callBusy } = {}) {
  if (callBusy) callBusyRef = callBusy;

  io.on("connection", (socket) => {
    const uid = socket.user.id;
    let gWindow = Date.now(), gCount = 0;
    const rateOk = () => {
      const now = Date.now();
      if (now - gWindow > GC_RATE_WINDOW_MS) { gWindow = now; gCount = 0; }
      gCount++;
      return gCount <= GC_RATE_MAX;
    };

    const isMemberOf = (convId, userId) =>
      !!db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(convId, userId);

    const userSockets = (userId) => {
      const out = [];
      for (const sock of io.sockets.sockets.values()) if (sock.user?.id === userId) out.push(sock);
      return out;
    };

    // ===== بدء/انضمام مكالمة جماعية (نفس الحدث: إن لم توجد غرفة تُنشأ) =====
    socket.on("groupcall:start", ({ conversationId } = {}) => {
      if (!rateOk()) return;
      const convId = Number(conversationId);
      if (!Number.isInteger(convId)) return;
      if (!isMemberOf(convId, uid)) { socket.emit("groupcall:error", { reason: "forbidden" }); return; }
      // المكالمات الجماعية للمجموعات والقنوات — الثنائية لها مسارها الخاص
      const conv = db.prepare("SELECT type FROM conversations WHERE id = ?").get(convId);
      if (!conv || conv.type === "dm") { socket.emit("groupcall:error", { reason: "forbidden" }); return; }
      if (myCall.has(uid)) return;                      // في مكالمة جماعية أصلًا
      if (callBusyRef.has(uid)) { socket.emit("call:busy", {}); return; } // في مكالمة ثنائية

      const res = addParticipant(convId, uid, socket.user.username);
      if (!res.ok) { socket.emit("groupcall:full", { conversationId: convId }); return; }
      myCall.set(uid, convId);
      // انشغال أمام مسار المكالمات الثنائية — فحوصه القائمة تكفي، بلا تعديل فيها
      callBusyRef.set(uid, { peer: null, conversationId: convId, group: true });

      // للمنضمّ: قائمة المشاركين القائمين (بدونه) — هو من سيرسل العروض لهم
      const existing = participantsSnapshot(res.room).filter((p) => p.userId !== uid);
      socket.emit("groupcall:joined", { conversationId: convId, peers: existing, startedBy: res.room.startedBy, startedAt: res.room.startedAt });
      // للغرفة كلها: الحالة الجديدة (رنين/تحديث قائمة عند الجميع)
      io.to("conv:" + convId).emit("groupcall:state", { conversationId: convId, participants: participantsSnapshot(res.room), startedBy: res.room.startedBy, startedAt: res.room.startedAt });
    });

    socket.on("groupcall:leave", ({ conversationId } = {}) => {
      const convId = Number(conversationId);
      if (!Number.isInteger(convId) || myCall.get(uid) !== convId) return;
      cleanupUser(io, uid);
    });

    // ===== إشارة SDP — لا تمر إلا بين مشاركين في نفس الغرفة الجماعية =====
    socket.on("gcall:offer", ({ conversationId, toUserId, sdp } = {}) => {
      if (!rateOk()) return;
      const convId = Number(conversationId), to = Number(toUserId);
      if (!Number.isInteger(convId) || !Number.isInteger(to)) return;
      if (typeof sdp !== "string" || !sdp.length || Buffer.byteLength(sdp, "utf8") > GC_SDP_BYTES) return;
      if (!bothInCall(convId, uid, to)) return;
      for (const target of userSockets(to)) target.emit("gcall:offer", { from: uid, fromName: socket.user.username, conversationId: convId, sdp });
    });

    socket.on("gcall:answer", ({ conversationId, toUserId, sdp } = {}) => {
      if (!rateOk()) return;
      const convId = Number(conversationId), to = Number(toUserId);
      if (!Number.isInteger(convId) || !Number.isInteger(to)) return;
      if (typeof sdp !== "string" || !sdp.length || Buffer.byteLength(sdp, "utf8") > GC_SDP_BYTES) return;
      if (!bothInCall(convId, uid, to)) return;
      for (const target of userSockets(to)) target.emit("gcall:answer", { from: uid, sdp });
    });

    socket.on("gcall:ice", ({ conversationId, toUserId, candidate } = {}) => {
      if (!rateOk()) return;
      const convId = Number(conversationId), to = Number(toUserId);
      if (!Number.isInteger(convId) || !Number.isInteger(to)) return;
      if (typeof candidate !== "string" || !candidate.length || Buffer.byteLength(candidate, "utf8") > GC_ICE_BYTES) return;
      if (!bothInCall(convId, uid, to)) return;
      for (const target of userSockets(to)) target.emit("gcall:ice", { from: uid, candidate });
    });

    // ===== الانقطاع: خروج فوري من المكالمة الجماعية (مسار الوسائط مات معه) =====
    socket.on("disconnect", () => cleanupUser(io, uid));
  });
}

/** خطاف اختبارات — يفضح الحالة النقية بلا io. */
function _internal() { return { rooms, myCall, addParticipant, removeParticipant, bothInCall, participantsSnapshot, getRoom }; }

module.exports = { init, _internal, GROUP_CALL_MAX, GC_SDP_BYTES, GC_ICE_BYTES };
