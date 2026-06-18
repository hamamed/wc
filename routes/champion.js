const express = require("express");
const router = express.Router();
const { one, query } = require("../config/db");
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
    const a = await one("SELECT flag_a FROM matches WHERE team_a = $1 LIMIT 1", [pick]);
    if (a) flag = a.flag_a || null;
    else {
      const b = await one("SELECT flag_b FROM matches WHERE team_b = $1 LIMIT 1", [pick]);
      if (b) flag = b.flag_b || null;
    }

    await query(
      "UPDATE users SET champion_pick = $1, champion_flag = $2, champion_picked_at = now() WHERE id = $3",
      [pick, flag, req.session.user.id]
    );

    req.flash("success", `Champion pick saved: ${pick}! 🏆`);
    res.redirect("/profile");
  } catch (err) {
    console.error(err);
    req.flash("error", "Could not save your pick. Try again.");
    res.redirect("/profile");
  }
});

module.exports = router;
