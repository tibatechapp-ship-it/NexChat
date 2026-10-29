const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { Server } = require("socket.io");
const { db, DATA_DIR, UPLOAD_DIR } = require("./db");
const { router: authRouter, verifyToken, authRequired } = require("./auth");
const security = require("./security");
const push = require("./push");
const notifications = require("./notifications");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" }, maxHttpBufferSize: 1e6, pingTimeout: 30000 });

app.set("trust proxy", 1);
app.use(security.securityHeaders);
app.use(security.requireJson);
app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(__dirname, "..", "web"), { maxAge: "1h" }));

app.use("/api/auth/login", security.authLimiter);
app.use("/api/auth/register", security.authLimiter);
app.use("/api/", security.apiLimiter);
app.use("/api/attachments", security.uploadLimiter);
app.use("/api/auth", authRouter);
app.use("/api", notifications.createRouter({ authRequired }));

const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 30 * 1024 * 1024 } });

push.init();

// Deployment identity. Render exports the commit it is serving, so a post-deploy
// check can prove that the LIVE process runs the code which just landed — a 200
// from a stale container proves nothing about the deploy.
const COMMIT = (process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || "").slice(0, 7);
const VERSION = require("./package.json").version;

app.get("/health", (_q, res) =>
  res.json({ ok: true, uptime: process.uptime(), version: VERSION, commit: COMMIT })
);
app.get("/api/stats", (req, res) => {
  const key = req.query.key;
  if (key !== process.env.STATS_KEY) return res.status(403).json({ error: "forbidden" });
  const users = db.prepare("SELECT COUNT(*) c FROM users").get().c;
  const convs = db.prepare("SELECT COUNT(*) c FROM conversations").get().c;
  const msgs = db.prepare("SELECT COUNT(*) c FROM messages").get().c;
  const last24h = db.prepare("SELECT COUNT(*) c FROM messages WHERE time > ?").get(Date.now() - 86400000).c;
  res.json({ users, convs, msgs, last24h });
});

// ===== Socket.IO auth =====
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("unauthorized"));
  const p = verifyToken(token);
  if (!p) return next(new Error("unauthorized"));
  const user = db.prepare("SELECT id, username, public_key FROM users WHERE id = ?").get(p.sub);
  if (!user) return next(new Error("unauthorized"));
  socket.user = user;
  socket._msgCount = 0;
  socket._msgWindow = Date.now();
  next();
});

const presence = new Map();
function broadcastPresence(userId, online) {
  const convs = db.prepare("SELECT conversation_id FROM conversation_members WHERE user_id = ?").all(userId);
  for (const c of convs) io.to("conv:" + c.conversation_id).emit("presence", { userId, online });
}

function checkSocketRate(socket) {
  const now = Date.now();
  if (now - socket._msgWindow > 10000) { socket._msgWindow = now; socket._msgCount = 0; }
  socket._msgCount++;
  if (socket._msgCount > 20) { socket.emit("message:rejected", { reason: "rate_limit" }); return false; }
  return true;
}

