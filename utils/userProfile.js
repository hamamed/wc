/**
 * Build a user's public profile: totals, accuracy stats and prediction history.
 * Shared by the website leaderboard modal and the mobile app.
 *
 *   L(name) — optional team-name localizer (defaults to identity).
 *   Returns null if the user does not exist.
 */
const { one, many } = require("../config/db");
const { computeAchievements } = require("./achievements");

async function getUserProfile(userId, L = (n) => n) {
  const [user, rows] = await Promise.all([
    one(`SELECT username, avatar, total_points AS "totalPoints" FROM users WHERE id = $1`, [userId]),
    many(
      `SELECT p.predicted_score_a AS a, p.predicted_score_b AS b, p.points_earned AS pts,
              m.team_a AS "teamA", m.team_b AS "teamB", m.kickoff_time AS "kickoffTime",
              m.status, m.actual_score_a AS "actualA", m.actual_score_b AS "actualB"
       FROM predictions p JOIN matches m ON m.id = p.match_id
       WHERE p.user_id = $1`,
      [userId]
    ),
  ]);
  if (!user) return null;

  const now = Date.now();
  const stats = { totalPoints: user.totalPoints || 0, made: 0, scored: 0, pending: 0, exact: 0, difference: 0, outcome: 0, missed: 0 };
  const history = [];
  rows.forEach((p) => {
    stats.made++;
    const completed = p.status === "completed";
    if (completed) {
      stats.scored++;
      if (p.pts === 4) stats.exact++;
      else if (p.pts === 2) stats.difference++;
      else if (p.pts === 1) stats.outcome++;
      else stats.missed++;
    } else {
      stats.pending++;
    }
    // Only reveal predictions for matches that have already kicked off —
    // upcoming picks stay private until the match starts.
    const kickoff = new Date(p.kickoffTime).getTime();
    if (now < kickoff) return;
    history.push({
      teamA: L(p.teamA), teamB: L(p.teamB),
      kickoff,
      pred: p.a + "-" + p.b,
      result: completed ? p.actualA + "-" + p.actualB : null,
      points: completed ? p.pts : null,
    });
  });
  history.sort((x, y) => y.kickoff - x.kickoff);
  stats.hitRate = stats.scored > 0 ? Math.round(((stats.exact + stats.difference + stats.outcome) / stats.scored) * 100) : 0;

  const pointsChron = history.slice().reverse().map((h) => h.points);
  const achievements = computeAchievements(stats, pointsChron, false);
  return { username: user.username, avatar: user.avatar || null, stats, history, achievements };
}

module.exports = { getUserProfile };
