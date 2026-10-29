const $ = (id) => document.getElementById(id);
const state = {
  token: localStorage.getItem("rasan_token"),
  user: null, socket: null,
  myKeys: null,
  convs: [], activeConv: null, activeKey: null, activeKeyVersion: 1,
  locale: localStorage.getItem("rasan_locale") || "ar",
};

applyI18n(state.locale);

// ===== IndexedDB =====
async function idbPut(key, val) {
  return new Promise((res, rej) => {
    const req = indexedDB.open("rasan", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => { const tx = req.result.transaction("kv", "readwrite"); tx.objectStore("kv").put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); };
    req.onerror = () => rej(req.error);
  });
}
async function idbGet(key) {
  return new Promise((res, rej) => {
    const req = indexedDB.open("rasan", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => { const tx = req.result.transaction("kv", "readonly"); const g = tx.objectStore("kv").get(key); g.onsuccess = () => res(g.result); g.onerror = () => rej(g.error); };
    req.onerror = () => rej(req.error);
  });
}

// ===== API helper =====
async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (state.token) headers.Authorization = "Bearer " + state.token;
  const r = await fetch(path, { ...opts, headers });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.status);
  return data;
}

// ===== UX helpers: modals, toasts, prompts (UX audit R-1/R-2) =====
let _lastFocus = null;
function openModal(id) {
  const m = $(id);
  if (!m) return;
  _lastFocus = document.activeElement;
  m.classList.remove("hidden");
  const f = m.querySelector("input, textarea, select, button");
  if (f) f.focus();
}
function closeModal(id) {
  const m = $(id);
  if (!m) return;
  m.classList.add("hidden");
  if (_lastFocus && document.contains(_lastFocus)) { try { _lastFocus.focus(); } catch {} }
  _lastFocus = null;
}
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const open = [...document.querySelectorAll(".modal:not(.hidden), #verify-modal:not(.hidden)")];
  if (!open.length) return;
  e.preventDefault();
  const top = open[open.length - 1];
  if (top.id === "verify-modal") { top.classList.add("hidden"); top.setAttribute("aria-hidden", "true"); }
  else closeModal(top.id);
});
document.addEventListener("click", (e) => {
  const m = e.target.classList?.contains("modal") ? e.target : null;
  if (m && m.id) closeModal(m.id);
});

function showToast(msg, type = "info") {
  const t = document.createElement("div");
  t.className = "toast toast-" + type;
  t.setAttribute("role", type === "error" ? "alert" : "status");
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 3800);
}

function t(key) { return I18N[state.locale]?.[key] ?? I18N.en[key] ?? I18N.ar[key] ?? key; }
function translateErr(msg) {
  const m = String(msg ?? "");
  const map = (I18N[state.locale] || I18N.en).errors || I18N.en.errors || {};
  return map[m] || map[m.toLowerCase()] || m;
}

// Promise-based text prompt (replaces window.prompt)
function textPrompt({ title, initial = "", hint = "", confirmLabel }) {
  return new Promise((resolve) => {
    const wrap = document.createElement("section");
    wrap.className = "modal";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.innerHTML = `<div class="modal-card">
      <h3>${escapeHtml(title)}</h3>
      ${hint ? `<p class="recovery-hint">${escapeHtml(hint)}</p>` : ""}
      <input id="tp-input" autocomplete="off" />
      <div class="modal-actions">
        <button id="tp-ok" class="btn-primary">${escapeHtml(confirmLabel || t("save"))}</button>
        <button id="tp-cancel" class="btn-secondary">${t("cancel")}</button>
      </div>
    </div>`;
    document.body.appendChild(wrap);
    const input = wrap.querySelector("#tp-input");
    input.value = initial;
    input.focus();
    input.select();
    const done = (val) => { wrap.remove(); resolve(val); };
    wrap.querySelector("#tp-ok").onclick = () => done(input.value);
    wrap.querySelector("#tp-cancel").onclick = () => done(null);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) done(null); });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); done(input.value); } });
  });
}