io.on("connection", (socket) => {
  const uid = socket.user.id;
  if (!presence.has(uid)) presence.set(uid, new Set());
  presence.get(uid).add(socket.id);
  broadcastPresence(uid, true);

  const convs = db.prepare("SELECT conversation_id FROM conversation_members WHERE user_id = ?").all(uid);
  for (const c of convs) socket.join("conv:" + c.conversation_id);

  socket.on("join", ({ conversationId }) => {
    const m = db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(conversationId, uid);
    if (m) socket.join("conv:" + conversationId);
  });

  socket.on("message", (payload) => {
    if (!checkSocketRate(socket)) return;
    const { conversationId, ciphertext, iv, type, ephemeral_ttl, key_version, attachmentId } = payload || {};
    if (!conversationId || !ciphertext || !iv) return;

    const m = db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(conversationId, uid);
    if (!m) return;

    const conv = db.prepare("SELECT type, current_key_version FROM conversations WHERE id = ?").get(conversationId);
    if (!conv) return;

    if (conv.type !== "dm") {
      const kv = Number.isInteger(key_version) ? key_version : 1;
      if (kv !== conv.current_key_version) {
        socket.emit("message:rejected", { conversationId, reason: "key_version_mismatch", expected: conv.current_key_version, got: kv });
        return;
      }
    }

    if (attachmentId) {
      const att = db.prepare("SELECT conversation_id, uploader_id FROM attachments WHERE id = ?").get(attachmentId);
      if (!att || att.conversation_id !== conversationId || att.uploader_id !== uid) {
        socket.emit("message:rejected", { conversationId, reason: "bad_attachment" });
        return;
      }
    }

    const time = Date.now();
    const info = db.prepare("INSERT INTO messages (conversation_id, sender_id, type, ciphertext, iv, ephemeral_ttl, time, key_version, attachment_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(conversationId, uid, type || "text", ciphertext, iv, ephemeral_ttl || 0, time, key_version || 1, attachmentId || null);
    const msg = { id: info.lastInsertRowid, conversationId, senderId: uid, senderName: socket.user.username, type: type || "text", ciphertext, iv, time, ephemeral_ttl: ephemeral_ttl || 0, key_version: key_version || 1, attachmentId: attachmentId || null };
    io.to("conv:" + conversationId).emit("message", msg);

    // Push for offline members
    const members = db.prepare("SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?").all(conversationId, uid);
    const onlineIds = new Set();
    for (const [sid, sock] of io.sockets.sockets) {
      if (sock.user && members.some((m) => m.user_id === sock.user.id)) onlineIds.add(sock.user.id);
    }
    for (const mm of members) {
      if (onlineIds.has(mm.user_id)) continue;
      if (!notifications.canPush(mm.user_id, "new_message")) continue; // تفضيلات المستخدم (تشغيل/إيقاف)
      push.sendToUser(mm.user_id, notifications.buildNotificationPayload("new_message", { conversationId, messageId: msg.id }));
    }

    if (ephemeral_ttl > 0) {
      setTimeout(() => {
        db.prepare("DELETE FROM messages WHERE id = ?").run(msg.id);
        io.to("conv:" + conversationId).emit("message:deleted", { id: msg.id });
        if (msg.attachmentId) {
          const p = path.join(UPLOAD_DIR, msg.attachmentId + ".bin");
          if (fs.existsSync(p)) fs.unlinkSync(p);
          db.prepare("DELETE FROM attachments WHERE id = ?").run(msg.attachmentId);
        }
      }, ephemeral_ttl * 1000);
    }
  });

  socket.on("typing", ({ conversationId, isTyping }) => {
    socket.to("conv:" + conversationId).emit("typing", { conversationId, userId: uid, name: socket.user.username, isTyping: !!isTyping });
  });

  socket.on("read", ({ conversationId, messageId }) => {
    db.prepare("UPDATE conversation_members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ?").run(messageId, conversationId, uid);
    socket.to("conv:" + conversationId).emit("read", { conversationId, userId: uid, messageId });
  });

  socket.on("message:delete", ({ messageId }) => {
    if (!Number.isInteger(messageId)) return;
    const row = db.prepare("SELECT conversation_id, sender_id FROM messages WHERE id = ?").get(messageId);
    if (!row || row.sender_id !== uid) { socket.emit("message:rejected", { reason: "not_owner" }); return; }
    const m = db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(row.conversation_id, uid);
    if (!m) return;
    db.prepare("DELETE FROM messages WHERE id = ?").run(messageId);
    io.to("conv:" + row.conversation_id).emit("message:deleted", { id: messageId });
  });

  socket.on("message:edit", ({ messageId, ciphertext, iv }) => {
    if (!Number.isInteger(messageId) || !ciphertext || !iv) return;
    const row = db.prepare("SELECT conversation_id, sender_id, type FROM messages WHERE id = ?").get(messageId);
    if (!row || row.sender_id !== uid) { socket.emit("message:rejected", { reason: "not_owner" }); return; }
    if (row.type === "file") { socket.emit("message:rejected", { reason: "cannot_edit_file" }); return; }
    const m = db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(row.conversation_id, uid);
    if (!m) return;
    const now = Date.now();
    db.prepare("UPDATE messages SET ciphertext = ?, iv = ?, edited_at = ? WHERE id = ?").run(ciphertext, iv, now, messageId);
    io.to("conv:" + row.conversation_id).emit("message:edited", { id: messageId, ciphertext, iv, edited_at: now });
  });

  socket.on("disconnect", () => {
    presence.get(uid)?.delete(socket.id);
    if (presence.get(uid)?.size === 0) { presence.delete(uid); broadcastPresence(uid, false); }
  });
});

// ===== REST: conversations =====
app.get("/api/conversations", authRequired, (req, res) => {
  const rows = db.prepare(`SELECT c.id, c.type, c.name, c.description, c.owner_id, c.created_at, c.current_key_version,
    (SELECT COUNT(*) FROM conversation_members WHERE conversation_id = c.id) AS members
    FROM conversations c JOIN conversation_members m ON m.conversation_id = c.id
    WHERE m.user_id = ? ORDER BY c.created_at DESC`).all(req.user.id);
  res.json({ conversations: rows });
});

app.post("/api/conversations", authRequired, (req, res) => {
  const { type, name, description, members } = req.body || {};
  if (!["dm", "group", "channel"].includes(type)) return res.status(400).json({ error: "bad type" });
  const info = db.prepare("INSERT INTO conversations (type, name, description, owner_id, created_at) VALUES (?, ?, ?, ?, ?)").run(type, name || null, description || null, req.user.id, Date.now());
  const cid = info.lastInsertRowid;
  const addMember = db.prepare("INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)");
  addMember.run(cid, req.user.id, "owner", Date.now());
  for (const uname of (members || [])) {
    const u = db.prepare("SELECT id FROM users WHERE username = ?").get(uname);
    if (u) addMember.run(cid, u.id, "member", Date.now());
  }
  io.to("conv:" + cid).emit("conversation:created", { id: cid });
  res.json({ id: cid });
});

app.get("/api/conversations/:id", authRequired, (req, res) => {
  const m = db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!m) return res.status(403).json({ error: "forbidden" });
  const c = db.prepare("SELECT * FROM conversations WHERE id = ?").get(req.params.id);
  res.json({ conversation: c });
});

