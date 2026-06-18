/**
 * Seeds a handful of sample World Cup 2026 fixtures into PostgreSQL.
 * Run once with:  npm run seed
 */
require("dotenv").config();
const { query, pool } = require("./config/db");
const { flagUrl } = require("./utils/flags");

function hoursFromNow(h) {
  return new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
}

const fixtures = [
  { teamA: "USA", teamB: "Mexico", kickoff: hoursFromNow(6) },
  { teamA: "Canada", teamB: "Brazil", kickoff: hoursFromNow(30) },
  { teamA: "Argentina", teamB: "France", kickoff: hoursFromNow(54) },
  { teamA: "England", teamB: "Germany", kickoff: hoursFromNow(0.25) },
];

async function seed() {
  console.log("Seeding fixtures...");
  for (const f of fixtures) {
    await query(
      `INSERT INTO matches (team_a, team_b, flag_a, flag_b, kickoff_time, status)
       VALUES ($1, $2, $3, $4, $5, 'scheduled')`,
      [f.teamA, f.teamB, flagUrl(f.teamA), flagUrl(f.teamB), f.kickoff]
    );
    console.log(`  + ${f.teamA} vs ${f.teamB}`);
  }
  console.log("Done. ⚽");
  await pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
