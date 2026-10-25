const $ = (id) => document.getElementById(id);
const state = {
  token: localStorage.getItem("rasan_token"),
  user: null, socket: null,
  myKeys: null,
  convs: [], activeConv: null, activeKey: null,
  locale: localStorage.getItem("rasan_locale") || "ar",
};

applyI18n(state.locale);

// ===== IndexedDB for private key =====
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
  state.locale = $("locale").value;
  localStorage.setItem("rasan_locale", state.locale);
  applyI18n(state.locale);
  try {
    const kp = await RasanCrypto.genKeypair();
    state.myKeys = kp;
    await idbPut("myKeypair", kp);
    const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
    const body = { username: $("username").value.trim(), password: $("password").value };
    if (mode === "register") { body.publicKey = kp.publicKey; body.locale = state.locale; }
    const data = await api(path, { method: "POST", body: JSON.stringify(body) });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem("rasan_token", data.token);
    await enterApp();
  } catch (err) { $("err").textContent = err.message; }
});

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
      const text = await decryptMessage(msg);
      appendMessage({ ...msg, text });
    } else {
      // notify
      const conv = state.convs.find(c => c.id === msg.conversationId);
      if (conv) conv._unread = (conv._unread || 0) + 1;
      renderList();
    }
  });
  state.socket.on("message:deleted", ({ id }) => {
    document.querySelector(`[data-mid="${id}"]`)?.remove();
  });
  state.socket.on("typing", ({ conversationId, name, isTyping }) => {
    if (state.activeConv?.id === conversationId) {
      $("typing").textContent = isTyping ? `${name} ${I18N[state.locale].typing}` : "";
    }
  });
  state.socket.on("presence", ({ userId, online }) => {
    document.querySelectorAll(`[data-uid="${userId}"]`).forEach(el => el.classList.toggle("online", online));
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
  if (!state.convs.length) {
    list.innerHTML = `<p class="empty">${I18N[state.locale].noMessages}</p>`;
    return;
  }
  for (const c of state.convs) {
    const el = document.createElement("div");
    el.className = "conv";
    el.dataset.cid = c.id;
    const icon = c.type === "channel" ? "📢" : c.type === "group" ? "👥" : "💬";
    const unread = c._unread ? `<span class="badge">${c._unread}</span>` : "";
    el.innerHTML = `
      <div class="conv-icon">${icon}</div>
      <div class="conv-body">
        <b>${escapeHtml(c.name || "DM #" + c.id)}</b>
        <small>${c.members} ${I18N[state.locale].members || "members"}</small>
      </div>
      ${unread}
    `;
    el.addEventListener("click", () => openConversation(c));
    list.appendChild(el);
  }
}

async function openConversation(conv) {
  state.activeConv = conv;
  conv._unread = 0;
  $("list").classList.add("hidden");
  $("chat").classList.remove("hidden");
  $("back").classList.remove("hidden");
  $("title").textContent = conv.name || "DM";
  $("messages").innerHTML = "";
  $("typing").textContent = "";
  state.socket.emit("join", { conversationId: conv.id });

  // Prepare decryption key
  state.activeKey = null;
  if (conv.type === "dm") {
    // find peer
    const { members } = await api(`/api/conversations/${conv.id}/members`);
    const peer = members.find(m => m.id !== state.user.id);
    if (peer && peer.public_key) {
      state.activeKey = await RasanCrypto.deriveShared(state.myKeys.privateKey, peer.public_key);
    }
  } else {
    const wrapped = await api(`/api/conversations/${conv.id}/group-key`);
    if (wrapped.encrypted_key) {
      // For MVP, group key is stored wrapped; we need the owner's pubkey to unwrap.
      // Simplified: try to import as raw AES key if owner shared it.
      try { state.activeKey = await RasanCrypto.importAesKey(wrapped.encrypted_key); } catch {}
    }
    if (!state.activeKey) {
      // Generate a new group key and distribute (owner only)
      if (conv.owner_id === state.user.id) {
        const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
        const raw = await RasanCrypto.exportAesKey(key);
        await api(`/api/conversations/${conv.id}/group-key`, { method: "POST", body: JSON.stringify({ encrypted_key: raw, iv: "" }) });
        state.activeKey = key;
      }
    }
  }

  const { messages } = await api(`/api/conversations/${conv.id}/messages`);
  for (const m of messages) {
    const text = await decryptMessage(m);
    appendMessage({ ...m, text });
  }
  $("msg-input").focus();
}

async function decryptMessage(m) {
  try {
    if (state.activeKey) return await RasanCrypto.decrypt(state.activeKey, m.ciphertext, m.iv);
    return "🔒";
  } catch { return "🔒"; }
}

function appendMessage(m) {
  const div = document.createElement("div");
  div.className = "msg " + (m.senderId === state.user.id ? "mine" : "other");
  div.dataset.mid = m.id;
  const time = new Date(m.time).toLocaleTimeString(state.locale, { hour: "2-digit", minute: "2-digit" });
  div.innerHTML = `<b>${escapeHtml(m.senderName)}</b><span>${escapeHtml(m.text)}</span><small>${time}</small>`;
  $("messages").appendChild(div);
  $("messages").scrollTop = $("messages").scrollHeight;
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

// ===== Sending =====
$("send-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("msg-input").value.trim();
  if (!text) return;
  if (!state.activeKey) { alert("No encryption key for this conversation"); return; }
  const { ciphertext, iv } = await RasanCrypto.encrypt(state.activeKey, text);
  state.socket.emit("message", { conversationId: state.activeConv.id, ciphertext, iv, type: "text", ephemeral_ttl: 0 });
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
  const fd = new FormData();
  fd.append("file", file);
  try {
    const r = await fetch("/api/media", { method: "POST", headers: { Authorization: "Bearer " + state.token }, body: fd });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    // send as message with media url
    if (state.activeKey) {
      const { ciphertext, iv } = await RasanCrypto.encrypt(state.activeKey, `[file:${data.url}:${file.name}]`);
      state.socket.emit("message", { conversationId: state.activeConv.id, ciphertext, iv, type: "file", ephemeral_ttl: 0 });
    }
  } catch (err) { alert(err.message); }
  e.target.value = "";
});

// ===== New DM =====
$("new-chat").addEventListener("click", async () => {
  const username = prompt(I18N[state.locale].newChat + ":");
  if (!username) return;
  try {
    const { user: peer } = await api(`/api/auth/users/${encodeURIComponent(username.trim())}`);
    if (!peer.public_key) throw new Error("peer has no public key");
    const { id } = await api("/api/conversations", { method: "POST", body: JSON.stringify({ type: "dm", members: [username.trim()] }) });
    state.activeKey = await RasanCrypto.deriveShared(state.myKeys.privateKey, peer.public_key);
    await loadConversations();
    const conv = state.convs.find(c => c.id === id);
    if (conv) { conv._peer = peer; openConversation(conv); }
  } catch (err) { alert(err.message); }
});

// ===== New Group =====
$("new-group").addEventListener("click", () => $("group-modal").classList.remove("hidden"));
$("close-group").addEventListener("click", () => $("group-modal").classList.add("hidden"));
$("create-group").addEventListener("click", async () => {
  const name = $("group-name").value.trim();
  const desc = $("group-desc").value.trim();
  const members = $("group-members").value.split(",").map(s => s.trim()).filter(Boolean);
  if (!name) return;
  try {
    const { id } = await api("/api/conversations", { method: "POST", body: JSON.stringify({ type: "group", name, description: desc, members }) });
    await loadConversations();
    $("group-modal").classList.add("hidden");
    const conv = state.convs.find(c => c.id === id);
    if (conv) openConversation(conv);
  } catch (err) { alert(err.message); }
});

// ===== Stories =====
$("stories-btn").addEventListener("click", async () => {
  $("stories").classList.remove("hidden");
  await loadStories();
});
$("close-stories").addEventListener("click", () => $("stories").classList.add("hidden"));
async function loadStories() {
  const { stories } = await api("/api/stories");
  const list = $("stories-list");
  list.innerHTML = "";
  for (const s of stories) {
    const div = document.createElement("div");
    div.className = "story-item";
    div.innerHTML = `<b>${escapeHtml(s.username)}</b><p>${escapeHtml(await decryptStory(s))}</p><small>${new Date(s.createdAt).toLocaleString()}</small>`;
    div.addEventListener("click", () => api(`/api/stories/${s.id}/view`, { method: "POST" }).catch(() => {}));
    list.appendChild(div);
  }
}
async function decryptStory(s) {
  // Stories use same key derivation as DM with self for MVP; just show ciphertext placeholder
  return "🔒 (encrypted)";
}
$("story-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("story-text").value.trim();
  if (!text) return;
  // Encrypt with self-key (simplified: use a random key stored locally)
  let selfKey = await idbGet("selfStoryKey");
  if (!selfKey) {
    const k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    selfKey = await RasanCrypto.exportAesKey(k);
    await idbPut("selfStoryKey", selfKey);
  }
  const key = await RasanCrypto.importAesKey(selfKey);
  const { ciphertext, iv } = await RasanCrypto.encrypt(key, text);
  await api("/api/stories", { method: "POST", body: JSON.stringify({ ciphertext, iv, type: "text" }) });
  $("story-text").value = "";
  await loadStories();
});

// ===== Back / Logout =====
$("back").addEventListener("click", () => {
  state.activeConv = null;
  state.activeKey = null;
  $("chat").classList.add("hidden");
  $("list").classList.remove("hidden");
  $("back").classList.add("hidden");
  $("title").textContent = "رسن";
});

$("logout").addEventListener("click", () => {
  localStorage.removeItem("rasan_token");
  location.reload();
});

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

// PWA
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
