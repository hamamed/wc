/**
 * Live tally of who picked each team to win the World Cup.
 * Returns { total, rows: [{ team, flag, n }] } sorted most-picked first.
 */
const { many } = require("../config/db");

async function getChampionRace() {
  const rows = await many(
    `SELECT champion_pick AS team, champion_flag AS flag, COUNT(*)::int AS n
     FROM users WHERE champion_pick IS NOT NULL AND champion_pick <> ''
     GROUP BY champion_pick, champion_flag
     ORDER BY n DESC, champion_pick ASC`
  );
  const total = rows.reduce((s, r) => s + r.n, 0);
  return { total, rows };
}

module.exports = { getChampionRace };
