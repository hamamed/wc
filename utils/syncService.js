/**
 * Automatic sync from the football API into PostgreSQL: fixtures, live scores,
 * and final results (which auto-score predictions). No admin needed.
 */
const { query, one } = require("../config/db");
const { fetchWorldCupMatches } = require("./footballApi");
const { flagUrl } = require("./flags");
const { applyMatchResult } = require("./scoreMatch");

async function syncWorldCup() {
  const apiMatches = await fetchWorldCupMatches();
  let created = 0, updated = 0, scored = 0, live = 0;

  for (const m of apiMatches) {
    const flagA = m.flagA || flagUrl(m.teamA);
    const flagB = m.flagB || flagUrl(m.teamB);
    const kickoff = m.kickoff instanceof Date ? m.kickoff.toISOString() : m.kickoff;

    // Upsert by external_id. xmax = 0 means a fresh INSERT (vs an UPDATE).
    const row = await one(
      `INSERT INTO matches (external_id, team_a, team_b, flag_a, flag_b, kickoff_time, grp, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled')
       ON CONFLICT (external_id) DO UPDATE
         SET team_a = EXCLUDED.team_a, team_b = EXCLUDED.team_b,
             flag_a = EXCLUDED.flag_a, flag_b = EXCLUDED.flag_b,
             kickoff_time = EXCLUDED.kickoff_time,
             grp = COALESCE(EXCLUDED.grp, matches.grp)
       RETURNING id, status, (xmax = 0) AS inserted`,
      [m.externalId, m.teamA, m.teamB, flagA, flagB, kickoff, m.group || null]
    );

    if (row.inserted) created++; else updated++;

    if (m.finished && row.status !== "completed" && m.scoreA != null && m.scoreB != null) {
      await applyMatchResult(row.id, m.scoreA, m.scoreB);
      await query("UPDATE matches SET live_status = 'FT' WHERE id = $1", [row.id]);
      scored++;
    } else if (m.inPlay && row.status !== "completed") {
      await query(
        `UPDATE matches SET live_score_a = COALESCE($1, live_score_a),
                            live_score_b = COALESCE($2, live_score_b),
                            live_status = $3
         WHERE id = $4 AND status <> 'completed'`,
        [m.scoreA, m.scoreB, m.liveLabel || "LIVE", row.id]
      );
      live++;
    }
  }

  return { total: apiMatches.length, created, updated, live, scored };
}

function startAutoSync() {
  const hasKey = process.env.API_FOOTBALL_KEY || process.env.FOOTBALL_API_KEY;
  if (!hasKey) {
    console.log("⏸  Auto-sync disabled — no football API key set.");
    return;
  }
  const secs = Math.max(60, parseInt(process.env.SYNC_INTERVAL_SECONDS || "300", 10));

  const run = async () => {
    try {
      const r = await syncWorldCup();
      console.log(
        `🔄 [sync] ${new Date().toISOString()} — ${r.total} fixtures: +${r.created} new, ${r.updated} updated, ${r.live} live, ${r.scored} scored`
      );
    } catch (err) {
      console.error("⚠️  [sync] failed:", err.message);
    }
  };

  run();
  setInterval(run, secs * 1000);
  console.log(`✅ Auto-sync running every ${secs}s.`);
}

module.exports = { syncWorldCup, startAutoSync };
