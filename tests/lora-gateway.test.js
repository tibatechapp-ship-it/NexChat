// lora-gateway.test.js — بوابة LoRa/Meshtastic الاختيارية (P2 #10).
//
// البوابة تُبنى بالحقن الكامل (nsp + عميل MQTT وهمي) فتُختبر هنا بلا شبكة
// ولا حزمة mqtt حقيقية. الضمانات:
// 1. معطلة تماماً بلا LORA_MQTT_URL (init يفشل بهدوء).
// 2. الوارد: sendtext فقط، نص ≤ 200 بايت، مرسل صالح، 10 رسائل/دقيقة لكل مرسل.
// 3. الصادر: علامة sila-mesh تلتقط رسائل ساحة البوابة فقط وتنشرها JSON.
// 4. انقطاع/أخطاء MQTT لا ترمي أبداً على مسار صلة.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLoraGateway, DEFAULT_TOPIC, DEFAULT_ROOM, MAX_LORA_PAYLOAD_BYTES, RATE_MAX_PER_SENDER } from '../server/lora-gateway.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ===== أدوات وهمية =====

/** nsp وهمي يكشف ما بُثّ لغرفة، وonConnection لتسجيل مقابس اختبارية. */
function fakeNsp() {
  const emitted = [];
  const handlers = {};
  return {
    emitted,
    handlers,
    to(room) {
      return { emit: (event, payload) => emitted.push({ room, event, payload }) };
    },
    on(event, cb) { handlers[event] = cb; },
    // يدخل مقبس وهمي ويرجع محاكياً لأحداثه
    connect() {
      const socketHandlers = {};
      const socket = {
        on: (ev, cb) => { socketHandlers[ev] = cb; },
        emit: (ev, payload) => { (socketHandlers[`emit:${ev}`] || ((p) => {}))(payload); },
        join: () => {},
        id: 'sock-' + Math.random().toString(36).slice(2, 8),
        _rooms: new Set(['square']),
      };
      handlers.connection?.(socket);
      return socket;
    },
  };
}

/** عميل MQTT وهمي: يسجل المشتركات ويكشف الوارد والمنشور. */
function fakeMqtt() {
  const published = [];
  const subscribed = [];
  let messageCb = null;
  return {
    published,
    subscribed,
    subscribe: (t) => subscribed.push(t),
    publish: (t, s) => published.push({ topic: t, body: s }),
    onMessage: (cb) => { messageCb = cb; },
    inject(topic, body) { messageCb?.(topic, body); },
    failNextPublish: null,
  };
}

/** علامة الصادر كما تسجلها البوابة عبر setMessageTap من sila-mesh. */
function makeTapHolder() {
  let tap = null;
  return {
    setTap: (fn) => { tap = fn; },
    fire: (room, msg) => tap?.(room, msg),
  };
}

describe('العقد العامة للبوابة', () => {
  it('createLoraGateway يرفض بناء بلا مساحة أو بلا عميل MQTT', () => {
    expect(() => createLoraGateway({})).toThrow();
    expect(() => createLoraGateway({ nsp: fakeNsp() })).toThrow();
  });

  it('init معطلة بلا LORA_MQTT_URL (قرار التصميم: تعطيل آمن افتراضياً)', () => {
    // init يقرأ env ويحتاج mqtt الحقيقي — نختبر العقد الأمنية من المصدر
    const src = readFileSync(join(ROOT, 'server/lora-gateway.js'), 'utf8');
    expect(src).toMatch(/if \(!url\) return \{ enabled: false/);
    // والربط في server.js بعد silaMesh.init مباشرة
    const serverSrc = readFileSync(join(ROOT, 'server/server.js'), 'utf8');
    expect(serverSrc).toMatch(/loraGateway\.init\(io, silaMesh\)/);
  });

  it('mqtt معلنة في server/package.json (عقد server-deps)', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'server/package.json'), 'utf8'));
    expect(pkg.dependencies.mqtt).toBeTruthy();
  });

  it('السقوف المعلنة: 200 بايت و10 رسائل/دقيقة', () => {
    expect(MAX_LORA_PAYLOAD_BYTES).toBe(200);
    expect(RATE_MAX_PER_SENDER).toBe(10);
  });
});

