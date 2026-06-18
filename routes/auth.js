const express = require("express");
const router = express.Router();
const { one } = require("../config/db");

// ---- Login / Sign-up page ------------------------------------------------
router.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/dashboard");
  res.render("login");
});

// Passwordless: one username field does both sign-up and log-in.
router.post("/login", async (req, res) => {
  const raw = (req.body.username || "").trim();

  if (!/^[a-zA-Z0-9_-]{3,20}$/.test(raw)) {
    req.flash("error", "Username must be 3-20 characters (letters, numbers, _ or - only).");
    return res.redirect("/login");
  }

  const usernameLower = raw.toLowerCase();

  try {
    let user = await one(
      "SELECT id, username FROM users WHERE username_lower = $1",
      [usernameLower]
    );

    if (!user) {
      user = await one(
        "INSERT INTO users (username, username_lower) VALUES ($1, $2) RETURNING id, username",
        [raw, usernameLower]
      );
      req.flash("success", `Welcome aboard, ${user.username}! Your account is ready.`);
    } else {
      req.flash("success", `Welcome back, ${user.username}!`);
    }

    req.session.user = { id: String(user.id), username: user.username };
    res.redirect("/dashboard");
  } catch (err) {
    console.error(err);
    req.flash("error", "Could not log you in. Please try again.");
    res.redirect("/login");
  }
});

// ---- Logout --------------------------------------------------------------
router.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

module.exports = router;
