const express = require("express");
const router = express.Router();
const { collections, Timestamp } = require("../config/firebase");

// ---- Login / Sign-up page ------------------------------------------------
router.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/dashboard");
  res.render("login");
});

// Passwordless: one username field does both sign-up and log-in.
router.post("/login", async (req, res) => {
  const raw = (req.body.username || "").trim();

  // Basic validation: 3-20 chars, letters/numbers/_-.
  if (!/^[a-zA-Z0-9_-]{3,20}$/.test(raw)) {
    req.flash(
      "error",
      "Username must be 3-20 characters (letters, numbers, _ or - only)."
    );
    return res.redirect("/login");
  }

  // Usernames are case-insensitive for lookup but we keep the display form.
  const usernameLower = raw.toLowerCase();

  try {
    const snap = await collections.users
      .where("usernameLower", "==", usernameLower)
      .limit(1)
      .get();

    let userDoc;
    if (snap.empty) {
      // Create a new user.
      const ref = await collections.users.add({
        username: raw,
        usernameLower,
        totalPoints: 0,
        createdAt: Timestamp.now(),
      });
      userDoc = { id: ref.id, username: raw };
      req.flash("success", `Welcome aboard, ${raw}! Your account is ready.`);
    } else {
      const doc = snap.docs[0];
      userDoc = { id: doc.id, username: doc.data().username };
      req.flash("success", `Welcome back, ${userDoc.username}!`);
    }

    req.session.user = userDoc;
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
