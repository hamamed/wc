/**
 * Avatars are image files you drop into  public/avatars/  on the server.
 * They're served statically at  /avatars/<filename>.  The list is read at
 * runtime, so adding/removing images needs no code change or restart.
 */
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "public", "avatars");
const IMG = /\.(png|jpe?g|webp|gif|svg)$/i;

function listAvatars() {
  try {
    return fs.readdirSync(DIR).filter((f) => IMG.test(f));
  } catch {
    return [];
  }
}

// Pick a random avatar, avoiding the current one when possible.
function pickRandom(current) {
  const all = listAvatars();
  if (all.length === 0) return null;
  const pool = all.length > 1 && current ? all.filter((f) => f !== current) : all;
  return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = { listAvatars, pickRandom };