app.get("/api/conversations/:id/members", authRequired, (req, res) => {
  const m = db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!m) return res.status(403).json({ error: "forbidden" });
  const rows = db.prepare("SELECT u.id, u.username, u.public_key, cm.role, cm.joined_at FROM conversation_members cm JOIN users u ON u.id = cm.user_id WHERE cm.conversation_id = ? ORDER BY cm.joined_at ASC").all(req.params.id);
  res.json({ members: rows });
});

app.post("/api/conversations/:id/members", authRequired, (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: "username required" });
  const owner = db.prepare("SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!owner || !["owner", "admin"].includes(owner.role)) return res.status(403).json({ error: "not allowed" });
  const target = db.prepare("SELECT id, username, public_key FROM users WHERE username = ?").get(username);
  if (!target) return res.status(404).json({ error: "user not found" });
  if (!target.public_key) return res.status(400).json({ error: "target has no public key" });
  const exists = db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(req.params.id, target.id);
  if (exists) return res.status(409).json({ error: "already a member" });
  db.prepare("INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").run(req.params.id, target.id, Date.now());
  io.to("conv:" + req.params.id).emit("member:added", { userId: target.id, username: target.username });
  // إشعار الدعوة للمجموعة — قالب ثابت بلا أي محتوى (E2EE)
  notifications.notifyUser(target.id, "group_invite", { conversationId: Number(req.params.id) });
  res.json({ ok: true, member: { id: target.id, username: target.username, public_key: target.public_key } });
});

