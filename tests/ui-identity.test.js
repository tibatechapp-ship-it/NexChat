import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  onConversationOpen,
  openVerifyModal,
  confirmVerified,
} from '../web/ui-identity.js';
import * as identity from '../web/identity.js';

beforeEach(() => {
  document.body.innerHTML = `
    <div id="security-banner"></div>
    <input id="msg-input" />
    <button id="send-btn"></button>
    <div id="verify-modal" class="hidden"></div>
    <div id="safety-number"></div>
    <div id="qr-container"></div>
    <button id="btn-confirm-verified"></button>
  `;
  vi.restoreAllMocks();
});

describe('security banner', () => {
  it('يعرض danger ويُعطّل الإرسال عند changed', async () => {
    vi.spyOn(identity, 'tofuCheck').mockResolvedValue('changed');
    vi.spyOn(identity, 'isPeerVerified').mockResolvedValue(false);

    await onConversationOpen('bob', 'PUB', 'MY_PUB');

    const banner = document.getElementById('security-banner');
    expect(banner.className).toContain('security-danger');
    expect(document.getElementById('msg-input').disabled).toBe(true);
    expect(document.getElementById('send-btn').disabled).toBe(true);
  });

  it('يعرض warning عند new', async () => {
    vi.spyOn(identity, 'tofuCheck').mockResolvedValue('new');
    vi.spyOn(identity, 'isPeerVerified').mockResolvedValue(false);

    await onConversationOpen('bob', 'PUB', 'MY_PUB');

    const banner = document.getElementById('security-banner');
    expect(banner.className).toContain('security-warning');
    expect(document.getElementById('msg-input').disabled).toBe(false);
  });

  it('يعرض success عند same + verified', async () => {
    vi.spyOn(identity, 'tofuCheck').mockResolvedValue('same');
    vi.spyOn(identity, 'isPeerVerified').mockResolvedValue(true);

    await onConversationOpen('bob', 'PUB', 'MY_PUB');

    const banner = document.getElementById('security-banner');
    expect(banner.className).toContain('security-success');
    expect(document.getElementById('msg-input').disabled).toBe(false);
  });
});

describe('confirmVerified', () => {
  it('يحفظ التحقق ويحوّل الشريط إلى success', async () => {
    vi.spyOn(identity, 'tofuCheck').mockResolvedValue('new');
    vi.spyOn(identity, 'isPeerVerified').mockResolvedValue(false);
    const markSpy = vi.spyOn(identity, 'markPeerVerified').mockResolvedValue();
    vi.spyOn(identity, 'generateSafetyNumber')
      .mockResolvedValue('123456789012345678901234567890123456789012345678901234567890');

    await onConversationOpen('bob', 'PUB', 'MY_PUB');
    await openVerifyModal();
    await confirmVerified();

    expect(markSpy).toHaveBeenCalledWith('bob');
    const banner = document.getElementById('security-banner');
    expect(banner.className).toContain('security-success');
  });
});
