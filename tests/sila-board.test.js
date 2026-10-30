// sila-board.test.js — امتدادات مساحة صلة لميزات P2:
// 1. رسائل اللوحة المشتركة (CRDT): kind:"board" تمر بحجم مقيد وتُسقط التالفة.
// 2. علامة الصادر (setMessageTap): تُستدعى لكل رسالة نصية صالحة وتُحيّد فشلها.
// كلها runtime على المساحة الحقيقية مع io وهمي — بلا شبكة ولا DB.

import { describe, it, expect } from 'vitest';
import silaMesh from '../server/sila-mesh.js';

const { sanitizeMessage, setMessageTap, MAX_OP_BYTES } = silaMesh;

describe('رسائل اللوحة المشتركة عبر مساحة صلة', () => {
  it('kind:"board" تمر: العملية كما هي مع معرّف مقصوص', () => {
    const op = { t: 'add', el: 'xyz', v: 'عنصر', ts: 123, oid: 'o1' };
    const clean = sanitizeMessage({ kind: 'board', id: 'm123', op });
    expect(clean).toEqual({ kind: 'board', id: 'm123', op });
  });

  it('العملية الأكبر من السقف (2048 بايت) تُسقط', () => {
    const op = { t: 'add', el: 'x', v: 'ا'.repeat(3000), ts: 1 };
    expect(sanitizeMessage({ kind: 'board', op })).toBe(null);
  });

  it('عملية تالفة/ضخمة تُسقط بأمان (بلا استثناءات)', () => {
    const circular = {};
    circular.self = circular;
    expect(sanitizeMessage({ kind: 'board', op: circular })).toBe(null);
    expect(sanitizeMessage({ kind: 'board', op: null })).toBe(null);
    expect(sanitizeMessage({ kind: 'board' })).toBe(null);
    expect(sanitizeMessage(null)).toBe(null);
  });

  it('رسائل المحادثة العادية تبقى كما كانت — لم تتأثر بالامتداد', () => {
    const clean = sanitizeMessage({ author: 'سامر', initials: 'س', time: '09:48', text: 'مرحبا', transport: 'net' });
    expect(clean).toEqual({ author: 'سامر', initials: 'س', time: '09:48', text: 'مرحبا', transport: 'net' });
    // وسم kind لا يُحاكى: رسالة عادية تحمل kind لا تمر كلوحة
    expect(sanitizeMessage({ author: 'س', text: 'hi', kind: 'not-board' })).toEqual(
      expect.objectContaining({ text: 'hi' })
    );
  });

  it('MAX_OP_BYTES أضيق من سقف النص (العمليات كثيرة ومتدفقة)', () => {
    expect(MAX_OP_BYTES).toBeLessThan(4000);
    expect(MAX_OP_BYTES).toBe(2048);
  });
});

describe('علامة الصادر (تستخدمها بوابة LoRa)', () => {
  /** يبني io وهمي ويعيد أدوات الوصول للمقبس الوهمي. */
  function fakeSilaSpace() {
    const handlers = new Map(); // socketId -> {ev: cb}
    const nsp = {
      on(ev, cb) { nsp._connection = cb; },
      to() { return { emit() {} }; },
      sockets: new Map(),
      adapter: { rooms: new Map() },
    };
    silaMesh.init({ of: () => nsp });
    const socketHandlers = {};
    const socket = {
      on: (ev, cb) => { socketHandlers[ev] = cb; },
      emit: () => {},
      join: () => {},
      id: 'test-socket-1',
    };
    nsp._connection(socket);
    return { socket, socketHandlers };
  }

  it('العلامة تُستدعى بـ(الغرفة، الرسالة) لكل رسالة نصية صالحة', () => {
    const seen = [];
    setMessageTap((room, msg) => seen.push([room, msg.text]));
    const { socket, socketHandlers } = fakeSilaSpace();
    socketHandlers['sila:message']({ message: { author: 'أ', text: 'مرحبا' }, room: 'square' });
    setMessageTap(null); // تنظيف فوري حتى لا تسرب العلامة بين الاختبارات
    expect(seen).toEqual([['square', 'مرحبا']]);
  });

  it('رسائل اللوحة لا تمر عبر العلامة (اللوحة ليست نصاً للبث الراديوي)', () => {
    const seen = [];
    setMessageTap((room, msg) => seen.push(room));
    const { socketHandlers } = fakeSilaSpace();
    socketHandlers['sila:message']({ message: { kind: 'board', id: 'x', op: { t: 'inc', n: 'a', by: 1 } }, room: 'square' });
    setMessageTap(null);
    expect(seen).toHaveLength(0);
  });

  it('فشل العلامة نفسها يُحيَّد — لا يوقف مسار الرسائل', () => {
    setMessageTap(() => { throw new Error('gateway exploded'); });
    const { socketHandlers } = fakeSilaSpace();
    expect(() =>
      socketHandlers['sila:message']({ message: { author: 'أ', text: 'مرحبا' }, room: 'square' })
    ).not.toThrow();
    setMessageTap(null);
  });

  it('setMessageTap(null) يزيل العلامة', () => {
    let calls = 0;
    setMessageTap(() => calls++);
    setMessageTap(null);
    const { socketHandlers } = fakeSilaSpace();
    socketHandlers['sila:message']({ message: { author: 'أ', text: 'مرحبا' }, room: 'square' });
    expect(calls).toBe(0);
  });
});
