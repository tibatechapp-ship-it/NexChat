import "./style.css";
import { state, addMessage, addPeer, setActiveRoom, setRoomCount } from "./state/appState.js";
import { MeshService } from "./services/meshService.js";
import { NetBridge } from "./services/netBridge.js";
import { RtcService } from "./services/rtcService.js";
import { SharedBoard } from "./services/crdt.js";
import { generateNodeId, formatTime, newMessageId } from "./utils/helpers.js";
import { paint } from "./components/uiRenderer.js";
import { bindEvents, eventHandlers } from "./components/eventHandlers.js";

// تهيئة العقدة
const nodeId = generateNodeId();
const meshService = new MeshService(nodeId);

// جسر الخادم: نقل حقيقي بين الأجهزة عبر /sila في Socket.IO — يفشل بهدوء
// إذا لم يُخدم من خادم رسن (Vite مثلاً) ويعتمد BroadcastChannel وحده.
const netBridge = new NetBridge(nodeId);

// ===== اللوحة المشتركة (CRDT — P2 #12 — نمط Offline Protocol) =====
// عدّاد + قائمة مشتركة تتقارب بين كل العقد عبر كل مسارات النقل نفسها
// التي تحمل الرسائل (BroadcastChannel + P2P + الخادم) — بلا خادم حقيقة.
const board = new SharedBoard(nodeId);

function syncBoardSnapshot() {
  state.board = {
    counter: board.counter.value(),
    items: board.list.toList(),
  };
}

// بث حزمة لوحة عبر المسارات الثلاثة معاً (نقل مزدوج/ثلاثي كما في الرسائل) —
// الاستقبال يزيل التكرار عبر معرف العملية في crdt.js.
function broadcastBoard(payload) {
  meshService.sendMessage(payload);
  rtcService.send(payload);
  netBridge.send(payload);
}

board.onOp((op) => broadcastBoard({ id: op.oid, kind: "board", op }));
board.onChange(() => {
  syncBoardSnapshot();
  paint();
});

// لقطة دورية للانضمام المتأخر: عند وصول عقدة جديدة نرسل حالتنا كاملة
// (بحد أقصى مرة كل 15 ثانية لكل عقدة) — الدمج انتصامي فلا خطر من التكرار.
let lastSnapshotAt = 0;
function maybeSendBoardSnapshot() {
  const now = Date.now();
  if (now - lastSnapshotAt < 15000) return;
  lastSnapshotAt = now;
  broadcastBoard({
    id: "snap" + now.toString(36) + Math.random().toString(36).slice(2, 6),
    kind: "board",
    op: board.snapshot(),
  });
}

// ===== مسار الاستقبال الموحد: رسائل المحادثة أو عمليات اللوحة =====
function handleIncoming(message, extra = {}) {
  if (message && message.kind === "board") {
    board.applyOp(message.op);
    return;
  }
  addPeer(extra.from ?? "peer", Date.now());
  addMessage({ ...message, mine: false, ...extra });
  paint();
}

netBridge.onMessage((data) => {
  handleIncoming({ ...data.message }, { from: data.from, transport: "net" });
});
netBridge.onPresence((data) => {
  addPeer(data.from, data.at);
  maybeSendBoardSnapshot();
  paint();
});
netBridge.onStateChange((connected) => {
  // عند توفر نقل الخادم نعرضه كوسيلة فعلية — الواجهة الهجينة Mesh/Net مكتملة
  state.online = connected || navigator.onLine;
  if (connected) refreshSilaCounts();
  paint();
});
netBridge.connect();

// ===== النقل المباشر جهاز-إلى-جهاز (WebRTC DataChannel — تقنية Meshenger) =====
// الإشارة عبر مساحة /sila، والبيانات تسير مباشرة بين الجهازين على الشبكة
// المحلية. يُنشأ بعد connect() لأنه يعتمد على مقبس الجسر، ويفشل بهدوء حيث
// RTCPeerConnection غير متاح — نقل BroadcastChannel + الخادم يبقى يعمل وحده.
const rtcService = new RtcService(netBridge);
rtcService.onMessage((data) => {
  handleIncoming({ ...data.message }, { from: data.from, transport: "p2p" });
});
rtcService.onChannelsChange((open) => {
  state.p2pChannels = open;
  if (open) maybeSendBoardSnapshot();
  paint();
});

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
  handleIncoming({ ...data.message }, { from: data.from });
});

// معالجة وجود العقد الأخرى
meshService.onPresence((data) => {
  addPeer(data.from, data.at);
  maybeSendBoardSnapshot();
  paint();
});

// معالج إرسال الرسائل المخصص
eventHandlers.onSendMessage = () => {
  const input = document.querySelector("#message-input");
  const text = input.value.trim();
  if (!text) return;

  const viaServer = netBridge.connected;
  const message = {
    id: newMessageId(), // مشترك بين المسارات الثلاثة — الاستقبال يزيل التكرار
    author: "أنت",
    initials: "أ",
    time: formatTime(),
    text,
    mine: true,
    transport: viaServer ? "net" : "mesh",
  };

  addMessage(message);
  // نقل مزدوج/ثلاثي (نمط BitChat): نفس المتصفح (BroadcastChannel) + القنوات
  // المباشرة (WebRTC P2P) + الأجهزة الأخرى (الخادم) — والاستقبال يزيل التكرار
  // عبر message.id. إذا سقط مسار وصلت الرسالة من المسار الآخر.
  meshService.sendMessage(message);
  rtcService.send(message);
  netBridge.send(message);
  paint();

  input.value = "";
  input.focus();
};

// ===== معالجات اللوحة المشتركة =====
eventHandlers.onBoardIncrement = () => {
  board.increment(1); // تطبيق محلي + بث عبر onOp تلقائياً
};

eventHandlers.onBoardAdd = () => {
  const input = document.querySelector("#board-input");
  const value = input.value.trim();
  if (!value) return;
  board.addItem(value);
  input.value = "";
  input.focus();
};

eventHandlers.onBoardRemove = (id) => {
  if (id) board.removeItem(id);
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
syncBoardSnapshot();
paint();
