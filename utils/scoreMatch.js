/**
 * Records a match result and (re)scores every prediction for it, adjusting each
 * user's total_points by the DELTA so re-running stays correct (idempotent).
 * Runs inside a transaction.
 */
const { pool } = require("../config/db");
const { computePoints } = require("./scoring");

async function applyMatchResult(matchId, actualA, actualB) {
  actualA = Number(actualA);
  actualB = Number(actualB);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Snapshot each user's current rank BEFORE points change, so the leaderboard
    // can show how they moved as a result of this match.
    await client.query(
      `UPDATE users u SET last_rank = r.rk
       FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY total_points DESC, username ASC) AS rk FROM users) r
       WHERE u.id = r.id`
    );

    await client.query(
      "UPDATE matches SET actual_score_a = $1, actual_score_b = $2, status = 'completed' WHERE id = $3",
      [actualA, actualB, matchId]
    );

    const { rows: preds } = await client.query(
      "SELECT id, user_id, predicted_score_a, predicted_score_b, points_earned FROM predictions WHERE match_id = $1",
      [matchId]
    );

    for (const p of preds) {
      const newPoints = computePoints(
        p.predicted_score_a, p.predicted_score_b, actualA, actualB
      );
      const delta = newPoints - (p.points_earned || 0);
      if (delta !== 0) {
        await client.query(
          "UPDATE predictions SET points_earned = $1, updated_at = now() WHERE id = $2",
          [newPoints, p.id]
        );
        await client.query(
          "UPDATE users SET total_points = total_points + $1 WHERE id = $2",
          [delta, p.user_id]
        );
      }
    }

    await client.query("COMMIT");
    return preds.length;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { applyMatchResult };
