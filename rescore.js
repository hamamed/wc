/**
 * One-off: re-score every prediction on completed matches with the current
 * scoring rules (4 / 2 / 1 / 0) and rebuild every user's total.
 *
 *   node rescore.js
 *
 * Safe to run multiple times (idempotent).
 */
require("dotenv").config();
const { pool } = require("./config/db");
const { computePoints } = require("./utils/scoring");

(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: matches } = await client.query(
      `SELECT id, actual_score_a, actual_score_b FROM matches
       WHERE status = 'completed' AND actual_score_a IS NOT NULL AND actual_score_b IS NOT NULL`
    );
    let updated = 0;
    for (const m of matches) {
      const { rows: preds } = await client.query(
        "SELECT id, predicted_score_a, predicted_score_b, points_earned FROM predictions WHERE match_id = $1",
        [m.id]
      );
      for (const p of preds) {
        const pts = computePoints(p.predicted_score_a, p.predicted_score_b, m.actual_score_a, m.actual_score_b);
        if (pts !== p.points_earned) {
          await client.query("UPDATE predictions SET points_earned = $1 WHERE id = $2", [pts, p.id]);
          updated++;
        }
      }
    }
    // Rebuild every user's total from their predictions + champion bonus.
    await client.query(
      `UPDATE users SET total_points =
         COALESCE((SELECT SUM(points_earned) FROM predictions WHERE user_id = users.id), 0)
         + COALESCE(champion_bonus, 0)`
    );
    await client.query("COMMIT");
    console.log(`Rescored ${matches.length} match(es), updated ${updated} prediction(s). Totals rebuilt.`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Rescore failed:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