app.delete("/api/conversations/:id/members/:userId", authRequired, (req, res) => {
  const owner = db.prepare("SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!owner || !["owner", "admin"].includes(owner.role)) return res.status(403).json({ error: "not allowed" });
  if (Number(req.params.userId) === req.user.id) return res.status(400).json({ error: "cannot remove self" });
  db.prepare("DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?").run(req.params.id, req.params.userId);
  db.prepare("DELETE FROM group_keys WHERE conversation_id = ? AND user_id = ?").run(req.params.id, req.params.userId);
  io.to("conv:" + req.params.id).emit("member:removed", { userId: Number(req.params.userId) });
  res.json({ ok: true });
});

app.get("/api/conversations/:id/messages", authRequired, (req, res) => {
  const m = db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!m) return res.status(403).json({ error: "forbidden" });
  const rows = db.prepare(`SELECT m.id, m.conversation_id AS conversationId, m.sender_id AS senderId, u.username AS senderName, m.type, m.ciphertext, m.iv, m.ephemeral_ttl, m.time, m.key_version, m.attachment_id AS attachmentId, m.deleted, m.edited_at FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.conversation_id = ? AND m.deleted = 0 ORDER BY m.time DESC LIMIT 100`).all(req.params.id).reverse();
  res.json({ messages: rows });
});

// ===== Group key =====
app.post("/api/conversations/:id/group-key/bulk", authRequired, (req, res) => {
  const { entries, key_version } = req.body || {};
  if (!Array.isArray(entries) || !entries.length) return res.status(400).json({ error: "entries required" });
  const version = Number.isInteger(key_version) && key_version > 0 ? key_version : 1;
  const owner = db.prepare("SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!owner || !["owner", "admin"].includes(owner.role)) return res.status(403).json({ error: "not allowed" });
  const conv = db.prepare("SELECT current_key_version FROM conversations WHERE id = ?").get(req.params.id);
  if (!conv) return res.status(404).json({ error: "conversation not found" });
  if (version <= conv.current_key_version) return res.status(409).json({ error: "key_version too old", current: conv.current_key_version });

  const members = new Set(db.prepare("SELECT user_id FROM conversation_members WHERE conversation_id = ?").all(req.params.id).map((r) => r.user_id));
  const upsert = db.prepare(`INSERT INTO group_keys (conversation_id, user_id, wrapped_by, wrapped_key, iv, key_version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(conversation_id, user_id) DO UPDATE SET wrapped_by=excluded.wrapped_by, wrapped_key=excluded.wrapped_key, iv=excluded.iv, key_version=excluded.key_version, updated_at=excluded.updated_at`);
  const now = Date.now();
  try {
    db.exec("BEGIN");
    for (const e of entries) {
      if (!members.has(e.userId)) continue;
      if (typeof e.wrapped_key !== "string" || typeof e.iv !== "string") continue;
      upsert.run(req.params.id, e.userId, req.user.id, e.wrapped_key, e.iv, version, now);
    }
    db.prepare("UPDATE conversations SET current_key_version = ? WHERE id = ?").run(version, req.params.id);
    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch {}
    throw err;
  }
  io.to("conv:" + req.params.id).emit("group-key:updated", { by: req.user.id, key_version: version });
  res.json({ ok: true, updated: entries.length, key_version: version });
});

app.get("/api/conversations/:id/group-key", authRequired, (req, res) => {
  const m = db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!m) return res.status(403).json({ error: "forbidden" });
  const row = db.prepare(`SELECT gk.wrapped_key, gk.iv, gk.wrapped_by, gk.key_version, u.public_key AS owner_public_key FROM group_keys gk JOIN users u ON u.id = gk.wrapped_by WHERE gk.conversation_id = ? AND gk.user_id = ?`).get(req.params.id, req.user.id);
  const conv = db.prepare("SELECT current_key_version FROM conversations WHERE id = ?").get(req.params.id);
  res.json({ ...(row || { wrapped_key: null }), current_key_version: conv?.current_key_version || 1 });
});

