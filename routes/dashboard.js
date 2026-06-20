const express = require("express");
const router = express.Router();
const { one, many } = require("../config/db");
const { requireLogin } = require("../utils/middleware");

const LOCK_MS = 30 * 60 * 1000;
function isLocked(kickoffMs) {
  return Date.now() >= kickoffMs - LOCK_MS;
}

// ---- Dashboard: fixtures + the user's predictions ------------------------
router.get("/", requireLogin, async (req, res, next) => {
  try {
    const userId = req.session.user.id;

    const [rows, preds] = await Promise.all([
      many(
        `SELECT id, team_a AS "teamA", team_b AS "teamB", flag_a AS "flagA", flag_b AS "flagB",
                kickoff_time AS "kickoffTime", status,
                actual_score_a AS "actualScoreA", actual_score_b AS "actualScoreB",
                live_score_a AS "liveScoreA", live_score_b AS "liveScoreB"
         FROM matches ORDER BY kickoff_time ASC`
      ),
      many(
        `SELECT match_id, predicted_score_a AS a, predicted_score_b AS b, points_earned AS pts
         FROM predictions WHERE user_id = $1`,
        [userId]
      ),
    ]);

    const predByMatch = {};
    preds.forEach((p) => {
      predByMatch[p.match_id] = {
        predictedScoreA: p.a,
        predictedScoreB: p.b,
        pointsEarned: p.pts,
      };
    });

    const matches = rows.map((m) => {
      const kickoffMs = new Date(m.kickoffTime).getTime();
      const locked = isLocked(kickoffMs);
      const started = Date.now() >= kickoffMs;
      const pred = predByMatch[m.id] || null;

      let badge;
      if (m.status === "completed") {
        badge = { type: "completed", points: pred ? pred.pointsEarned : null };
      } else if (started) {
        badge = { type: "live" };
      } else if (locked) {
        badge = { type: "locked" };
      } else {
        badge = { type: "open" };
      }

      return {
        id: m.id,
        teamA: m.teamA,
        teamB: m.teamB,
        flagA: m.flagA || null,
        flagB: m.flagB || null,
        kickoffTime: new Date(m.kickoffTime),
        kickoffMs,
        status: m.status,
        actualScoreA: m.actualScoreA,
        actualScoreB: m.actualScoreB,
        liveScoreA: m.liveScoreA != null ? m.liveScoreA : null,
        liveScoreB: m.liveScoreB != null ? m.liveScoreB : null,
        locked,
        prediction: pred,
        badge,
      };
    });

    const [announcements, polls] = await Promise.all([
      many("SELECT id, message FROM announcements WHERE active ORDER BY created_at DESC"),
      many(
        `SELECT p.id, p.question,
                (SELECT COUNT(*) FROM poll_votes WHERE poll_id = p.id AND choice)::int AS yes,
                (SELECT COUNT(*) FROM poll_votes WHERE poll_id = p.id AND NOT choice)::int AS no,
                (SELECT choice FROM poll_votes WHERE poll_id = p.id AND user_id = $1) AS "myVote"
         FROM polls p WHERE p.active ORDER BY p.created_at DESC`,
        [userId]
      ),
    ]);

    res.render("dashboard", { matches, announcements, polls });
  } catch (err) {
    next(err);
  }
});

// ---- Vote on a poll ------------------------------------------------------
router.post("/vote/:pollId", requireLogin, async (req, res) => {
  try {
    const choice = req.body.choice === "yes";
    await query(
      `INSERT INTO poll_votes (poll_id, user_id, choice) VALUES ($1, $2, $3)
       ON CONFLICT (poll_id, user_id) DO UPDATE SET choice = EXCLUDED.choice`,
      [req.params.pollId, req.session.user.id, choice]
    );
    res.redirect("/dashboard");
  } catch (err) {
    console.error(err);
    res.redirect("/dashboard");
  }
});

// ---- Submit / edit a prediction -----------------------------------------
router.post("/predict/:matchId", requireLogin, async (req, res) => {
  const { matchId } = req.params;
  const userId = req.session.user.id;
  const scoreA = parseInt(req.body.scoreA, 10);
  const scoreB = parseInt(req.body.scoreB, 10);

  const wantsJson = req.xhr || (req.headers.accept || "").includes("application/json");
  const reply = (ok, message) => {
    if (wantsJson) return res.json({ ok, message });
    req.flash(ok ? "success" : "error", message);
    return res.redirect("/dashboard");
  };

  try {
    if (
      Number.isNaN(scoreA) || Number.isNaN(scoreB) ||
      scoreA < 0 || scoreB < 0 || scoreA > 99 || scoreB > 99
    ) {
      return reply(false, res.locals.t("dash.invalid"));
    }

    const match = await one(
      "SELECT status, kickoff_time FROM matches WHERE id = $1",
      [matchId]
    );
    if (!match) return reply(false, "That match no longer exists.");

    if (match.status === "completed" || isLocked(new Date(match.kickoff_time).getTime())) {
      return reply(false, res.locals.t("dash.lockedMsg"));
    }

    await one(
      `INSERT INTO predictions (user_id, match_id, predicted_score_a, predicted_score_b, points_earned, updated_at)
       VALUES ($1, $2, $3, $4, 0, now())
       ON CONFLICT (user_id, match_id)
       DO UPDATE SET predicted_score_a = EXCLUDED.predicted_score_a,
                     predicted_score_b = EXCLUDED.predicted_score_b,
                     updated_at = now()
       RETURNING id`,
      [userId, matchId, scoreA, scoreB]
    );

    return reply(true, res.locals.t("dash.saved"));
  } catch (err) {
    console.error(err);
    return reply(false, "Could not save your prediction. Try again.");
  }
});

module.exports = router;
