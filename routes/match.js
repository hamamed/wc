const express = require("express");
const router = express.Router();
const { one, many } = require("../config/db");
const { requireLogin } = require("../utils/middleware");
const { rankPredictions } = require("../utils/matchPreds");

const LOCK = 30 * 60 * 1000;

// Decide which score (if any) drives points: final when completed, live while
// in progress. Returns { scored, live, scoreA, scoreB }.
function scoreState(m, kickoffMs) {
  const completed = m.status === "completed";
  const started = Date.now() >= kickoffMs;
  const hasLive = m.liveScoreA != null && m.liveScoreB != null;
  const live = started && !completed && hasLive;
  if (completed) return { scored: true, live: false, scoreA: m.actualScoreA, scoreB: m.actualScoreB };
  if (live) return { scored: true, live: true, scoreA: m.liveScoreA, scoreB: m.liveScoreB };
  return { scored: false, live: false, scoreA: null, scoreB: null };
}

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

    const ss = scoreState(m, kickoffMs);
    const raw = await many(
      `SELECT u.username, u.avatar, p.predicted_score_a AS a, p.predicted_score_b AS b
       FROM predictions p JOIN users u ON u.id = p.user_id
       WHERE p.match_id = $1`,
      [req.params.id]
    );
    const preds = rankPredictions(raw, ss.scoreA, ss.scoreB, ss.scored);

    res.render("match-predictions", {
      match: {
        ...m,
        kickoffTime: new Date(m.kickoffTime),
        completed: m.status === "completed",
        started: Date.now() >= kickoffMs,
        live: ss.live,
        scored: ss.scored,
      },
      preds,
      podium: ss.scored ? preds.slice(0, 3) : [],
    });
  } catch (err) {
    next(err);
  }
});

// JSON variant for the dashboard modal.
router.get("/:id/predictions.json", requireLogin, async (req, res) => {
  try {
    const m = await one(
      `SELECT team_a, team_b, kickoff_time, status,
              actual_score_a AS "actualScoreA", actual_score_b AS "actualScoreB",
              live_score_a AS "liveScoreA", live_score_b AS "liveScoreB"
       FROM matches WHERE id = $1`,
      [req.params.id]
    );
    if (!m) return res.status(404).json({ error: "not_found" });

    const kickoffMs = new Date(m.kickoff_time).getTime();
    const locked = Date.now() >= kickoffMs - LOCK || m.status === "completed";
    if (!locked) return res.status(403).json({ error: "locked" });

    const ss = scoreState(m, kickoffMs);
    const raw = await many(
      `SELECT u.username, u.avatar, p.predicted_score_a AS a, p.predicted_score_b AS b
       FROM predictions p JOIN users u ON u.id = p.user_id
       WHERE p.match_id = $1`,
      [req.params.id]
    );
    const preds = rankPredictions(raw, ss.scoreA, ss.scoreB, ss.scored).map((p) => ({
      username: p.username, a: p.a, b: p.b, pts: p.pts, rank: p.rank,
      avatar: res.locals.avatarSrc(p.avatar),
    }));

    res.json({
      teamA: res.locals.tn(m.team_a),
      teamB: res.locals.tn(m.team_b),
      completed: m.status === "completed",
      live: ss.live,
      scored: ss.scored,
      scoreA: ss.scoreA,
      scoreB: ss.scoreB,
      preds,
      podium: ss.scored ? preds.slice(0, 3) : [],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
});

module.exports = router;

