const express = require("express");
const router = express.Router();
const { one, many } = require("../config/db");
const { requireLogin } = require("../utils/middleware");

const LOCK = 30 * 60 * 1000;

// Everyone's predictions for a match — only visible once it's locked.
router.get("/:id/predictions", requireLogin, async (req, res, next) => {
  try {
    const m = await one(
      `SELECT id, team_a AS "teamA", team_b AS "teamB", flag_a AS "flagA", flag_b AS "flagB",
              kickoff_time AS "kickoffTime", status,
              actual_score_a AS "actualScoreA", actual_score_b AS "actualScoreB",
              live_score_a AS "liveScoreA", live_score_b AS "liveScoreB"
       FROM matches WHERE id = $1`,
      [req.params.id]
    );
    if (!m) {
      req.flash("error", "Match not found.");
      return res.redirect("/dashboard");
    }

    const kickoffMs = new Date(m.kickoffTime).getTime();
    const locked = Date.now() >= kickoffMs - LOCK || m.status === "completed";
    if (!locked) {
      req.flash("error", "Predictions become visible once the match locks (30 min before kickoff).");
      return res.redirect("/dashboard");
    }

    const preds = await many(
      `SELECT u.username, p.predicted_score_a AS a, p.predicted_score_b AS b, p.points_earned AS pts
       FROM predictions p JOIN users u ON u.id = p.user_id
       WHERE p.match_id = $1
       ORDER BY p.points_earned DESC NULLS LAST, u.username ASC`,
      [req.params.id]
    );

    res.render("match-predictions", {
      match: {
        ...m,
        kickoffTime: new Date(m.kickoffTime),
        completed: m.status === "completed",
        started: Date.now() >= kickoffMs,
      },
      preds,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
