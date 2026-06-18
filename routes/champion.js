const express = require("express");
const router = express.Router();
const { collections, Timestamp } = require("../config/firebase");
const { requireLogin } = require("../utils/middleware");
const { LOCK_MS } = require("../utils/champion");

// The picker lives on the profile page now.
router.get("/", requireLogin, (req, res) => res.redirect("/profile"));

router.post("/", requireLogin, async (req, res) => {
  const pick = (req.body.champion || "").trim();
  try {
    if (Date.now() >= LOCK_MS) {
      req.flash("error", "Champion predictions are locked.");
      return res.redirect("/profile");
    }
    if (!pick) {
      req.flash("error", "Please choose a team.");
      return res.redirect("/profile");
    }

    // Find the team's flag from the fixtures (either side).
    let flag = null;
    let s = await collections.matches.where("teamA", "==", pick).limit(1).get();
    if (!s.empty) flag = s.docs[0].data().flagA || null;
    else {
      s = await collections.matches.where("teamB", "==", pick).limit(1).get();
      if (!s.empty) flag = s.docs[0].data().flagB || null;
    }

    await collections.users.doc(req.session.user.id).update({
      championPick: pick,
      championFlag: flag,
      championPickedAt: Timestamp.now(),
    });

    req.flash("success", `Champion pick saved: ${pick}! 🏆`);
    res.redirect("/profile");
  } catch (err) {
    console.error(err);
    req.flash("error", "Could not save your pick. Try again.");
    res.redirect("/profile");
  }
});

module.exports = router;
