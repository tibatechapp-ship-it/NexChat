/**
 * حالة التطبيق المركزية
 */

export const state = {
  transport: "mesh",
  activeRoom: "ساحة الحي",
  online: navigator.onLine,
  peers: new Map(),
  p2pChannels: 0, // قنوات WebRTC المباشرة المفتوحة (شارة P2P)
  // لقطة اللوحة المشتركة (CRDT — P2 #12): تُحدّث من main.js بعد كل تغيير
  // كي يرسمها uiRenderer دون اعتماد دائري بين العرض وخدمة CRDT.
  board: { counter: 0, items: [] },
  messages: [
    {
      author: "ليان",
      initials: "ل",
      time: "09:42",
      text: "صباح الخير. هل ما زال اللقاء عند المكتبة اليوم؟",
      mine: false,
      transport: "mesh",
    },
    {
      author: "أنت",
      initials: "أ",
      time: "09:44",
      text: "نعم، سأكون هناك بعد قليل.",
      mine: true,
      transport: "mesh",
    },
    {
      author: "سامر",
      initials: "س",
      time: "09:48",
      text: "أرسلت الموقع في المجموعة. الإشارة المحلية مستقرة.",
      mine: false,
      transport: "internet",
    },
  ],
};

export const rooms = [
  { name: "ساحة الحي", count: 12, color: "lime" },
  { name: "فريق الرحلة", count: 8, color: "orange" },
  { name: "ملاحظات عامة", count: 21, color: "blue" },
];

// دوال مساعدة لتحديث الحالة
export function setTransport(transport) {
  state.transport = transport;
}

export function setActiveRoom(roomName) {
  state.activeRoom = roomName;
}

export function addMessage(message) {
  // إزالة التكرار عبر id مشترك بين مسارات النقل (Mesh/P2P/الخادم):
  // النقل المزدوج يعني أن الرسالة قد تصل من أكثر من مسار — تُعرض مرة واحدة
  if (message?.id && state.messages.some((m) => m.id === message.id)) return false;
  state.messages.push(message);
  return true;
}

export function addPeer(peerId, timestamp) {
  state.peers.set(peerId, timestamp);
}

export function getPeerCount() {
  // عدد العقد الأخرى المعروفة فعلياً (بدون احتساب هذا الجهاز) — لا أرقام وهمية.
  return state.peers.size;
}

/** تحديث عدّاد ساحة من مصدر حقيقي (الخادم عبر sila:peers). */
export function setRoomCount(roomName, count) {
  const room = rooms.find((r) => r.name === roomName);
  if (room && Number.isInteger(count) && count > 0) room.count = count;
}
