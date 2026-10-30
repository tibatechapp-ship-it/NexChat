let admin = null;
try { admin = require("firebase-admin"); } catch { admin = null; }
const path = require("path");
const fs = require("fs");
const { db } = require("./db");

let messaging = null;
let ready = false;

function init() {
  if (!admin) { console.warn("[push] disabled — firebase-admin not installed (expected in production: it is a declared dependency)"); return; }
  const envJson = process.env.FCM_SERVICE_ACCOUNT_JSON;
  const credPath = process.env.FCM_CREDENTIALS || path.join(__dirname, "firebase-service-account.json");
  if (!envJson && !fs.existsSync(credPath)) {
    console.warn("[push] disabled — no FCM credentials (set FCM_SERVICE_ACCOUNT_JSON with the service-account JSON, or FCM_CREDENTIALS with a file path)");
    return;
  }
  try {
    if (envJson) {
      // Render-friendly: the whole service-account JSON as a single env var.
      admin.initializeApp({ credential: admin.credential.cert(JSON.parse(envJson)) });
    } else {
      admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(credPath))) });
    }
    messaging = admin.messaging();
    ready = true;
    console.log("[push] ready");
  } catch (e) { console.error("[push] init failed:", e.message); }
}

db.exec(`CREATE TABLE IF NOT EXISTS device_tokens (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, platform TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_token_user ON device_tokens(user_id);`);

const upsertTokenStmt = db.prepare(`INSERT INTO device_tokens (token, user_id, platform, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id, updated_at=excluded.updated_at`);
const deleteTokenStmt = db.prepare("DELETE FROM device_tokens WHERE token = ?");
const userTokensStmt = db.prepare("SELECT token FROM device_tokens WHERE user_id = ?");

function registerToken(userId, token, platform) {
  const now = Date.now();
  upsertTokenStmt.run(token, userId, platform, now, now);
}
function unregisterToken(token) { deleteTokenStmt.run(token); }

async function sendToUser(userId, { title, body, data = {} }) {
  if (!ready) return;
  const tokens = userTokensStmt.all(userId).map((r) => r.token);
  if (!tokens.length) return;
  try {
    const res = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: { priority: "high", notification: { channelId: "messages", sound: "default" } },
      apns: { payload: { aps: { sound: "default", badge: 1 } } },
    });
    res.responses.forEach((r, i) => {
      if (r.error?.code === "messaging/registration-token-not-registered" || r.error?.code === "messaging/invalid-registration-token") {
        unregisterToken(tokens[i]);
      }
    });
  } catch (e) { console.error("[push] send failed:", e.message); }
}

module.exports = { init, registerToken, unregisterToken, sendToUser };
