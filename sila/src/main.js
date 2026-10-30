import "./style.css";
import { state, addMessage, addPeer, setActiveRoom, setRoomCount } from "./state/appState.js";
import { MeshService } from "./services/meshService.js";
import { NetBridge } from "./services/netBridge.js";
import { generateNodeId, formatTime } from "./utils/helpers.js";
import { paint } from "./components/uiRenderer.js";
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
  paint();
});
netBridge.onPresence((data) => {
  addPeer(data.from, data.at);
  paint();
});
netBridge.onStateChange((connected) => {
  // عند توفر نقل الخادم نعرضه كوسيلة فعلية — الواجهة الهجينة Mesh/Net مكتملة
  state.online = connected || navigator.onLine;
  if (connected) refreshSilaCounts();
  paint();
});
netBridge.connect();

// ===== ساحات صلة الحية =====
// الغرف الحقيقية عبر الخادم: تبديل الساحة ينضم عبر sila:join، والعدّادات
// تأتي من sila:peers بدل الأرقام الثابتة. بلا اتصال يبقى عدّاد BroadcastChannel.
function refreshSilaCounts() {
  netBridge.peersCount(state.activeRoom).then((count) => {
    if (count > 0) { setRoomCount(state.activeRoom, count); paint(); }
  });
}

// معالج تبديل الساحة — انضمام حقيقي عبر الخادم + تحديث العدّاد
eventHandlers.onRoomChange = (roomName) => {
  setActiveRoom(roomName);
  netBridge.join(roomName); // لا شيء بلا اتصال — BroadcastChannel ساحة واحدة محلياً
  refreshSilaCounts();
  paint();
};

// نبض حضور دوري: يبقى عدّاد العقد والساحات حياً دون تدخل المستخدم
setInterval(() => {
  meshService.announcePresence();
  if (netBridge.connected) { netBridge.announce(); refreshSilaCounts(); }
}, 30000);

// معالجة الرسائل الواردة
meshService.onMessage((data) => {
  addPeer(data.from, Date.now());
  addMessage({ ...data.message, mine: false });
  paint();
});

// معالجة وجود العقد الأخرى
meshService.onPresence((data) => {
  addPeer(data.from, data.at);
  paint();
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
  paint();

  input.value = "";
  input.focus();
};

// معالج تحديث العقد
eventHandlers.onRefreshPeers = () => {
  meshService.announcePresence();
  netBridge.announce();
  paint();
};

// الاستماع لتغيرات حالة الإنترنت
window.addEventListener("online", () => {
  state.online = true;
  paint();
});

window.addEventListener("offline", () => {
  state.online = false;
  paint();
});

// بدء التطبيق
meshService.announcePresence();
bindEvents(eventHandlers);
paint();