// ===== Auth =====
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    $("submit").dataset.mode = tab.dataset.mode;
    const dict = I18N[state.locale];
    $("submit").textContent = tab.dataset.mode === "login" ? dict.login : dict.register;
  });
});
$("submit").dataset.mode = "login";

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("err").textContent = "";
  const mode = $("submit").dataset.mode;
  const btn = $("submit");
  state.locale = $("locale").value;
  localStorage.setItem("rasan_locale", state.locale);
  applyI18n(state.locale);
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = t("pleaseWait");
  try {
    if (mode === "register") {
      // Keypair is generated ONLY on registration (fix: never clobber keys on login)
      const kp = await RasanCrypto.genKeypair();
      state.myKeys = kp;
      await idbPut("myKeypair", kp);
    } else {
      // On login, reuse the locally stored keypair
      state.myKeys = await idbGet("myKeypair");
    }
    const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
    const body = { username: $("username").value.trim(), password: $("password").value };
    if (mode === "register") { body.publicKey = state.myKeys.publicKey; body.locale = state.locale; }
    const data = await api(path, { method: "POST", body: JSON.stringify(body) });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem("rasan_token", data.token);

    if (mode === "register") {
      const recoveryCode = RasanCrypto.generateRecoveryCode();
      const backup = await RasanCrypto.createKeyBackup(recoveryCode);
      await api("/api/auth/key-backup", { method: "POST", body: JSON.stringify(backup) });
      await showRecoveryCode(recoveryCode);
    } else if (!state.myKeys) {
      // New device without local keys — offer the restore flow
      await promptRestore();
    }
    await enterApp();
  } catch (err) { $("err").textContent = translateErr(err.message); }
  finally { btn.disabled = false; btn.textContent = originalText; }
});