app.get("/api/conversations/:id/key-state", authRequired, (req, res) => {
  const m = db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!m) return res.status(403).json({ error: "forbidden" });
  const conv = db.prepare("SELECT current_key_version FROM conversations WHERE id = ?").get(req.params.id);
  const mine = db.prepare("SELECT key_version FROM group_keys WHERE conversation_id = ? AND user_id = ?").get(req.params.id, req.user.id);
  res.json({ current: conv?.current_key_version || 1, mine: mine?.key_version || 0, up_to_date: (mine?.key_version || 0) === (conv?.current_key_version || 1) });
});

// ===== Stories =====
app.post("/api/stories", authRequired, (req, res) => {
  const { ciphertext, iv, type } = req.body || {};
  if (!ciphertext || !iv) return res.status(400).json({ error: "missing" });
  const now = Date.now();
  const info = db.prepare("INSERT INTO stories (user_id, ciphertext, iv, type, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)").run(req.user.id, ciphertext, iv, type || "text", now, now + 24 * 3600 * 1000);
  res.json({ id: info.lastInsertRowid });
});

app.get("/api/stories", authRequired, (req, res) => {
  const rows = db.prepare(`SELECT s.id, s.user_id AS userId, u.username AS username, s.ciphertext, s.iv, s.type, s.created_at AS createdAt, s.expires_at AS expiresAt FROM stories s JOIN users u ON u.id = s.user_id WHERE s.expires_at > ? ORDER BY s.created_at DESC`).all(Date.now());
  res.json({ stories: rows });
});

app.post("/api/stories/:id/view", authRequired, (req, res) => {
  try { db.prepare("INSERT INTO story_views (story_id, viewer_id, viewed_at) VALUES (?, ?, ?)").run(req.params.id, req.user.id, Date.now()); } catch {}
  res.json({ ok: true });
});

// ===== Media upload =====
// Raw octet-stream upload (preferred for E2EE)
app.post("/api/attachments", authRequired, express.raw({ type: "application/octet-stream", limit: 30 * 1024 * 1024 }), (req, res) => {
  const convId = Number(req.query.conversationId);
  if (!Number.isInteger(convId)) return res.status(400).json({ error: "bad convId" });
  const member = db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(convId, req.user.id);
  if (!member) return res.status(403).json({ error: "forbidden" });
  if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: "empty body" });

  const crypto = require("crypto");
  const id = crypto.randomBytes(16).toString("hex");
  const filePath = path.join(UPLOAD_DIR, id + ".bin");
  fs.writeFileSync(filePath, req.body);
  db.prepare("INSERT INTO attachments (id, conversation_id, uploader_id, size_bytes, created_at) VALUES (?, ?, ?, ?, ?)").run(id, convId, req.user.id, req.body.length, Date.now());
  res.json({ id, size: req.body.length });
});

app.get("/api/attachments/:id", authRequired, (req, res) => {
  const row = db.prepare("SELECT conversation_id, size_bytes FROM attachments WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  const member = db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(row.conversation_id, req.user.id);
  if (!member) return res.status(403).json({ error: "forbidden" });
  const filePath = path.join(UPLOAD_DIR, req.params.id + ".bin");
  if (!fs.existsSync(filePath)) return res.status(410).json({ error: "gone" });
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Length", row.size_bytes);
  res.setHeader("Cache-Control", "private, max-age=86400");
  fs.createReadStream(filePath).pipe(res);
});

// ===== Push tokens =====
app.post("/api/push/register", authRequired, (req, res) => {
  const { token, platform } = req.body || {};
  if (typeof token !== "string" || token.length < 20) return res.status(400).json({ error: "invalid token" });
  if (!["android", "ios", "web"].includes(platform)) return res.status(400).json({ error: "invalid platform" });
  push.registerToken(req.user.id, token, platform);
  res.json({ ok: true });
});

app.post("/api/push/unregister", authRequired, (req, res) => {
  const { token } = req.body || {};
  if (typeof token === "string") push.unregisterToken(token);
  res.json({ ok: true });
});

// ===== Cleanup =====
setInterval(() => {
  db.prepare("DELETE FROM stories WHERE expires_at < ?").run(Date.now());
}, 60 * 1000);

app.use(security.errorHandler);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Rasan on http://localhost:${PORT}`));
