const express = require("express");
const router = express.Router();
const { one, many, query } = require("../config/db");
const { requireLogin } = require("../utils/middleware");
const { listAvatars, pickRandom } = require("../utils/avatars");
const { LOCK_MS, teamsFromMatches } = require("../utils/champion");
const { getActualChampion } = require("../utils/championScore");

router.get("/", requireLogin, async (req, res, next) => {
  try {
    const userId = req.session.user.id;

    const [user, rows, allMatches, actualChampion] = await Promise.all([
      one(
        `SELECT total_points AS "totalPoints", avatar,
                champion_pick AS "championPick", champion_flag AS "championFlag"
         FROM users WHERE id = $1`,
        [userId]
      ),
      many(
        `SELECT p.predicted_score_a AS "predictedScoreA", p.predicted_score_b AS "predictedScoreB",
                p.points_earned AS "pointsEarned",
                m.team_a AS "teamA", m.team_b AS "teamB",
                m.kickoff_time AS "kickoffTime", m.status,
                m.actual_score_a AS "actualScoreA", m.actual_score_b AS "actualScoreB"
         FROM predictions p JOIN matches m ON m.id = p.match_id
         WHERE p.user_id = $1`,
        [userId]
      ),
      many(
        `SELECT team_a AS "teamA", team_b AS "teamB", flag_a AS "flagA", flag_b AS "flagB" FROM matches`
      ),
      getActualChampion(),
    ]);

    const u = user || {};
    const stats = {
      totalPoints: u.totalPoints || 0,
      made: 0, scored: 0, pending: 0, exact: 0, outcome: 0, missed: 0,
    };

    const history = rows.map((p) => {
      stats.made++;
      const completed = p.status === "completed";
      if (completed) {
        stats.scored++;
        if (p.pointsEarned === 2) stats.exact++;
        else if (p.pointsEarned === 1) stats.outcome++;
        else stats.missed++;
      } else {
        stats.pending++;
      }
      return {
        teamA: p.teamA, teamB: p.teamB,
        kickoffTime: new Date(p.kickoffTime),
        kickoffMs: new Date(p.kickoffTime).getTime(),
        status: p.status,
        predictedScoreA: p.predictedScoreA,
        predictedScoreB: p.predictedScoreB,
        actualScoreA: p.actualScoreA,
        actualScoreB: p.actualScoreB,
        pointsEarned: completed ? p.pointsEarned : null,
      };
    });
    history.sort((a, b) => b.kickoffMs - a.kickoffMs);

    stats.hitRate =
      stats.scored > 0
        ? Math.round(((stats.exact + stats.outcome) / stats.scored) * 100)
        : 0;

    res.render("profile", {
      stats,
      history,
      avatar: u.avatar || null,
      hasAvatars: listAvatars().length > 0,
      teams: teamsFromMatches(allMatches),
      championPick: u.championPick || null,
      championFlag: u.championFlag || null,
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
    const current = await one("SELECT avatar FROM users WHERE id = $1", [userId]);

    const next = pickRandom(current ? current.avatar : null);
    if (!next) {
      req.flash("error", "No avatars available — add images to public/avatars/.");
      return res.redirect("/profile");
    }

    await query("UPDATE users SET avatar = $1 WHERE id = $2", [next, userId]);
    req.session.user.avatar = next;
    req.flash("success", "Profile photo updated!");
    res.redirect("/profile");
  } catch (err) {
    console.error(err);
    req.flash("error", "Could not change your photo.");
    res.redirect("/profile");
  }
});

module.exports = router;