function showRecoveryCode(code) {
  return new Promise((resolve) => {
    const modal = document.createElement("section");
    modal.className = "modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.innerHTML = `<div class="modal-card">
      <h3>${t("recoveryTitle")}</h3>
      <p class="recovery-hint">${t("recoveryHint")}</p>
      <div class="recovery-code">${code}</div>
      <button id="copy-rec" class="icon recovery-copy">${t("copy")}</button>
      <label class="recovery-ack">
        <input type="checkbox" id="ack-rec" /> ${t("ackSaved")}
      </label>
      <button id="confirm-rec" class="btn-primary" disabled style="opacity:.5">${t("continue")}</button>
    </div>`;
    document.body.appendChild(modal);
    const confirmBtn = modal.querySelector("#confirm-rec");
    modal.querySelector("#copy-rec").onclick = () => { navigator.clipboard.writeText(code); modal.querySelector("#copy-rec").textContent = t("copied"); setTimeout(() => modal.querySelector("#copy-rec").textContent = t("copy"), 1500); };
    modal.querySelector("#ack-rec").onchange = (e) => { confirmBtn.disabled = !e.target.checked; confirmBtn.style.opacity = e.target.checked ? "1" : ".5"; };
    confirmBtn.onclick = () => { modal.remove(); resolve(); };
  });
}

async function promptRestore() {
  const code = await textPrompt({
    title: t("restoreTitle"),
    hint: t("restoreHint"),
    confirmLabel: t("restoreBtn"),
  });
  if (!code) {
    const kp = await RasanCrypto.genKeypair();
    state.myKeys = kp;
    await idbPut("myKeypair", kp);
    await api("/api/auth/update-public-key", { method: "POST", body: JSON.stringify({ publicKey: kp.publicKey }) }).catch(() => {});
    return;
  }
  try {
    const backup = await api("/api/auth/key-backup");
    const recovered = await RasanCrypto.restoreFromBackup(code.trim(), backup);
    const parsed = JSON.parse(recovered);
    state.myKeys = parsed;
    await idbPut("myKeypair", parsed);
    showToast(t("restoreSuccess"), "success");
  } catch (e) {
    showToast(t("restoreFailed") + e.message, "error");
  }
}

// ===== Enter app =====
async function enterApp() {
  $("auth").classList.add("hidden");
  $("app").classList.remove("hidden");
  if (!state.myKeys) state.myKeys = await idbGet("myKeypair");
  connectSocket();
  await loadConversations();
}

function connectSocket() {
  state.socket = io({ auth: { token: state.token } });
  state.socket.on("message", async (msg) => {
    if (state.activeConv && msg.conversationId === state.activeConv.id) {
      if (msg.type === "file") {
        const text = await decryptMessage(msg);
        try { appendFileMessage(msg, JSON.parse(text)); } catch { appendMessage({ ...msg, text: "📎 ملف" }); }
      } else {
        const text = await decryptMessage(msg);
        appendMessage({ ...msg, text });
      }
    } else {
      const conv = state.convs.find(c => c.id === msg.conversationId);
      if (conv) { conv._unread = (conv._unread || 0) + 1; renderList(); }
    }
  });
  state.socket.on("message:deleted", ({ id }) => {
    const el = document.querySelector(`[data-mid="${id}"]`);
    if (el) { el.style.transition = "opacity .3s"; el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }
  });
  state.socket.on("message:edited", async ({ id, ciphertext, iv, edited_at }) => {
    const el = document.querySelector(`[data-mid="${id}"]`);
    if (!el || !state.activeKey) return;
    try {
      const text = await RasanCrypto.decrypt(state.activeKey, ciphertext, iv);
      const span = el.querySelector(".text");
      if (span) span.textContent = text;
      const edited = el.querySelector(".edited");
      if (edited) edited.textContent = "(معدّلة)";
    } catch (e) { console.error("edit decrypt failed:", e); }
  });
  state.socket.on("typing", ({ conversationId, name, isTyping }) => {
    if (state.activeConv?.id === conversationId) $("typing").textContent = isTyping ? `${name} ${I18N[state.locale].typing}` : "";
  });
  state.socket.on("presence", ({ userId, online }) => {
    document.querySelectorAll(`[data-uid="${userId}"]`).forEach(el => el.classList.toggle("online", online));
  });
  state.socket.on("group-key:updated", async ({ by, key_version }) => {
    if (!state.activeConv || by === state.user.id) return;
    try {
      const payload = await api(`/api/conversations/${state.activeConv.id}/group-key`);
      if (!payload.wrapped_key) return;
      state.activeKey = await RasanCrypto.unwrapGroupKey(payload, state.myKeys.privateKey, payload.owner_public_key);
      state.activeKeyVersion = payload.key_version;
    } catch (e) { console.error("Failed to refresh key:", e); $("typing").textContent = "⚠ تعذر تحديث مفتاح المجموعة"; }
  });
  state.socket.on("member:added", async ({ userId, username }) => {
    if (!state.activeConv) return;
    // If I'm owner, wrap key for new member
    if (state.activeConv.owner_id === state.user.id && state.activeKey) {
      try {
        const { members } = await api(`/api/conversations/${state.activeConv.id}/members`);
        const newMember = members.find(m => m.id === userId);
        if (newMember?.public_key) {
          const wrapped = await RasanCrypto.wrapGroupKeyForMember(state.activeKey, state.myKeys.privateKey, newMember.public_key);
          await api(`/api/conversations/${state.activeConv.id}/group-key/bulk`, { method: "POST", body: JSON.stringify({ entries: [{ userId, ...wrapped }], key_version: state.activeKeyVersion }) }).catch(() => {});
        }
      } catch (e) { console.error(e); }
    }
  });
  state.socket.on("member:removed", async ({ userId }) => {
    if (!state.activeConv) return;
    const { members } = await api(`/api/conversations/${state.activeConv.id}/members`).catch(() => ({ members: [] }));
    const me = members.find(m => m.id === state.user.id);
    if (!me || !["owner", "admin"].includes(me.role)) return;
    try { await rotateGroupKey(state.activeConv); } catch (e) { console.error("Key rotation failed:", e); }
  });
  state.socket.on("message:rejected", async ({ reason, expected, got }) => {
    if (reason === "key_version_mismatch") {
      try {
        const payload = await api(`/api/conversations/${state.activeConv.id}/group-key`);
        if (payload.wrapped_key) {
          state.activeKey = await RasanCrypto.unwrapGroupKey(payload, state.myKeys.privateKey, payload.owner_public_key);
          state.activeKeyVersion = payload.key_version;
        }
      } catch (e) { console.error(e); }
    }
  });
}

// ===== Conversations =====
async function loadConversations() {
  const { conversations } = await api("/api/conversations");
  state.convs = conversations;
  renderList();
}

function renderList() {
  const list = $("list");
  list.innerHTML = "";
  if (!state.convs.length) { list.innerHTML = `<p class="empty">${I18N[state.locale].noMessages}</p>`; return; }
  for (const c of state.convs) {
    const el = document.createElement("div");
    el.className = "conv";
    el.dataset.cid = c.id;
    const icon = c.type === "channel" ? "📢" : c.type === "group" ? "👥" : "💬";
    const unread = c._unread ? `<span class="badge">${c._unread}</span>` : "";
    const name = c.name || `DM #${c.id}`;
    el.innerHTML = `<div class="conv-icon">${icon}</div><div class="conv-body"><b>${escapeHtml(name)}</b><small>${c.members} ${I18N[state.locale].members || "members"}</small></div>${unread}`;
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", name);
    el.addEventListener("click", () => openConversation(c));
    el.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openConversation(c); } });
    list.appendChild(el);
  }
}

