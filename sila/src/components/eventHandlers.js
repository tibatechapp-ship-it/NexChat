import { state } from "../state/appState.js";
import { paint } from "./uiRenderer.js";

/**
 * ربط أحداث الواجهة بالمعالجة.
 * يستخدم التفويض (event delegation) على #app حتى تعمل الأحداث
 * بعد إعادة الرسم دون إعادة الربط في كل مرة.
 */
export function bindEvents(handlers) {
  const root = document.querySelector("#app");

  root.addEventListener("click", (event) => {
    const transport = event.target.closest("[data-transport]");
    if (transport) {
      handlers.onTransportChange(transport.dataset.transport);
      return;
    }
    const room = event.target.closest("[data-room]");
    if (room) {
      handlers.onRoomChange(room.dataset.room);
      return;
    }
    if (event.target.closest("#refresh-peers")) {
      handlers.onRefreshPeers();
      return;
    }
    if (event.target.closest("#share-room")) {
      handlers.onShareRoom();
      return;
    }
    if (event.target.closest("#new-room")) {
      handlers.onCreateRoom();
    }
  });

  root.addEventListener("submit", (event) => {
    if (!event.target.closest("#composer")) return;
    event.preventDefault();
    handlers.onSendMessage();
  });
}

/**
 * معالجات الأحداث
 */
export const eventHandlers = {
  onTransportChange: (transport) => {
    state.transport = transport;
    paint();
  },

  onRoomChange: (roomName) => {
    state.activeRoom = roomName;
    paint();
  },

  onSendMessage: () => {
    // يتم التعامل معها في main.js
  },

  onRefreshPeers: () => {
    // يتم التعامل معها في main.js
  },

  onShareRoom: () => {
    navigator.clipboard
      ?.writeText(`صلة / ${state.activeRoom}`)
      .then(() => alert("تم نسخ اسم المساحة"));
  },

  onCreateRoom: () => {
    alert("إنشاء المساحات سيضاف في الإصدار التالي.");
  },
};
