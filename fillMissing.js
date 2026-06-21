/**
 * Backfill: for every match that has ALREADY kicked off, give a random
 * prediction (0-3 each side) to any user who didn't predict it. Completed
 * matches are scored immediately with the current rules; matches that have
 * started but aren't finalized get 0 (they'll be scored when the result is set).
 * Future / not-yet-played matches are never touched.
 *
 *   node fillMissing.js
 *
 * Safe to re-run (only fills gaps — ON CONFLICT DO NOTHING).
 */
require("dotenv").config();
const { pool } = require("./config/db");
const { computePoints } = require("./utils/scoring");

const rnd = () => Math.floor(Math.random() * 4); // 0..3

(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: matches } = await client.query(
      `SELECT id, status, actual_score_a, actual_score_b
       FROM matches WHERE kickoff_time <= now()`
    );
    const { rows: users } = await client.query("SELECT id FROM users");

    let created = 0;
    for (const m of matches) {
      const completed = m.status === "completed" && m.actual_score_a != null && m.actual_score_b != null;
      const { rows: have } = await client.query(
        "SELECT user_id FROM predictions WHERE match_id = $1",
        [m.id]
      );
      const haveSet = new Set(have.map((r) => String(r.user_id)));

      for (const u of users) {
        if (haveSet.has(String(u.id))) continue;
        const a = rnd(), b = rnd();
        const pts = completed ? computePoints(a, b, m.actual_score_a, m.actual_score_b) : 0;
        const r = await client.query(
          `INSERT INTO predictions (user_id, match_id, predicted_score_a, predicted_score_b, points_earned, updated_at)
           VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (user_id, match_id) DO NOTHING`,
          [u.id, m.id, a, b, pts]
        );
        created += r.rowCount;
      }
    }

    // Rebuild every user's total from their predictions + champion bonus.
    await client.query(
      `UPDATE users SET total_points =
         COALESCE((SELECT SUM(points_earned) FROM predictions WHERE user_id = users.id), 0)
         + COALESCE(champion_bonus, 0)`
    );

    await client.query("COMMIT");
    console.log(`Filled ${created} missing prediction(s) across ${matches.length} played match(es).`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Fill failed:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