async function openConversation(conv) {
  state.activeConv = conv;
  conv._unread = 0;
  state.activeKeyVersion = 1;
  $("list").classList.add("hidden");
  $("chat").classList.remove("hidden");
  $("back").classList.remove("hidden");
  $("title").textContent = conv.name || "DM";
  $("messages").innerHTML = "";
  $("typing").textContent = "";
  state.socket.emit("join", { conversationId: conv.id });
  $("rotate-key").classList.toggle("hidden", conv.type === "dm");

  state.activeKey = null;
  if (conv.type === "dm") {
    const { members } = await api(`/api/conversations/${conv.id}/members`);
    const peer = members.find(m => m.id !== state.user.id);
    if (peer) {
      conv._peer = peer;
      if (peer.public_key) {
        state.activeKey = await RasanCrypto.deriveShared(state.myKeys.privateKey, peer.public_key);
        // Bridge to the security/identity module (TOFU + safety number + QR)
        window.dispatchEvent(new CustomEvent("rasan:conv-open", { detail: { peerId: String(peer.id), peerPublicKey: peer.public_key, myPublicKey: state.myKeys?.publicKey || null } }));
      }
    }
  } else {
    await ensureGroupKey(conv);
    try { const s = await api(`/api/conversations/${conv.id}/key-state`); state.activeKeyVersion = s.current; } catch {}
  }

  const { messages } = await api(`/api/conversations/${conv.id}/messages`);
  for (const m of messages) {
    if (m.type === "file") {
      const text = await decryptMessage(m);
      try { appendFileMessage(m, JSON.parse(text)); } catch { appendMessage({ ...m, text: "📎 ملف" }); }
    } else {
      const text = await decryptMessage(m);
      appendMessage({ ...m, text });
    }
  }
  $("msg-input").focus();
}

async function ensureGroupKey(conv) {
  if (state.activeKey) return;
  try {
    const payload = await api(`/api/conversations/${conv.id}/group-key`);
    if (!payload.wrapped_key) return;
    state.activeKey = await RasanCrypto.unwrapGroupKey(payload, state.myKeys.privateKey, payload.owner_public_key);
    state.activeKeyVersion = payload.key_version;
  } catch (e) { console.error("Failed to unwrap group key:", e); }
}

async function decryptMessage(m) {
  try { if (state.activeKey) return await RasanCrypto.decrypt(state.activeKey, m.ciphertext, m.iv); return "🔒"; } catch { return "🔒"; }
}

