/**
 * 4-digit account PIN. Stored as "salt:hash" (scrypt) — never plaintext.
 */
const crypto = require("crypto");

function validPin(pin) {
  return /^\d{4}$/.test(String(pin || ""));
}

function hashPin(pin) {
  const salt = crypto.randomBytes(12).toString("hex");
  const hash = crypto.scryptSync(String(pin), salt, 32).toString("hex");
  return salt + ":" + hash;
}

function verifyPin(pin, stored) {
  if (!stored || stored.indexOf(":") < 0) return false;
  const [salt, hash] = stored.split(":");
  const calc = crypto.scryptSync(String(pin), salt, 32).toString("hex");
  const a = Buffer.from(calc, "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { validPin, hashPin, verifyPin };
