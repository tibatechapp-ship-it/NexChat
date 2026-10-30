// emergency.test.js — عقد نقطة إنذار الطوارئ في الخادم (server.js).
//
// إنذار الطوارئ (من بحث الميزات — Zello نموذجاً): عضو يطلق بثاً فورياً
// لكل أعضاء محادثة. الضمانات الأربعة هنا:
// 1. خلف authRequired + فحص عضوية صريح (لا بث عشوائي لغير الأعضاء).
// 2. كوه التبريد 60ث لكل مستخدم لكل محادثة (429) — منع الإساءة/السبام.
// 3. حدث Socket لكل من في الغرفة + FCM لغير المتصلين فقط (بلا ازدواج).
// 4. نص الإشعار من القالب الثابت حصراً مع احترام تفضيل الطوارئ لكل مستخدم.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('emergency endpoint contract (server.js)', () => {
  const server = read('server/server.js');

  it('exists behind authRequired with an explicit membership check', () => {
    expect(server).toMatch(/app\.post\("\/api\/conversations\/:id\/emergency",\s*authRequired/);
    expect(server).toMatch(
      /SELECT 1 FROM conversation_members WHERE conversation_id = \? AND user_id = \?/
    );
  });

  it('rate-limits: 60s cooldown per user per conversation → 429', () => {
    expect(server).toMatch(/EMERGENCY_COOLDOWN_MS = 60 \* 1000/);
    expect(server).toMatch(/lastEmergency\.get\(/);
    expect(server).toMatch(/status\(429\)/);
  });

  it('broadcasts a socket event to the room and pushes only offline members', () => {
    expect(server).toMatch(/io\.to\("conv:" \+ convId\)\.emit\("emergency"/);
    expect(server).toMatch(/onlineIds\.has\(mm\.user_id\)/); // المتصلون عبر Socket فقط
    expect(server).toMatch(/notifyUser\(mm\.user_id, "emergency"/);
  });

  it('push path respects the per-user emergency preference', () => {
    expect(server).toMatch(/canPush\(mm\.user_id, "emergency"\)/);
  });

  it('never embeds message-like content in the socket event (ids/timestamp only)', () => {
    // الحمولة: conversationId, by, byName, at — لا حقل نصّي حرّ
    expect(server).toMatch(
      /emit\("emergency",\s*\{\s*conversationId:\s*convId,\s*by:\s*req\.user\.id,\s*byName:\s*req\.user\.username,\s*at\s*\}\)/
    );
  });
});

describe('emergency notification template (notifications.js)', () => {
  it('is a fixed template — the only safe source for emergency push text', () => {
    const notifications = read('server/notifications.js');
    expect(notifications).toMatch(/emergency:\s*\{\s*title:\s*"رسن",\s*body:\s*"🚨 تنبيه طوارئ[^"]*"\s*\}/);
  });
});

describe('offline outbox + delivery ack contract (server.js)', () => {
  const server = read('server/server.js');

  it('accepts a clientId (≤64 chars) on messages and echoes it back', () => {
    expect(server).toMatch(/attachmentId,\s*clientId\s*\}/);
    expect(server).toMatch(/clientId\.length <= 64/);
    expect(server).toMatch(/emit\("message:ack",\s*\{\s*clientId:\s*msg\.clientId,\s*id:\s*msg\.id,\s*time\s*\}\)/);
  });

  it('ack is only sent to the sender socket, not broadcast', () => {
    // socket.emit وليس io.to(...).emit — الإقرار خاص بالمرسل
    expect(server).toMatch(/socket\.emit\("message:ack"/);
  });
});
