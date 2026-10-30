import { state, rooms, getPeerCount } from "../state/appState.js";
import { escapeHtml, formatTime } from "../utils/helpers.js";

/** ألوان أفاتار متناوبة لعقد الشبكة الحقيقية. */
const PEER_PALETTE = ["yellow", "pink", "purple", "lime"];

/**
 * قائمة العقد القريبة من `state.peers` الفعلية.
 * تُستبدل القائمة التجريبية الثابتة: لا أسماء ولا حالة وهمية.
 */
export function renderPeers() {
  const peers = [...state.peers.entries()];
  if (peers.length === 0) {
    return `<p class="peer-empty">لا توجد عقد أخرى بعد — افتح صلة على جهاز آخر في نفس الشبكة.</p>`;
  }
  return peers
    .map(([id, seenAt], index) => {
      const name = String(id);
      const time = formatTime(new Date(Number(seenAt) || Date.now()));
      return `
    <div class="peer">
      <span class="avatar avatar-${PEER_PALETTE[index % PEER_PALETTE.length]}">
        ${escapeHtml(name.slice(0, 1))}
      </span>
      <div>
        <strong>${escapeHtml(name.slice(0, 8))}</strong>
        <small>متصل عبر Mesh · ${escapeHtml(time)}</small>
      </div>
      <i></i>
    </div>
  `;
    })
    .join("");
}

/**
 * صياغة عربية صحيحة لعدد العقد القريبة.
 */
export function describePeerCount(count) {
  if (!count || count < 1) return "لا عقد قريبة بعد";
  if (count === 1) return "عقدة واحدة قريبة";
  if (count === 2) return "عقدتان قريبتان";
  if (count <= 10) return `${count} عقد قريبة`;
  return `${count} عقدة قريبة`;
}

/**
 * توليد HTML لقائمة الغرف
 */
export function renderRoomList() {
  return rooms.map((room) => `
    <button 
      class="room-item ${room.name === state.activeRoom ? "active" : ""}" 
      data-room="${escapeHtml(room.name)}"
    >
      <span class="room-dot ${escapeHtml(room.color)}"></span>
      <span>${escapeHtml(room.name)}</span>
      <b>${Number(room.count) || 0}</b>
    </button>
  `).join("");
}

/**
 * توليد HTML للرسائل
 */
export function renderMessages() {
  return state.messages.map((message) => `
    <article class="message ${message.mine ? "mine" : ""}">
      <div class="avatar ${message.mine ? "avatar-you" : "avatar-other"}">
        ${escapeHtml(message.initials)}
      </div>
      <div class="message-body">
        <div class="message-meta">
          <strong>${escapeHtml(message.author)}</strong>
          <time>${escapeHtml(message.time)}</time>
          <span class="route ${message.transport === "internet" ? "internet" : "mesh"}">
            ${message.transport === "mesh" ? "Mesh" : "Net"}
          </span>
        </div>
        <p>${escapeHtml(message.text)}</p>
      </div>
    </article>
  `).join("");
}

/**
 * رسم التطبيق داخل الصفحة (#app).
 * يحتفظ بمسودة النص المكتوبة ويمرّر المحادثة لآخر رسالة.
 */
export function paint() {
  const root = document.querySelector("#app");
  const draft = document.querySelector("#message-input")?.value ?? "";
  root.innerHTML = renderApp();
  const input = document.querySelector("#message-input");
  if (input) input.value = draft;
  const messages = document.querySelector("#messages");
  if (messages) messages.scrollTop = messages.scrollHeight;
}

/**
 * توليد HTML الكامل للتطبيق
 */
