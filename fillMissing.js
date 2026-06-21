/**
 * Backfill: for every match that has ALREADY kicked off, give a random
 * prediction (0-3 each side) to any user who didn't predict it. Completed
 * matches are scored immediately with the current rules; matches that have
 * started but aren't finalized get 0 (they'll be scored when the result is set).
 * Future / not-yet-played matches are never touched.
 *
 *   node fillMissing.js                          # all played matches
 *   node fillMissing.js --from 2026-06-19        # only matches kicking off on/after this date (round 2 start)
 *   node fillMissing.js --exclude "Group Stage - 1"   # skip a round by grp label
 *
 * Use --from to start from round 2: pass the date round 2 begins and earlier
 * (round 1) matches are left alone. The date is interpreted in the server's
 * timezone; you can also pass a full timestamp like "2026-06-19 17:00".
 *
 * Safe to re-run (only fills gaps — ON CONFLICT DO NOTHING).
 */
require("dotenv").config();
const { pool } = require("./config/db");
const { computePoints } = require("./utils/scoring");

const rnd = () => Math.floor(Math.random() * 4); // 0..3
const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const fromDate = arg("--from");
const exclude = arg("--exclude");

(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Only matches that have already kicked off; optionally start from a date
    // (round 2) and/or skip an excluded round by grp label.
    let where = "kickoff_time <= now()";
    const params = [];
    if (fromDate) {
      params.push(fromDate);
      where += ` AND kickoff_time >= $${params.length}`;
    }
    if (exclude) {
      params.push(exclude);
      where += ` AND (grp IS NULL OR grp NOT ILIKE $${params.length})`;
    }
    const { rows: matches } = await client.query(
      `SELECT id, status, actual_score_a, actual_score_b, grp FROM matches WHERE ${where}`,
      params
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
    const notes = [];
    if (fromDate) notes.push(`from ${fromDate}`);
    if (exclude) notes.push(`excluding grp ILIKE "${exclude}"`);
    console.log(
      `Filled ${created} missing prediction(s) across ${matches.length} played match(es)` +
        (notes.length ? ` (${notes.join(", ")}).` : ".")
    );
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Fill failed:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
