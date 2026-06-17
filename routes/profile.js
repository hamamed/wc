const express = require("express");
const router = express.Router();
const { collections } = require("../config/firebase");
const { requireLogin } = require("../utils/middleware");

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

    res.render("profile", { stats, history });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