function appendMessage(m) {
  const div = document.createElement("div");
  div.className = "msg " + (m.senderId === state.user.id ? "mine" : "other");
  div.dataset.mid = m.id;

  const b = document.createElement("b"); b.textContent = m.senderName;
  const span = document.createElement("span"); span.className = "text"; span.textContent = m.text;
  const edited = document.createElement("em"); edited.className = "edited"; edited.textContent = m.edited_at ? t("edited") : "";
  const small = document.createElement("small"); small.textContent = new Date(m.time).toLocaleTimeString(state.locale, { hour: "2-digit", minute: "2-digit" });

  div.append(b, span, edited, small);

  if (m.senderId === state.user.id && m.type !== "file") {
    div.tabIndex = 0;
    div.setAttribute("aria-label", t("msgActionsHint"));
    div.addEventListener("contextmenu", (e) => { e.preventDefault(); showMsgMenu(m, div); });
    div.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showMsgMenu(m, div); } });
    let t = null;
    div.addEventListener("touchstart", () => { t = setTimeout(() => showMsgMenu(m, div), 600); });
    div.addEventListener("touchend", () => clearTimeout(t));
    div.addEventListener("touchmove", () => clearTimeout(t));
  }

  $("messages").appendChild(div);
  $("messages").scrollTop = $("messages").scrollHeight;
}

function showMsgMenu(m, msgEl) {
  closeMsgMenu();
  const menu = document.createElement("div");
  menu.className = "msg-menu";
  menu.dataset.msgMenu = "1";
  menu.setAttribute("role", "menu");

  const edit = document.createElement("button");
  edit.className = "msg-menu-item";
  edit.textContent = "✏ " + t("editMsg");
  edit.onclick = () => { closeMsgMenu(); editMessage(m); };

  const del = document.createElement("button");
  del.className = "msg-menu-item msg-menu-danger";
  del.textContent = "🗑 " + t("deleteMsg");
  del.onclick = () => { closeMsgMenu(); if (confirm(t("deleteMsgConfirm"))) state.socket.emit("message:delete", { messageId: m.id }); };

  menu.append(edit, del);
  const rect = msgEl.getBoundingClientRect();
  menu.style.top = Math.min(rect.bottom + 4, window.innerHeight - 120) + "px";
  menu.style.insetInlineStart = "16px";
  document.body.appendChild(menu);
  edit.focus();
  setTimeout(() => document.addEventListener("click", closeMsgMenu, { once: true }), 0);
}

function closeMsgMenu() { document.querySelectorAll("[data-msg-menu]").forEach(e => e.remove()); }

async function editMessage(m) {
  const current = document.querySelector(`[data-mid="${m.id}"] .text`)?.textContent || "";
  const newText = await textPrompt({ title: t("editMsg"), initial: current });
  if (newText === null || newText === current || !newText.trim()) return;
  if (newText.length > 2000) return showToast(t("maxChars"), "error");
  if (!state.activeKey) return;
  const { ciphertext, iv } = await RasanCrypto.encrypt(state.activeKey, newText.trim());
  state.socket.emit("message:edit", { messageId: m.id, ciphertext, iv });
}

// ===== Sending =====
$("send-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("msg-input").value.trim();
  if (!text || !state.activeKey) return;
  const { ciphertext, iv } = await RasanCrypto.encrypt(state.activeKey, text);
  state.socket.emit("message", { conversationId: state.activeConv.id, ciphertext, iv, type: "text", ephemeral_ttl: 0, key_version: state.activeConv.type === "dm" ? 1 : (state.activeKeyVersion || 1) });
  $("msg-input").value = "";
});

let typingTimer = null;
$("msg-input").addEventListener("input", () => {
  if (!state.activeConv) return;
  state.socket.emit("typing", { conversationId: state.activeConv.id, isTyping: true });
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => state.socket.emit("typing", { conversationId: state.activeConv.id, isTyping: false }), 1500);
});

