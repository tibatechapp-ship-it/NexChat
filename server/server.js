const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { Server } = require("socket.io");
const { db } = require("./db");
const { router: authRouter, verifyToken, authRequired } = require("./auth");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const UPLOAD_DIR = path.join(__dirname, "..", "data", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, "..", "web")));
app.use("/api/auth", authRouter);

app.get("/health", (_q, res) => res.json({ ok: true, uptime: process.uptime() }));

// ===== Socket.IO auth =====
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("unauthorized"));
  const p = verifyToken(token);
  if (!p) return next(new Error("unauthorized"));
  const user = db.prepare("SELECT id, username, public_key FROM users WHERE id = ?").get(p.sub);
  if (!user) return next(new Error("unauthorized"));
  socket.user = user;
  next();
});

const presence = new Map();
function broadcastPresence(userId, online) {
  const convs = db.prepare("SELECT conversation_id FROM conversation_members WHERE user_id = ?").all(userId);
  for (const c of convs) io.to("conv:" + c.conversation_id).emit("presence", { userId, online });
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
    const { conversationId, ciphertext, iv, type, ephemeral_ttl } = payload || {};
    if (!conversationId || !ciphertext || !iv) return;
    const m = db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(conversationId, uid);
    if (!m) return;
    const time = Date.now();
    const info = db.prepare("INSERT INTO messages (conversation_id, sender_id, type, ciphertext, iv, ephemeral_ttl, time) VALUES (?, ?, ?, ?, ?, ?, ?)").run(conversationId, uid, type || "text", ciphertext, iv, ephemeral_ttl || 0, time);
    const msg = { id: info.lastInsertRowid, conversationId, senderId: uid, senderName: socket.user.username, type: type || "text", ciphertext, iv, time, ephemeral_ttl: ephemeral_ttl || 0 };
    io.to("conv:" + conversationId).emit("message", msg);
    if (ephemeral_ttl > 0) {
      setTimeout(() => {
        db.prepare("DELETE FROM messages WHERE id = ?").run(msg.id);
        io.to("conv:" + conversationId).emit("message:deleted", { id: msg.id });
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

  socket.on("disconnect", () => {
    presence.get(uid)?.delete(socket.id);
    if (presence.get(uid)?.size === 0) { presence.delete(uid); broadcastPresence(uid, false); }
  });
});

// ===== REST: conversations =====
app.get("/api/conversations", authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.type, c.name, c.description, c.owner_id, c.created_at,
           (SELECT COUNT(*) FROM conversation_members WHERE conversation_id = c.id) AS members
    FROM conversations c
    JOIN conversation_members m ON m.conversation_id = c.id
    WHERE m.user_id = ?
    ORDER BY c.created_at DESC
  `).all(req.user.id);
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
  const rows = db.prepare("SELECT u.id, u.username, u.public_key, cm.role, cm.joined_at FROM conversation_members cm JOIN users u ON u.id = cm.user_id WHERE cm.conversation_id = ?").all(req.params.id);
  res.json({ members: rows });
});

app.post("/api/conversations/:id/members", authRequired, (req, res) => {
  const { username } = req.body || {};
  const u = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (!u) return res.status(404).json({ error: "user not found" });
  try { db.prepare("INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").run(req.params.id, u.id, Date.now()); }
  catch { return res.status(409).json({ error: "already member" }); }
  res.json({ ok: true });
});

app.get("/api/conversations/:id/messages", authRequired, (req, res) => {
  const m = db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!m) return res.status(403).json({ error: "forbidden" });
  const rows = db.prepare(`
    SELECT m.id, m.conversation_id AS conversationId, m.sender_id AS senderId, u.username AS senderName,
           m.type, m.ciphertext, m.iv, m.ephemeral_ttl, m.time
    FROM messages m JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = ? ORDER BY m.time DESC LIMIT 100
  `).all(req.params.id).reverse();
  res.json({ messages: rows });
});

// ===== Group key =====
app.post("/api/conversations/:id/group-key", authRequired, (req, res) => {
  const { encrypted_key, iv } = req.body || {};
  if (!encrypted_key || !iv) return res.status(400).json({ error: "missing" });
  db.prepare("INSERT OR REPLACE INTO group_keys (conversation_id, user_id, encrypted_key, iv) VALUES (?, ?, ?, ?)").run(req.params.id, req.user.id, encrypted_key, iv);
  res.json({ ok: true });
});

app.get("/api/conversations/:id/group-key", authRequired, (req, res) => {
  const row = db.prepare("SELECT encrypted_key, iv FROM group_keys WHERE conversation_id = ? AND user_id = ?").get(req.params.id, req.user.id);
  res.json(row || { encrypted_key: null });
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
  const rows = db.prepare(`
    SELECT s.id, s.user_id AS userId, u.username AS username, s.ciphertext, s.iv, s.type, s.created_at AS createdAt, s.expires_at AS expiresAt
    FROM stories s JOIN users u ON u.id = s.user_id
    WHERE s.expires_at > ? ORDER BY s.created_at DESC
  `).all(Date.now());
  res.json({ stories: rows });
});

app.post("/api/stories/:id/view", authRequired, (req, res) => {
  try { db.prepare("INSERT INTO story_views (story_id, viewer_id, viewed_at) VALUES (?, ?, ?)").run(req.params.id, req.user.id, Date.now()); }
  catch { /* already viewed */ }
  res.json({ ok: true });
});

// ===== Media upload =====
app.post("/api/media", authRequired, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "no file" });
  const info = db.prepare("INSERT INTO media (uploader_id, filename, mime, size, path, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(req.user.id, req.file.originalname, req.file.mimetype, req.file.size, req.file.filename, Date.now());
  res.json({ id: info.lastInsertRowid, url: "/uploads/" + req.file.filename, mime: req.file.mimetype });
});

// ===== Cleanup expired ephemeral messages + stories =====
setInterval(() => {
  db.prepare("DELETE FROM stories WHERE expires_at < ?").run(Date.now());
}, 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Rasan on http://localhost:${PORT}`));
