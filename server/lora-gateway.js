/**
 * lora-gateway — بوابة LoRa اختيارية (P2 #10 — نمط Meshtastic).
 *
 * جسر بين مساحة صلة (/sila على Socket.IO) وشبكة Meshtastic عبر MQTT:
 * عقد LoRa خارجية (شرائح رخيصة بنطاق كيلومترات — مثالي للمناطق كلياً بلا
 * تغطية) تنشر رسائلها على وسيط MQTT، وهذه البوابة تمرّرها كعقد صلة
 * والعكس. الخادم هنا موجّه فقط — بلا تخزين ولا DB ولا مصادقة (عزل كامل
 * عن نواة رسن، مثل sila-mesh نفسها).
 *
 * تعطيل آمن افتراضياً: البوابة معطلة تماماً ما لم تُضبط LORA_MQTT_URL.
 * الأمان المراقَب (درس تدقيق Bridgefy — §6 في FEATURE_RESEARCH.md): رسائل
 * LoRa غير مشفرة طرف-لطرف، لذلك تظهر في صلة بعلامة واضحة "LoRa" وتُعزل
 * في ساحة مستقلة لا تختلط مع ساحات المستخدمين.
 *
 * حدود صارمة: نص ≤ 200 بايت (سقف حمولة Meshtastic الفعلي ~237)، 10
 * رسائل/دقيقة لكل مرسل خارجي، وسم مرسل مقصوص، وأخطاء الوسيط تُسكت —
 * انقطاع MQTT لا يؤثر أبداً على عمل صلة المحلي.
 */

const MAX_LORA_PAYLOAD_BYTES = 200;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX_PER_SENDER = 10;
const MAX_SENDER_CHARS = 16;

const DEFAULT_TOPIC = "msh/2/json/LongFast";
const DEFAULT_ROOM = "lora";
const GATEWAY_SENDER = "!rasan";

function validSender(sender) {
  return typeof sender === "string" && sender.length > 0 && sender.length <= MAX_SENDER_CHARS && !/[\x00-\x1f\x7f]/.test(sender);
}

/**
 * البوابة القابلة للحقن (للاختبارات): كل الاعتماديات خارجية تُمرَّر.
 * @param {object} opts
 * @param {object} opts.nsp        مساحة /sila (من sila-mesh init)
 * @param {object} opts.mqttClient عميل MQTT بحجم {subscribe, publish, onMessage}
 * @param {object} [opts.tap]      وحدة تسجيل علامة الرسائل الصادرة من صلة
 * @param {string} [opts.topic]    موضوع MQTT (افتراضي msh/2/json/LongFast)
 * @param {string} [opts.room]     ساحة صلة المقابلة (افتراضي lora)
 */
function createLoraGateway({ nsp, mqttClient, setTap, topic = DEFAULT_TOPIC, room = DEFAULT_ROOM } = {}) {
  if (!nsp) throw new Error("lora gateway requires the /sila namespace");
  if (!mqttClient || typeof mqttClient.subscribe !== "function" || typeof mqttClient.publish !== "function") {
    throw new Error("lora gateway requires an mqtt client with subscribe/publish");
  }

  const seenRates = new Map(); // sender -> {window, count}
  let closed = false;

  function rateLimited(sender) {
    const now = Date.now();
    let r = seenRates.get(sender);
    if (!r || now - r.window > RATE_WINDOW_MS) { r = { window: now, count: 0 }; seenRates.set(sender, r); }
    r.count++;
    return r.count > RATE_MAX_PER_SENDER;
  }

  // ===== الوارد: LoRa → صلة =====
  mqttClient.onMessage?.((topicIn, payloadStr) => {
    if (closed) return;
    if (typeof topicIn !== "string" || !topicIn.startsWith("msh/")) return;
    let parsed;
    try { parsed = JSON.parse(payloadStr); } catch { return; }
    // فقط رسائل نصية من نمط Meshtastic JSON — كل الأنواع الأخرى (position,
    // user, nodeinfo...) تُسقط: البوابة نصية فقط.
    if (!parsed || parsed.type !== "sendtext") return;
    if (typeof parsed.payload !== "string" || !parsed.payload.trim()) return;
    if (Buffer.byteLength(parsed.payload, "utf8") > MAX_LORA_PAYLOAD_BYTES) return;
    if (!validSender(parsed.sender)) return;
    if (rateLimited(parsed.sender)) return;

    const time = new Date().toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" });
    nsp.to(room).emit("sila:message", {
      from: "lora:" + parsed.sender,
      message: {
        author: "LoRa " + parsed.sender,
        initials: "L",
        time,
        text: parsed.payload,
        transport: "mesh",
        lora: true,
      },
      at: Date.now(),
    });
  });
  try { mqttClient.subscribe(topic); } catch {}

  // ===== الصادر: صلة → LoRa =====
  // تُسجَّل علامة على مساحة صلة: كل رسالة نصية في ساحة البوابة تُنشر على MQTT.
  if (typeof setTap === "function") {
    setTap((targetRoom, clean) => {
      if (closed || targetRoom !== room) return;
      if (!clean || typeof clean.text !== "string" || !clean.text.trim()) return;
      if (Buffer.byteLength(clean.text, "utf8") > MAX_LORA_PAYLOAD_BYTES) return;
      try {
        mqttClient.publish(topic, JSON.stringify({ sender: GATEWAY_SENDER, type: "sendtext", payload: clean.text }));
      } catch {}
    });
  }

  return {
    room,
    topic,
    close() {
      closed = true;
      seenRates.clear();
      if (typeof setTap === "function") setTap(null);
      try { mqttClient.end?.(true); } catch {}
    },
  };
}

/**
 * تهيئة الإنتاج: معطلة بلا LORA_MQTT_URL. يستدعى من server.js بعد silaMesh.init.
 * @param {import("socket.io").Server} io
 * @param {object} silaMesh وحدة sila-mesh (للمساحة وعلامة الصادر)
 */
function init(io, silaMesh) {
  const url = process.env.LORA_MQTT_URL;
  if (!url) return { enabled: false, reason: "LORA_MQTT_URL not set" };
  let mqtt;
  try { mqtt = require("mqtt"); } catch { return { enabled: false, reason: "mqtt package not installed" }; }

  const nsp = io.of("/sila");
  const client = mqtt.connect(url, {
    reconnectPeriod: 30000, // إعادة محاولة هادئة — لا تطفو الشبكة اللاسلكية
    connectTimeout: 10000,
    clean: true,
  });
  const gw = createLoraGateway({
    nsp,
    mqttClient: {
      subscribe: (t) => client.subscribe(t),
      publish: (t, s) => client.publish(t, s),
      onMessage: (cb) => client.on("message", (_t, payload) => cb(String(_t), payload.toString("utf8"))),
      end: (force) => client.end(force),
    },
    setTap: silaMesh && typeof silaMesh.setMessageTap === "function" ? silaMesh.setMessageTap : undefined,
    topic: process.env.LORA_MQTT_TOPIC || DEFAULT_TOPIC,
    room: process.env.LORA_ROOM || DEFAULT_ROOM,
  });
  return { enabled: true, gateway: gw };
}

module.exports = { createLoraGateway, init, MAX_LORA_PAYLOAD_BYTES, RATE_MAX_PER_SENDER, DEFAULT_TOPIC, DEFAULT_ROOM };
