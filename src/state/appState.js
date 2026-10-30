/**
 * حالة التطبيق المركزية
 */

export const state = {
  transport: "mesh",
  activeRoom: "ساحة الحي",
  online: navigator.onLine,
  peers: new Map(),
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
  state.messages.push(message);
}

export function addPeer(peerId, timestamp) {
  state.peers.set(peerId, timestamp);
}

export function getPeerCount() {
  return Math.max(2, state.peers.size + 1);
}
