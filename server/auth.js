const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { db } = require("./db");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-change-me";
const JWT_EXPIRES = "30d";

const RATE = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const r = RATE.get(ip) || { c: 0, reset: now + 15 * 60 * 1000 };
  if (now > r.reset) { r.c = 0; r.reset = now + 15 * 60 * 1000; }
  r.c++; RATE.set(ip, r);
  return r.c <= 20;
}

function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}
function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}
function authRequired(req, res, next) {
  const h = req.headers.authorization || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!t) return res.status(401).json({ error: "unauthorized" });
  const p = verifyToken(t);
  if (!p) return res.status(401).json({ error: "unauthorized" });
  const user = db.prepare("SELECT id, username, email, locale, public_key, created_at FROM users WHERE id = ?").get(p.sub);
  if (!user) return res.status(401).json({ error: "unauthorized" });
  req.user = user;
  next();
}

router.post("/register", async (req, res) => {
  if (!rateLimit(req.ip)) return res.status(429).json({ error: "too many attempts" });
  const { username, password, publicKey, locale } = req.body || {};
  if (typeof username !== "string" || typeof password !== "string") return res.status(400).json({ error: "invalid payload" });
  const u = username.trim();
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(u)) return res.status(400).json({ error: "bad username" });
  if (password.length < 6 || password.length > 72) return res.status(400).json({ error: "bad password" });
  if (!publicKey) return res.status(400).json({ error: "public key required" });
  const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(u);
  if (exists) return res.status(409).json({ error: "username taken" });
  const hash = await bcrypt.hash(password, 10);
  const info = db.prepare("INSERT INTO users (username, password_hash, public_key, locale, created_at) VALUES (?, ?, ?, ?, ?)").run(u, hash, publicKey, locale || "ar", Date.now());
  const user = db.prepare("SELECT id, username, locale, public_key, created_at FROM users WHERE id = ?").get(info.lastInsertRowid);
  res.json({ token: signToken(user), user });
});

router.post("/login", async (req, res) => {
  if (!rateLimit(req.ip)) return res.status(429).json({ error: "too many attempts" });
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "invalid payload" });
  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username.trim());
  if (!row) return res.status(401).json({ error: "wrong credentials" });
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return res.status(401).json({ error: "wrong credentials" });
  const user = { id: row.id, username: row.username, locale: row.locale, public_key: row.public_key, created_at: row.created_at };
  res.json({ token: signToken(user), user });
});

router.get("/me", authRequired, (req, res) => res.json({ user: req.user }));

router.get("/users/:username", authRequired, (req, res) => {
  const u = db.prepare("SELECT id, username, public_key FROM users WHERE username = ?").get(req.params.username);
  if (!u) return res.status(404).json({ error: "not found" });
  res.json({ user: u });
});

module.exports = { router, verifyToken, JWT_SECRET, authRequired };
