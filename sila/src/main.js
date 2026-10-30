import "./style.css";
import { state, addMessage, addPeer } from "./state/appState.js";
import { MeshService } from "./services/meshService.js";
import { NetBridge } from "./services/netBridge.js";
import { generateNodeId, formatTime } from "./utils/helpers.js";
import { renderApp } from "./components/uiRenderer.js";
import { bindEvents, eventHandlers } from "./components/eventHandlers.js";

// تهيئة العقدة
const nodeId = generateNodeId();
const meshService = new MeshService(nodeId);

// جسر الخادم: نقل حقيقي بين الأجهزة عبر /sila في Socket.IO — يفشل بهدوء
// إذا لم يُخدم من خادم رسن (Vite مثلاً) ويعتمد BroadcastChannel وحده.
const netBridge = new NetBridge(nodeId);
netBridge.onMessage((data) => {
  addPeer(data.from, Date.now());
  addMessage({ ...data.message, mine: false, transport: "net" });
  renderApp();
});
netBridge.onPresence((data) => {
  addPeer(data.from, data.at);
  renderApp();
});
netBridge.onStateChange((connected) => {
  // عند توفر نقل الخادم نعرضه كوسيلة فعلية — الواجهة الهجينة Mesh/Net مكتملة
  state.online = connected || navigator.onLine;
  renderApp();
});
netBridge.connect();

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

  const viaServer = netBridge.connected;
  const message = {
    author: "أنت",
    initials: "أ",
    time: formatTime(),
    text,
    mine: true,
    transport: viaServer ? "net" : "mesh",
  };

  addMessage(message);
  // إرسال مزدوج المسار: نفس المتصفح (BroadcastChannel) + الأجهزة الأخرى (الخادم)
  meshService.sendMessage(message);
  netBridge.send(message);
  renderApp();

  input.value = "";
  input.focus();
};

// معالج تحديث العقد
eventHandlers.onRefreshPeers = () => {
  meshService.announcePresence();
  netBridge.announce();
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
