/**
 * Champion bonus: when the admin sets the actual winner, every user who picked
 * that team gets a one-time bonus. Idempotent via the champion_bonus column.
 */
const { pool, one } = require("../config/db");

const BONUS = parseInt(process.env.CHAMPION_BONUS || "10", 10);

async function getActualChampion() {
  const row = await one("SELECT value FROM settings WHERE key = 'actualChampion'");
  return row && row.value ? row.value : null;
}

async function applyChampion(team) {
  const actual = (team || "").trim() || null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Snapshot ranks before the bonus changes points (for leaderboard movement).
    await client.query(
      `UPDATE users u SET last_rank = r.rk
       FROM (SELECT id, RANK() OVER (ORDER BY total_points DESC) AS rk FROM users) r
       WHERE u.id = r.id`
    );

    await client.query(
      `INSERT INTO settings (key, value) VALUES ('actualChampion', to_jsonb($1::text))
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [actual]
    );

    const { rows: users } = await client.query(
      "SELECT id, champion_pick, champion_bonus FROM users"
    );

    let winners = 0;
    for (const u of users) {
      const newBonus = actual && u.champion_pick === actual ? BONUS : 0;
      const delta = newBonus - (u.champion_bonus || 0);
      if (newBonus > 0) winners++;
      if (delta !== 0) {
        await client.query(
          "UPDATE users SET champion_bonus = $1, total_points = total_points + $2 WHERE id = $3",
          [newBonus, delta, u.id]
        );
      }
    }

    await client.query("COMMIT");
    return { winners, bonus: BONUS };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { applyChampion, getActualChampion, BONUS };
