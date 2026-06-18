const express = require("express");
const router = express.Router();
const { collections, Timestamp } = require("../config/firebase");
const { requireLogin } = require("../utils/middleware");

// Champion predictions lock at end of 25 June 2026 (GMT+1). Override via env.
const LOCK_MS = Date.parse(
  process.env.CHAMPION_LOCK || "2026-06-25T23:59:59+01:00"
);

// Build the list of participating teams (distinct) from the fixtures.
async function getTeams() {
  const snap = await collections.matches.get();
  const map = {};
  snap.forEach((d) => {
    const m = d.data();
    if (m.teamA) map[m.teamA] = map[m.teamA] || m.flagA || null;
    if (m.teamB) map[m.teamB] = map[m.teamB] || m.flagB || null;
  });
  return Object.keys(map)
    .sort()
    .map((name) => ({ name, flag: map[name] }));
}

router.get("/", requireLogin, async (req, res, next) => {
  try {
    const [userDoc, teams] = await Promise.all([
      collections.users.doc(req.session.user.id).get(),
      getTeams(),
    ]);
    const u = userDoc.exists ? userDoc.data() : {};
    res.render("champion", {
      teams,
      pick: u.championPick || null,
      pickFlag: u.championFlag || null,
      lockMs: LOCK_MS,
      locked: Date.now() >= LOCK_MS,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/", requireLogin, async (req, res) => {
  const pick = (req.body.champion || "").trim();
  try {
    if (Date.now() >= LOCK_MS) {
      req.flash("error", "Champion predictions are locked.");
      return res.redirect("/champion");
    }
    if (!pick) {
      req.flash("error", "Please pick a team.");
      return res.redirect("/champion");
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

    req.flash("success", `Your champion pick is locked in: ${pick}! 🏆`);
    res.redirect("/champion");
  } catch (err) {
    console.error(err);
    req.flash("error", "Could not save your pick. Try again.");
    res.redirect("/champion");
  }
});

module.exports = router;
