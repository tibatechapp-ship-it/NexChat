import {
  generateSafetyNumber,
  tofuCheck,
  qrPayload,
  parseQR,
  markPeerVerified,
  isPeerVerified,
  getPeer,
} from './identity.js';

let ctx = { peerId: null, peerPublicB64: null, myPublicB64: null };

function $(id) { return document.getElementById(id); }

// Lazy-load the QR vendor lib (20.7KB) on first use — the verify modal is
// opened rarely, so it should not sit in the initial page weight.
let qrLibPromise = null;
function loadQrLib() {
  if (typeof window.qrcode === 'function') return Promise.resolve();
  if (!qrLibPromise) {
    qrLibPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/vendor/qrcode.min.js';
      s.onload = () => resolve();
      s.onerror = () => { qrLibPromise = null; reject(new Error('فشل تحميل مكتبة QR')); };
      document.head.appendChild(s);
    });
  }
  return qrLibPromise;
}

function formatGroups(digits) {
  return digits.match(/.{1,5}/g).join(' ');
}

export async function onConversationOpen(peerId, peerPublicB64, myPublicB64) {
  ctx = { peerId, peerPublicB64, myPublicB64 };

  const status = await tofuCheck(peerId, peerPublicB64);
  const verified = await isPeerVerified(peerId);

  applyStatus(status, verified);
  return status;
}

function applyStatus(status, verified) {
  const banner = $('security-banner');
  const input = $('msg-input');
  const sendBtn = $('send-btn');

  if (status === 'changed') {
    showBanner('danger',
      '⚠️ تغيّر مفتاح جهة الاتصال. لا ترسل رسائل حتى تتحقق.',
      'تحقق الآن', openVerifyModal);
    if (input) input.disabled = true;
    if (sendBtn) sendBtn.disabled = true;
    return;
  }

  if (status === 'new' || !verified) {
    showBanner('warning',
      '🛡️ لم يتم التحقق من هوية جهة الاتصال بعد.',
      'تحقق الآن', openVerifyModal);
    if (input) input.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
    return;
  }

  showBanner('success', '✅ تم التحقق من هوية جهة الاتصال.', null, null);
  if (input) input.disabled = false;
  if (sendBtn) sendBtn.disabled = false;
}

function showBanner(level, text, actionLabel, actionFn) {
  const el = $('security-banner');
  if (!el) return;
  el.className = `security-banner security-${level}`;
  el.innerHTML = '';

  const msg = document.createElement('span');
  msg.textContent = text;
  el.appendChild(msg);

  if (actionLabel && actionFn) {
    const btn = document.createElement('button');
    btn.className = 'security-action';
    btn.textContent = actionLabel;
    btn.addEventListener('click', actionFn);
    el.appendChild(btn);
  }
}

export async function openVerifyModal() {
  const modal = $('verify-modal');
  if (!modal || !ctx.peerId) return;

  const digits = await generateSafetyNumber(ctx.myPublicB64, ctx.peerPublicB64);
  const el = $('safety-number');
  if (el) el.textContent = formatGroups(digits);

  renderQR().catch((e) => {
    const box = $('qr-container');
    if (box) box.textContent = e.message;
  });

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

export function closeVerifyModal() {
  const modal = $('verify-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

async function renderQR() {
  const container = $('qr-container');
  if (!container) return;
  container.innerHTML = '';

  try {
    await loadQrLib();
  } catch (e) {
    container.textContent = 'QR library not loaded';
    return;
  }

  const payload = qrPayload(ctx.peerId, ctx.peerPublicB64);
  const json = JSON.stringify(payload);

  const qr = window.qrcode(0, 'M');
  qr.addData(json);
  qr.make();
  container.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 4 });
}

export async function scanQRFromVideo(videoEl) {
  if (!('BarcodeDetector' in window)) {
    throw new Error('BarcodeDetector غير مدعوم في هذا المتصفح');
  }
  const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
  const codes = await detector.detect(videoEl);
  if (!codes.length) return null;

  const parsed = parseQR(codes[0].rawValue);
  const peer = await getPeer(parsed.u);
  if (!peer) throw new Error('جهة الاتصال غير معروفة');
  if (peer.publicKey !== parsed.k && peer.identityPub !== parsed.k) {
    throw new Error('QR لا يطابق المفتاح المخزن — تحذير MITM');
  }
  return parsed;
}

export async function confirmVerified() {
  if (!ctx.peerId) return;
  await markPeerVerified(ctx.peerId);
  closeVerifyModal();
  applyStatus('same', true);
}

export function wireButtons() {
  $('btn-open-verify')?.addEventListener('click', openVerifyModal);
  $('btn-close-verify')?.addEventListener('click', closeVerifyModal);
  $('btn-confirm-verified')?.addEventListener('click', confirmVerified);
}
