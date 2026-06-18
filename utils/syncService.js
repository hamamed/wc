/**
 * Automatic sync from the football API. Pulls fixtures, live scores, and final
 * results, and auto-scores predictions when a match finishes — no admin needed.
 *
 * startAutoSync() runs it once at boot, then on a timer (SYNC_INTERVAL_SECONDS).
 */
const { collections, Timestamp } = require("../config/firebase");
const { fetchWorldCupMatches } = require("./footballApi");
const { flagUrl } = require("./flags");
const { applyMatchResult } = require("./scoreMatch");

async function syncWorldCup() {
  const apiMatches = await fetchWorldCupMatches();

  // One read of existing matches; index by externalId to avoid per-match queries.
  const existingSnap = await collections.matches.get();
  const byExternal = {};
  existingSnap.forEach((doc) => {
    const ext = doc.data().externalId;
    if (ext) byExternal[ext] = doc;
  });

  let created = 0, updated = 0, scored = 0, live = 0;

  for (const m of apiMatches) {
    const flagA = m.flagA || flagUrl(m.teamA);
    const flagB = m.flagB || flagUrl(m.teamB);
    const existing = byExternal[m.externalId];

    if (!existing) {
      // New fixture.
      const ref = await collections.matches.add({
        externalId: m.externalId,
        teamA: m.teamA,
        teamB: m.teamB,
        flagA,
        flagB,
        kickoffTime: Timestamp.fromDate(m.kickoff),
        actualScoreA: null,
        actualScoreB: null,
        liveScoreA: null,
        liveScoreB: null,
        status: "scheduled",
      });
      created++;

      if (m.finished && m.scoreA != null && m.scoreB != null) {
        await applyMatchResult(ref.id, m.scoreA, m.scoreB);
        scored++;
      } else if (m.inPlay && m.scoreA != null) {
        await ref.update({ liveScoreA: m.scoreA, liveScoreB: m.scoreB });
        live++;
      }
      continue;
    }

    // Existing fixture — refresh info; never touch an already-completed match.
    const cur = existing.data();
    if (cur.status === "completed") continue;

    const update = {
      teamA: m.teamA,
      teamB: m.teamB,
      flagA,
      flagB,
      kickoffTime: Timestamp.fromDate(m.kickoff),
    };
    if (m.inPlay && m.scoreA != null) {
      update.liveScoreA = m.scoreA;
      update.liveScoreB = m.scoreB;
      live++;
    }
    await existing.ref.update(update);
    updated++;

    if (m.finished && m.scoreA != null && m.scoreB != null) {
      await applyMatchResult(existing.id, m.scoreA, m.scoreB);
      scored++;
    }
  }

  return { total: apiMatches.length, created, updated, live, scored };
}

function startAutoSync() {
  const hasKey = process.env.API_FOOTBALL_KEY || process.env.FOOTBALL_API_KEY;
  if (!hasKey) {
    console.log("⏸  Auto-sync disabled — no football API key set (API_FOOTBALL_KEY / FOOTBALL_API_KEY).");
    return;
  }

  // Mind your API quota: free plans allow limited requests/day.
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

  run(); // immediately at startup
  setInterval(run, secs * 1000);
  console.log(`✅ Auto-sync running every ${secs}s.`);
}

module.exports = { syncWorldCup, startAutoSync };