// ===== Attach file =====
$("attach").addEventListener("click", () => $("file-input").click());
$("file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $("file-input").value = "";
  if (!state.activeKey) return showToast(t("keyNotReady"), "error");
  if (file.size > 30 * 1024 * 1024) return showToast(t("maxFileSize"), "error");

  try {
    $("upload-status").classList.remove("hidden");
    $("upload-label").textContent = `تشفير ${file.name}...`;
    $("upload-progress").style.width = "5%";

    const buf = await file.arrayBuffer();
    const { ciphertext, iv: fileIv } = await RasanCrypto.encryptFile(state.activeKey, buf);

    $("upload-label").textContent = `رفع ${file.name}...`;
    $("upload-progress").style.width = "20%";

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/attachments?conversationId=${state.activeConv.id}`);
    xhr.setRequestHeader("Authorization", "Bearer " + state.token);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) $("upload-progress").style.width = (20 + Math.round((ev.loaded / ev.total) * 70)) + "%"; };

    const attachmentId = await new Promise((resolve, reject) => {
      xhr.onload = () => { try { const data = JSON.parse(xhr.responseText); if (xhr.status >= 200 && xhr.status < 300) resolve(data.id); else reject(new Error(data.error || "upload failed")); } catch { reject(new Error("bad response")); } };
      xhr.onerror = () => reject(new Error("network error"));
      xhr.send(ciphertext);
    });

    $("upload-label").textContent = "إرسال...";
    $("upload-progress").style.width = "95%";

    const meta = { filename: file.name, mime: file.type || "application/octet-stream", size: file.size, attachmentId, fileIv };
    const { ciphertext: msgCt, iv: msgIv } = await RasanCrypto.encrypt(state.activeKey, JSON.stringify(meta));
    state.socket.emit("message", { conversationId: state.activeConv.id, ciphertext: msgCt, iv: msgIv, type: "file", attachmentId, key_version: state.activeConv.type === "dm" ? 1 : (state.activeKeyVersion || 1) });

    $("upload-progress").style.width = "100%";
    setTimeout(() => $("upload-status").classList.add("hidden"), 400);
  } catch (err) {
    console.error(err);
    showToast(t("uploadFailed") + err.message, "error");
    $("upload-status").classList.add("hidden");
  }
});

// ===== New DM =====
async function createDM(username, errEl) {
  try {
    const { user: peer } = await api(`/api/auth/users/${encodeURIComponent(username.trim())}`);
    if (!peer.public_key) throw new Error(t("noPeerKey"));
    const { id } = await api("/api/conversations", { method: "POST", body: JSON.stringify({ type: "dm", members: [username.trim()] }) });
    state.activeKey = await RasanCrypto.deriveShared(state.myKeys.privateKey, peer.public_key);
    await loadConversations();
    const conv = state.convs.find(c => c.id === id);
    if (conv) { conv._peer = peer; closeModal("dm-modal"); openConversation(conv); }
  } catch (err) {
    if (errEl) errEl.textContent = translateErr(err.message);
    else showToast(translateErr(err.message), "error");
  }
}

// ===== New chat: choice menu (replaces window.prompt) =====
$("new-chat").addEventListener("click", () => openModal("new-chat-modal"));
$("new-group").addEventListener("click", () => openModal("group-modal"));
$("choice-dm").addEventListener("click", () => { closeModal("new-chat-modal"); $("dm-username").value = ""; $("dm-err").textContent = ""; openModal("dm-modal"); });
$("choice-group").addEventListener("click", () => { closeModal("new-chat-modal"); $("group-err").textContent = ""; openModal("group-modal"); });
$("close-new-chat").addEventListener("click", () => closeModal("new-chat-modal"));
$("close-dm").addEventListener("click", () => closeModal("dm-modal"));
$("create-dm").addEventListener("click", () => {
  const username = $("dm-username").value.trim();
  if (!username) { $("dm-err").textContent = t("dmRequired"); return; }
  createDM(username, $("dm-err"));
});

$("close-group").addEventListener("click", () => closeModal("group-modal"));
$("create-group").addEventListener("click", async () => {
  const name = $("group-name").value.trim();
  const desc = $("group-desc").value.trim();
  const members = $("group-members").value.split(",").map(s => s.trim()).filter(Boolean);
  const type = $("group-type").value;
  if (!name) { $("group-err").textContent = t("groupNameRequired"); return; }
  $("group-err").textContent = "";
  try {
    const { id } = await api("/api/conversations", { method: "POST", body: JSON.stringify({ type, name, description: desc, members: [] }) });
    const added = [];
    const failed = [];
    for (const uname of members) {
      try { const r = await api(`/api/conversations/${id}/members`, { method: "POST", body: JSON.stringify({ username: uname }) }); added.push(r.member); } catch { failed.push(uname); }
    }
    const groupKey = await RasanCrypto.generateGroupKey();
    const entries = [];
    const selfWrapped = await RasanCrypto.wrapGroupKeyForMember(groupKey, state.myKeys.privateKey, state.myKeys.publicKey);
    entries.push({ userId: state.user.id, ...selfWrapped });
    for (const m of added) {
      if (!m.public_key) continue;
      const wrapped = await RasanCrypto.wrapGroupKeyForMember(groupKey, state.myKeys.privateKey, m.public_key);
      entries.push({ userId: m.id, ...wrapped });
    }
    await api(`/api/conversations/${id}/group-key/bulk`, { method: "POST", body: JSON.stringify({ entries, key_version: 1 }) });
    await loadConversations();
    closeModal("group-modal");
    const conv = state.convs.find(c => c.id === id);
    if (conv) { state.activeKey = groupKey; state.activeKeyVersion = 1; openConversation(conv); }
    if (failed.length) showToast(t("membersNotFound") + " " + failed.join(", "), "error");
  } catch (err) { $("group-err").textContent = translateErr(err.message); }
});

// ===== Key rotation =====
async function rotateGroupKey(conv) {
  if (!state.myKeys) throw new Error("no local keypair");
  if (conv.type === "dm") return;
  const { members } = await api(`/api/conversations/${conv.id}/members`);
  const newGroupKey = await RasanCrypto.generateGroupKey();
  const entries = [];
  for (const m of members) {
    if (!m.public_key) continue;
    const wrapped = await RasanCrypto.wrapGroupKeyForMember(newGroupKey, state.myKeys.privateKey, m.public_key);
    entries.push({ userId: m.id, ...wrapped });
  }
  const ks = await api(`/api/conversations/${conv.id}/key-state`);
  const newVersion = ks.current + 1;
  await api(`/api/conversations/${conv.id}/group-key/bulk`, { method: "POST", body: JSON.stringify({ entries, key_version: newVersion }) });
  if (state.activeConv?.id === conv.id) { state.activeKey = newGroupKey; state.activeKeyVersion = newVersion; }
  return newVersion;
}

// ===== Back / Logout =====
$("back").addEventListener("click", () => {
  state.activeConv = null; state.activeKey = null;
  $("chat").classList.add("hidden"); $("list").classList.remove("hidden");
  $("back").classList.add("hidden"); $("title").textContent = "رسن";
  window.dispatchEvent(new CustomEvent("rasan:conv-close"));
});

$("logout").addEventListener("click", () => { localStorage.removeItem("rasan_token"); location.reload(); });

// ===== Rotate key button =====
$("rotate-key").addEventListener("click", async () => {
  if (!state.activeConv || state.activeConv.type === "dm") return;
  if (!confirm(t("rotateConfirm"))) return;
  try { const v = await rotateGroupKey(state.activeConv); showToast(t("rotatedTo") + " " + v, "success"); } catch (e) { showToast(translateErr(e.message), "error"); }
});

// ===== Stories =====
$("stories-btn").addEventListener("click", async () => { openModal("stories"); await loadStories(); });
$("close-stories").addEventListener("click", () => closeModal("stories"));
async function loadStories() {
  const { stories } = await api("/api/stories");
  const list = $("stories-list");
  list.innerHTML = "";
  for (const s of stories) {
    const div = document.createElement("div");
    div.className = "story-item";
    div.innerHTML = `<b>${escapeHtml(s.username)}</b><p>🔒 (encrypted)</p><small>${new Date(s.createdAt).toLocaleString()}</small>`;
    div.addEventListener("click", () => api(`/api/stories/${s.id}/view`, { method: "POST" }).catch(() => {}));
    list.appendChild(div);
  }
}
$("story-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("story-text").value.trim();
  if (!text) return;
  let selfKey = await idbGet("selfStoryKey");
  if (!selfKey) { const k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]); selfKey = await RasanCrypto.exportAesKey(k); await idbPut("selfStoryKey", selfKey); }
  const key = await RasanCrypto.importAesKey(selfKey);
  const { ciphertext, iv } = await RasanCrypto.encrypt(key, text);
  await api("/api/stories", { method: "POST", body: JSON.stringify({ ciphertext, iv, type: "text" }) });
  $("story-text").value = "";
  await loadStories();
});

// ===== File message rendering =====
function appendFileMessage(m, meta) {
  const div = document.createElement("div");
  div.className = "msg " + (m.senderId === state.user.id ? "mine" : "other");
  div.dataset.mid = m.id;

  const b = document.createElement("b"); b.textContent = m.senderName;
  const att = document.createElement("div"); att.className = "attachment";
  att.innerHTML = `<div class="file-card"><span class="icon">⏳</span><div class="meta"><b>${escapeHtml(meta.filename)}</b><small>${formatSize(meta.size)} — جاري التحميل...</small></div></div>`;
  const small = document.createElement("small"); small.textContent = new Date(m.time).toLocaleTimeString(state.locale, { hour: "2-digit", minute: "2-digit" });

  div.append(b, att, small);
  $("messages").appendChild(div);
  $("messages").scrollTop = $("messages").scrollHeight;

  loadAndDisplayAttachment(meta, att).catch(() => {
    att.innerHTML = `<div class="file-card"><span class="icon">❌</span><div class="meta"><b>${escapeHtml(meta.filename)}</b><small>فشل التحميل</small></div></div>`;
  });
}

async function loadAndDisplayAttachment(meta, container) {
  const res = await fetch(`/api/attachments/${meta.attachmentId}`, { headers: { Authorization: "Bearer " + state.token } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const ctBuf = await res.arrayBuffer();
  const ptBuf = await RasanCrypto.decryptFile(state.activeKey, ctBuf, meta.fileIv);
  const blob = new Blob([ptBuf], { type: meta.mime });
  const url = URL.createObjectURL(blob);
  container.innerHTML = "";
  if (meta.mime.startsWith("image/")) {
    const img = document.createElement("img"); img.src = url; img.alt = meta.filename; img.addEventListener("click", () => window.open(url, "_blank")); container.appendChild(img);
  } else if (meta.mime.startsWith("video/")) {
    const v = document.createElement("video"); v.src = url; v.controls = true; container.appendChild(v);
  } else if (meta.mime.startsWith("audio/")) {
    const a = document.createElement("audio"); a.src = url; a.controls = true; container.appendChild(a);
  } else {
    const card = document.createElement("a"); card.className = "file-card"; card.href = url; card.download = meta.filename;
    card.innerHTML = `<span class="icon">📄</span><div class="meta"><b>${escapeHtml(meta.filename)}</b><small>${formatSize(meta.size)} — اضغط للتحميل</small></div>`;
    container.appendChild(card);
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

// ===== Boot =====
(async function boot() {
  if (!state.token) return;
  try {
    const { user } = await api("/api/auth/me");
    state.user = user;
    state.myKeys = await idbGet("myKeypair");
    if (state.myKeys) await enterApp();
  } catch { localStorage.removeItem("rasan_token"); }
})();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
