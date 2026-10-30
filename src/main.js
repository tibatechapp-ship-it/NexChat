import "./style.css";
import { state, addMessage, addPeer } from "./state/appState.js";
import { MeshService } from "./services/meshService.js";
import { generateNodeId, formatTime } from "./utils/helpers.js";
import { renderApp } from "./components/uiRenderer.js";
import { bindEvents, eventHandlers } from "./components/eventHandlers.js";

// تهيئة العقدة
const nodeId = generateNodeId();
const meshService = new MeshService(nodeId);

// معالجة الرسائل الواردة
meshService.onMessage((data) => {
  addPeer(data.from, Date.now());
  addMessage({ ...data.message, mine: false });
  renderApp();
});

// معالجة وجود العقد الأخرى
meshService.onPresence((data) => {
  addPeer(data.from, data.at);
  renderApp();
});

// معالج إرسال الرسائل المخصص
eventHandlers.onSendMessage = () => {
  const input = document.querySelector("#message-input");
  const text = input.value.trim();
  if (!text) return;

  const message = {
    author: "أنت",
    initials: "أ",
    time: formatTime(),
    text,
    mine: true,
    transport: state.transport,
  };

  addMessage(message);
  meshService.sendMessage(message);
  renderApp();

  input.value = "";
  input.focus();
};

// معالج تحديث العقد
eventHandlers.onRefreshPeers = () => {
  meshService.announcePresence();
  renderApp();
};

// الاستماع لتغيرات حالة الإنترنت
window.addEventListener("online", () => {
  state.online = true;
  renderApp();
});

window.addEventListener("offline", () => {
  state.online = false;
  renderApp();
});

// بدء التطبيق
meshService.announcePresence();
bindEvents(eventHandlers);
renderApp();
