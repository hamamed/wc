/**
 * Delete every match in a given round (matched by the `grp` label the importer
 * stored), along with its predictions, then rebuild all user totals so any
 * points those matches awarded are reversed.
 *
 *   node deleteRound.js "Group Stage - 1"        # exact grp match
 *   node deleteRound.js "%- 1" --like            # pattern match (ILIKE)
 *
 * Run the listing query first to see the exact labels:
 *   SELECT grp, count(*) FROM matches GROUP BY grp ORDER BY min(kickoff_time);
 */
require("dotenv").config();
const { pool } = require("./config/db");

const label = process.argv[2];
const like = process.argv.includes("--like");
if (!label) {
  console.error('Usage: node deleteRound.js "<grp label>" [--like]');
  process.exit(1);
}

(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const where = like ? "grp ILIKE $1" : "grp = $1";
    const { rows: matches } = await client.query(
      `SELECT id, team_a, team_b, grp FROM matches WHERE ${where} ORDER BY kickoff_time`,
      [label]
    );
    if (!matches.length) {
      console.log(`No matches found for grp ${like ? "ILIKE" : "="} "${label}". Nothing deleted.`);
      await client.query("ROLLBACK");
      return;
    }
    const ids = matches.map((m) => m.id);
    const { rowCount: predCount } = await client.query("DELETE FROM predictions WHERE match_id = ANY($1)", [ids]);
    await client.query("DELETE FROM matches WHERE id = ANY($1)", [ids]);

    // Rebuild every user's total from their remaining predictions + champion bonus.
    await client.query(
      `UPDATE users SET total_points =
         COALESCE((SELECT SUM(points_earned) FROM predictions WHERE user_id = users.id), 0)
         + COALESCE(champion_bonus, 0)`
    );

    await client.query("COMMIT");
    console.log(`Deleted ${matches.length} match(es) and ${predCount} prediction(s). Totals rebuilt:`);
    matches.forEach((m) => console.log(`  - ${m.team_a} vs ${m.team_b}  [${m.grp}]`));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Delete failed:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