export function renderApp() {
  const meshCount = getPeerCount();
  const meshLabel = describePeerCount(meshCount);
  
  return `
    <main class="shell">
      <header class="topbar">
        <div class="brand-lockup">
          <span class="brand-mark">ص</span>
          <div>
            <strong>صلة</strong>
            <small>تواصل بلا حدود</small>
          </div>
        </div>
        <div class="network-pill ${state.online ? "is-online" : "is-offline"}">
          <span></span>
          ${state.online ? "متصل بالإنترنت" : "وضع عدم الاتصال"}
        </div>
        <div class="profile">
          <span class="avatar avatar-you">أ</span>
          <div>
            <strong>أنت</strong>
            <small>متاح الآن</small>
          </div>
          <button class="icon-btn" aria-label="فتح القائمة">⋮</button>
        </div>
      </header>

      <section class="workspace">
        <aside class="sidebar">
          <div class="side-heading">
            <div>
              <small>مساحاتك</small>
              <h2>المجتمعات</h2>
            </div>
            <button class="square-btn" id="new-room" aria-label="إنشاء مساحة">+</button>
          </div>
          
          <nav class="room-list">
            ${renderRoomList()}
          </nav>
          
          <div class="side-divider"></div>
          
          <div class="mesh-card">
            <div class="mesh-orbit"><span></span><i></i><b></b></div>
            <div>
              <strong>شبكة Mesh محلية</strong>
              <p>${meshLabel}</p>
            </div>
            <button id="refresh-peers" aria-label="تحديث العقد">↻</button>
          </div>
          
          <div class="sidebar-footer">
            <span class="lock">⌁</span>
            <span>مشفّر من الطرف إلى الطرف</span>
          </div>
        </aside>

        <section class="chat-panel">
          <div class="chat-header">
            <div>
              <div class="eyebrow">مساحة مشتركة / ${escapeHtml(state.activeRoom)}</div>
              <h1>${escapeHtml(state.activeRoom)}</h1>
              <p>محادثة متزامنة عبر الإنترنت والشبكة المحلية</p>
            </div>
            <div class="header-actions">
              <button class="action-btn" id="share-room">
                ↗ <span>مشاركة</span>
              </button>
              <button class="action-btn muted" aria-label="المزيد">•••</button>
            </div>
          </div>
          
          <div class="transport-switch" role="tablist">
            <button class="${state.transport === "mesh" ? "selected" : ""}" data-transport="mesh">
              <span class="transport-icon">⌁</span> Mesh محلي
            </button>
            <button class="${state.transport === "internet" ? "selected" : ""}" data-transport="internet">
              <span class="transport-icon">◎</span> الإنترنت
            </button>
            <em>${state.transport === "mesh" ? "الأولوية للشبكة القريبة" : "مزامنة مع الخادم"}</em>
          </div>
          
          <div class="messages" id="messages">
            ${renderMessages()}
          </div>
          
          <form class="composer" id="composer">
            <button type="button" class="attach" aria-label="إرفاق ملف">＋</button>
            <input 
              id="message-input" 
              autocomplete="off" 
              placeholder="اكتب رسالة إلى ${escapeHtml(state.activeRoom)}..." 
            />
            <button class="send" aria-label="إرسال الرسالة">↑</button>
            <div class="composer-hint">
              Enter للإرسال · ${state.transport === "mesh" ? "ترسل للعقد القريبة" : "تزامن عبر الإنترنت"}
            </div>
          </form>
        </section>

        <aside class="details">
          <div class="details-head">
            <small>حالة المساحة</small>
            <span class="live-dot">● مباشر</span>
          </div>
          
          <div class="signal-card">
            <div class="signal-top">
              <span class="signal-icon">⌁</span>
              <div>
                <strong>صلة هجينة</strong>
                <p>${state.online ? "الإنترنت متاح، وMesh يعمل" : "Mesh يعمل دون إنترنت"}</p>
              </div>
            </div>
            <div class="signal-bars">
              <i></i><i></i><i></i><i></i><i></i>
            </div>
            <small>قوة الإشارة المحلية <b>ممتازة</b></small>
          </div>
          
          <div class="detail-section">
            <div class="detail-title">
              <strong>العقد القريبة</strong>
              <span>${meshCount}</span>
            </div>
            <div class="peer-list">
              ${renderPeers()}
            </div>
          </div>
          
          <div class="detail-section room-rules">
            <div class="detail-title">
              <strong>عن هذه المساحة</strong>
              <button aria-label="تعديل">✎</button>
            </div>
            <p>مكان هادئ لتنسيق أخبار الحي ومشاركة التحديثات المهمة، حتى عند ضعف الإنترنت.</p>
            <div class="tag-row">
              <span>#تنسيق</span>
              <span>#محلي</span>
              <span>#مجتمع</span>
            </div>
          </div>
          
          <div class="privacy-note">
            <span>◈</span>
            <div>
              <strong>خصوصية أولاً</strong>
              <p>الرسائل المحلية لا تغادر شبكتك.</p>
            </div>
          </div>
        </aside>
      </section>
    </main>
  `;
}
