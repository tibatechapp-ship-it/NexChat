import { state } from "../state/appState.js";
import { renderApp } from "./uiRenderer.js";

/**
 * ربط أحداث الواجهة بالمعالجة
 */
export function bindEvents(handlers) {
  // تبديل وسيلة النقل
  document.querySelectorAll("[data-transport]").forEach((button) =>
    button.addEventListener("click", () => {
      handlers.onTransportChange(button.dataset.transport);
    }),
  );

  // تبديل الغرفة
  document.querySelectorAll("[data-room]").forEach((button) =>
    button.addEventListener("click", () => {
      handlers.onRoomChange(button.dataset.room);
    }),
  );

  // إرسال الرسائل
  document.querySelector("#composer")?.addEventListener("submit", (event) => {
    event.preventDefault();
    handlers.onSendMessage();
  });

  // تحديث العقد
  document.querySelector("#refresh-peers")?.addEventListener("click", () => {
    handlers.onRefreshPeers();
  });

  // مشاركة الغرفة
  document.querySelector("#share-room")?.addEventListener("click", () => {
    handlers.onShareRoom();
  });

  // إنشاء غرفة جديدة
  document.querySelector("#new-room")?.addEventListener("click", () => {
    handlers.onCreateRoom();
  });
}

/**
 * معالجات الأحداث
 */
export const eventHandlers = {
  onTransportChange: (transport) => {
    state.transport = transport;
    renderApp();
  },

  onRoomChange: (roomName) => {
    state.activeRoom = roomName;
    renderApp();
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
