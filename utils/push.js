/**
 * Push notifications via Firebase Cloud Messaging (legacy HTTP API).
 * Set FCM_SERVER_KEY in .env to enable; without it every call no-ops.
 */
const https = require("https");
const { one, many, query } = require("../config/db");

const SERVER_KEY = process.env.FCM_SERVER_KEY || "";

function sendRaw(payload) {
  return new Promise((resolve) => {
    if (!SERVER_KEY) return resolve(false);
    const body = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: "fcm.googleapis.com", path: "/fcm/send", method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "key=" + SERVER_KEY,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => { res.on("data", () => {}); res.on("end", () => resolve(res.statusCode < 300)); }
    );
    req.on("error", () => resolve(false));
    req.write(body);
    req.end();
  });
}

async function registerToken(userId, token, platform) {
  if (!token) return;
  await query(
    `INSERT INTO device_tokens (token, user_id, platform) VALUES ($1, $2, $3)
     ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform`,
    [token, userId, platform || null]
  );
}

async function sendToUser(userId, notification, data) {
  if (!SERVER_KEY) return;
  const rows = await many("SELECT token FROM device_tokens WHERE user_id = $1", [userId]);
  for (const r of rows) {
    await sendRaw({ to: r.token, notification, data: data || {}, priority: "high" });
  }
}

// Fire-and-forget: someone commented on a post — tell its owner.
async function notifyNewComment(postId, fromUserId) {
  try {
    if (!SERVER_KEY) return;
    const p = await one("SELECT user_id FROM posts WHERE id = $1", [postId]);
    if (!p || String(p.user_id) === String(fromUserId)) return;
    const u = await one("SELECT username FROM users WHERE id = $1", [fromUserId]);
    await sendToUser(p.user_id,
      { title: "New comment", body: (u ? u.username : "Someone") + " commented on your post" },
      { type: "comment", postId: String(postId) });
  } catch (_) { /* ignore */ }
}

module.exports = { registerToken, sendToUser, notifyNewComment };
