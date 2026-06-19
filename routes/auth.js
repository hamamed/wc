const express = require("express");
const router = express.Router();
const { one, query } = require("../config/db");
const { validPin, hashPin, verifyPin } = require("../utils/pin");

// ---- Step 1: username -----------------------------------------------------
router.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/dashboard");
  res.render("login");
});

router.post("/login", async (req, res) => {
  const raw = (req.body.username || "").trim();
  if (!/^[a-zA-Z0-9_-]{3,20}$/.test(raw)) {
    req.flash("error", "Username must be 3-20 characters (letters, numbers, _ or - only).");
    return res.redirect("/login");
  }
  const lower = raw.toLowerCase();

  try {
    const user = await one("SELECT id, username, pin FROM users WHERE username_lower = $1", [lower]);

    if (!user) {
      req.session.pendingPin = { username: raw, mode: "create" };
    } else if (!user.pin) {
      req.session.pendingPin = { id: String(user.id), username: user.username, mode: "set" };
    } else {
      req.session.pendingPin = { id: String(user.id), username: user.username, mode: "enter" };
    }
    req.session.pinTries = 0;
    res.redirect("/login/pin");
  } catch (err) {
    console.error(err);
    req.flash("error", "Could not log you in. Please try again.");
    res.redirect("/login");
  }
});

// ---- Step 2: PIN ----------------------------------------------------------
router.get("/login/pin", (req, res) => {
  const p = req.session.pendingPin;
  if (!p) return res.redirect("/login");
  res.render("pin", { mode: p.mode, username: p.username });
});

router.post("/login/pin", async (req, res) => {
  const p = req.session.pendingPin;
  if (!p) return res.redirect("/login");
  const pin = (req.body.pin || "").trim();

  if (!validPin(pin)) {
    req.flash("error", res.locals.t("pin.invalid"));
    return res.redirect("/login/pin");
  }

  try {
    if (p.mode === "enter") {
      const user = await one("SELECT pin FROM users WHERE id = $1", [p.id]);
      if (!user || !verifyPin(pin, user.pin)) {
        req.session.pinTries = (req.session.pinTries || 0) + 1;
        if (req.session.pinTries >= 5) {
          delete req.session.pendingPin;
          req.flash("error", res.locals.t("pin.tooMany"));
          return res.redirect("/login");
        }
        req.flash("error", res.locals.t("pin.wrong"));
        return res.redirect("/login/pin");
      }
      req.session.user = { id: p.id, username: p.username };
    } else {
      const hashed = hashPin(pin);
      if (p.mode === "create") {
        const lower = p.username.toLowerCase();
        const existing = await one("SELECT id FROM users WHERE username_lower = $1", [lower]);
        let id;
        if (existing) {
          id = existing.id;
          await query("UPDATE users SET pin = $1 WHERE id = $2", [hashed, id]);
        } else {
          const r = await one(
            "INSERT INTO users (username, username_lower, pin) VALUES ($1, $2, $3) RETURNING id",
            [p.username, lower, hashed]
          );
          id = r.id;
        }
        req.session.user = { id: String(id), username: p.username };
      } else {
        await query("UPDATE users SET pin = $1 WHERE id = $2", [hashed, p.id]);
        req.session.user = { id: p.id, username: p.username };
      }
    }

    delete req.session.pendingPin;
    req.session.pinTries = 0;
    req.flash("success", `Welcome, ${req.session.user.username}!`);
    res.redirect("/dashboard");
  } catch (err) {
    console.error(err);
    req.flash("error", "Could not verify your code. Try again.");
    res.redirect("/login/pin");
  }
});

// ---- Logout ---------------------------------------------------------------
router.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

module.exports = router;
