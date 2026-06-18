const express = require("express");
const router = express.Router();
const { collections } = require("../config/firebase");
const { requireLogin } = require("../utils/middleware");
const { listAvatars, pickRandom } = require("../utils/avatars");
const { LOCK_MS, teamsFromMatches } = require("../utils/champion");
const { getActualChampion } = require("../utils/championScore");

// ---- My profile: points summary + prediction history ---------------------
router.get("/", requireLogin, async (req, res, next) => {
  try {
    const userId = req.session.user.id;

    const [userDoc, predSnap, matchSnap] = await Promise.all([
      collections.users.doc(userId).get(),
      collections.predictions.where("userId", "==", userId).get(),
      collections.matches.get(),
    ]);

    // Map matches by id for joining onto predictions.
    const matchById = {};
    matchSnap.forEach((d) => (matchById[d.id] = d.data()));

    // Build the history rows + tally stats.
    const stats = {
      totalPoints: userDoc.exists ? userDoc.data().totalPoints || 0 : 0,
      made: 0, // predictions submitted
      scored: 0, // predictions on completed matches
      pending: 0, // predictions on matches not yet completed
      exact: 0, // 2 pts
      outcome: 0, // 1 pt
      missed: 0, // 0 pts
    };

    const history = [];
    predSnap.forEach((d) => {
      const p = d.data();
      const m = matchById[p.matchId];
      if (!m) return; // match was deleted — skip orphan prediction

      stats.made++;
      const completed = m.status === "completed";

      if (completed) {
        stats.scored++;
        if (p.pointsEarned === 2) stats.exact++;
        else if (p.pointsEarned === 1) stats.outcome++;
        else stats.missed++;
      } else {
        stats.pending++;
      }

      history.push({
        teamA: m.teamA,
        teamB: m.teamB,
        kickoffTime: m.kickoffTime.toDate(),
        kickoffMs: m.kickoffTime.toMillis(),
        status: m.status,
        predictedScoreA: p.predictedScoreA,
        predictedScoreB: p.predictedScoreB,
        actualScoreA: m.actualScoreA,
        actualScoreB: m.actualScoreB,
        pointsEarned: completed ? p.pointsEarned : null,
      });
    });

    // Most recent first.
    history.sort((a, b) => b.kickoffMs - a.kickoffMs);

    // Hit rate = exact + outcome out of scored matches.
    stats.hitRate =
      stats.scored > 0
        ? Math.round(((stats.exact + stats.outcome) / stats.scored) * 100)
        : 0;

    const udata = userDoc.exists ? userDoc.data() : {};
    const actualChampion = await getActualChampion();
    res.render("profile", {
      stats,
      history,
      avatar: udata.avatar || null,
      hasAvatars: listAvatars().length > 0,
      // Champion prediction (picker shown as a banner on this page)
      teams: teamsFromMatches(Object.values(matchById)),
      championPick: udata.championPick || null,
      championFlag: udata.championFlag || null,
      championLockMs: LOCK_MS,
      championLocked: Date.now() >= LOCK_MS,
      actualChampion,
    });
  } catch (err) {
    next(err);
  }
});

// ---- Shuffle to a random avatar from public/avatars/ ---------------------
router.post("/avatar", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const doc = await collections.users.doc(userId).get();
    const current = doc.exists ? doc.data().avatar : null;

    const next = pickRandom(current);
    if (!next) {
      req.flash("error", "No avatars available — add images to public/avatars/.");
      return res.redirect("/profile");
    }

    await collections.users.doc(userId).update({ avatar: next });
    req.session.user.avatar = next; // keep session in sync
    req.flash("success", "Profile photo updated!");
    res.redirect("/profile");
  } catch (err) {
    console.error(err);
    req.flash("error", "Could not change your photo.");
    res.redirect("/profile");
  }
});

module.exports = router;