describe('الوارد: LoRa → صلة', () => {
  let nsp, mqtt, tap;
  beforeEach(() => {
    nsp = fakeNsp();
    mqtt = fakeMqtt();
    tap = makeTapHolder();
    createLoraGateway({ nsp, mqttClient: mqtt, setTap: tap.setTap });
  });

  it('يشترك في موضوع Meshtastic الافتراضي', () => {
    expect(mqtt.subscribed).toEqual([DEFAULT_TOPIC]);
  });

  it('sendtext صالح يبث في ساحة lora كمؤلف LoRa واضح', () => {
    mqtt.inject('msh/2/json/LongFast', JSON.stringify({ sender: '!a1b2c3', type: 'sendtext', payload: 'مرحبا من العقدة' }));
    expect(nsp.emitted).toHaveLength(1);
    const e = nsp.emitted[0];
    expect(e.room).toBe(DEFAULT_ROOM);
    expect(e.event).toBe('sila:message');
    expect(e.payload.message.author).toContain('LoRa');
    expect(e.payload.message.text).toBe('مرحبا من العقدة');
    expect(e.payload.message.lora).toBe(true); // وسم المصدر غير المشفر
  });

  it('يسقط: غير النصي، النص الفارغ، المرسل التالف، وJSON التالف', () => {
    mqtt.inject('msh/2/json/LongFast', JSON.stringify({ sender: '!x', type: 'position', payload: 'x' }));
    mqtt.inject('msh/2/json/LongFast', JSON.stringify({ sender: '!x', type: 'sendtext', payload: '   ' }));
    mqtt.inject('msh/2/json/LongFast', JSON.stringify({ sender: '', type: 'sendtext', payload: 'hi' }));
    mqtt.inject('msh/2/json/LongFast', 'not-json-at-all');
    mqtt.inject('msh/2/json/LongFast', JSON.stringify({ sender: 'a'.repeat(40), type: 'sendtext', payload: 'hi' }));
    expect(nsp.emitted).toHaveLength(0);
  });

  it('يسقط النص الأطول من سقف حمولة LoRa', () => {
    mqtt.inject('msh/2/json/LongFast', JSON.stringify({ sender: '!x', type: 'sendtext', payload: 'a'.repeat(MAX_LORA_PAYLOAD_BYTES + 1) }));
    expect(nsp.emitted).toHaveLength(0);
    mqtt.inject('msh/2/json/LongFast', JSON.stringify({ sender: '!x', type: 'sendtext', payload: 'a'.repeat(MAX_LORA_PAYLOAD_BYTES) }));
    expect(nsp.emitted).toHaveLength(1);
  });

  it('رسائل من خارج msh/ تتجاهل', () => {
    mqtt.inject('other/topic', JSON.stringify({ sender: '!x', type: 'sendtext', payload: 'hi' }));
    expect(nsp.emitted).toHaveLength(0);
  });

  it('محدد المعدل: 10 رسائل/دقيقة لكل مرسل — الزائد يسقط، ومرسل آخر يمر', () => {
    for (let i = 0; i < RATE_MAX_PER_SENDER; i++) {
      mqtt.inject('msh/2/json/LongFast', JSON.stringify({ sender: '!spam', type: 'sendtext', payload: 'n' + i }));
    }
    expect(nsp.emitted).toHaveLength(RATE_MAX_PER_SENDER);
    mqtt.inject('msh/2/json/LongFast', JSON.stringify({ sender: '!spam', type: 'sendtext', payload: 'n-extra' }));
    expect(nsp.emitted).toHaveLength(RATE_MAX_PER_SENDER);
    mqtt.inject('msh/2/json/LongFast', JSON.stringify({ sender: '!calm', type: 'sendtext', payload: 'مرحبا' }));
    expect(nsp.emitted).toHaveLength(RATE_MAX_PER_SENDER + 1);
  });
});

describe('الصادر: صلة → LoRa (علامة sila-mesh)', () => {
  let nsp, mqtt, tap;
  beforeEach(() => {
    nsp = fakeNsp();
    mqtt = fakeMqtt();
    tap = makeTapHolder();
    createLoraGateway({ nsp, mqttClient: mqtt, setTap: tap.setTap });
  });

  it('رسالة نصية في ساحة البوابة تنشر JSON بنمط Meshtastic', () => {
    tap.fire(DEFAULT_ROOM, { author: 'أنت', initials: 'أ', time: '10:00', text: 'من صلة إلى العقدة', transport: 'mesh' });
    expect(mqtt.published).toHaveLength(1);
    const p = mqtt.published[0];
    expect(p.topic).toBe(DEFAULT_TOPIC);
    const parsed = JSON.parse(p.body);
    expect(parsed.type).toBe('sendtext');
    expect(parsed.payload).toBe('من صلة إلى العقدة');
    expect(parsed.sender).toBe('!rasan');
  });

  it('رسائل ساحات أخرى ونصوص الطول الزائد تتجاهل', () => {
    tap.fire('square', { text: 'رسالة عادية' });
    tap.fire(DEFAULT_ROOM, { text: 'ا'.repeat(MAX_LORA_PAYLOAD_BYTES + 1) });
    tap.fire(DEFAULT_ROOM, { text: '' });
    tap.fire(DEFAULT_ROOM, null);
    expect(mqtt.published).toHaveLength(0);
  });

  it('فشل النشر (وسيط ساقط) لا يرمي على مسار صلة', () => {
    mqtt.publish = () => { throw new Error('broker down'); };
    expect(() => tap.fire(DEFAULT_ROOM, { text: 'hi' })).not.toThrow();
  });

  it('close يوقف البوابة: لا بث وارد ولا نشر صادر بعدها', () => {
    const gw = createLoraGateway({ nsp, mqttClient: mqtt, setTap: tap.setTap });
    gw.close();
    mqtt.inject('msh/2/json/LongFast', JSON.stringify({ sender: '!x', type: 'sendtext', payload: 'hi' }));
    tap.fire(DEFAULT_ROOM, { text: 'out' });
    expect(nsp.emitted).toHaveLength(0);
    expect(mqtt.published).toHaveLength(0);
  });
});
