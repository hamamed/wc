/**
 * Provisional points each user is currently earning from in-progress (live)
 * matches, based on the live score. Returns a map { userId: livePoints }.
 * Used to show live-adjusted totals on the leaderboard.
 */
const { many } = require("../config/db");
const { computePoints } = require("./scoring");

async function getLiveBonus() {
  const liveMatches = await many(
    `SELECT id, live_score_a AS la, live_score_b AS lb
     FROM matches
     WHERE status <> 'completed'
       AND live_score_a IS NOT NULL AND live_score_b IS NOT NULL
       AND kickoff_time <= now()`
  );
  const map = {};
  if (!liveMatches.length) return map;

  const byId = {};
  liveMatches.forEach((m) => { byId[m.id] = m; });
  const preds = await many(
    `SELECT user_id AS "userId", match_id AS "matchId",
            predicted_score_a AS a, predicted_score_b AS b
     FROM predictions WHERE match_id = ANY($1)`,
    [liveMatches.map((m) => m.id)]
  );
  preds.forEach((p) => {
    const m = byId[p.matchId];
    if (!m) return;
    map[p.userId] = (map[p.userId] || 0) + computePoints(p.a, p.b, m.la, m.lb);
  });
  return map;
}

module.exports = { getLiveBonus };
