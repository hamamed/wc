/**
 * Knockout bracket. If the data already has knockout fixtures (from the API or
 * added manually), they're grouped into rounds. Otherwise a provisional
 * Round of 16 is derived from the group standings using the classic FIFA
 * crossing (1A–2B, 1C–2D, … then 1B–2A, …) so it's clear who'd face whom.
 */
const { many } = require("../config/db");
const { computeStandings } = require("./standings");

const KO_ROUNDS = [
  { re: /round\s*of\s*32|1\/16|last\s*32/i, name: "Round of 32", order: 1 },
  { re: /round\s*of\s*16|1\/8|last\s*16/i, name: "Round of 16", order: 2 },
  { re: /quarter/i, name: "Quarter-finals", order: 3 },
  { re: /semi/i, name: "Semi-finals", order: 4 },
  { re: /third|3rd/i, name: "Third place", order: 5 },
  { re: /final/i, name: "Final", order: 6 },
];

function roundFor(grp) {
  if (!grp || /group/i.test(grp)) return null;
  for (const r of KO_ROUNDS) if (r.re.test(grp)) return r;
  return null;
}

// Classic 8-group Round of 16 crossing.
const R16 = [
  ["1A", "2B"], ["1C", "2D"], ["1E", "2F"], ["1G", "2H"],
  ["1B", "2A"], ["1D", "2C"], ["1F", "2E"], ["1H", "2G"],
];

function fmtMatch(m, L) {
  const completed = m.status === "completed";
  return {
    teamA: L(m.teamA), flagA: m.flagA || null,
    teamB: L(m.teamB), flagB: m.flagB || null,
    scoreA: completed ? m.actualScoreA : (m.liveScoreA != null ? m.liveScoreA : null),
    scoreB: completed ? m.actualScoreB : (m.liveScoreB != null ? m.liveScoreB : null),
    completed,
    kickoff: m.kickoff ? new Date(m.kickoff).getTime() : 0,
  };
}

async function getBracket(L) {
  L = L || ((x) => x);
  const matches = await many(
    `SELECT id, team_a AS "teamA", team_b AS "teamB", flag_a AS "flagA", flag_b AS "flagB",
            actual_score_a AS "actualScoreA", actual_score_b AS "actualScoreB",
            live_score_a AS "liveScoreA", live_score_b AS "liveScoreB",
            status, grp AS "group", kickoff_time AS "kickoff"
     FROM matches`
  );

  // Real knockout fixtures?
  const ko = matches.filter((m) => roundFor(m.group));
  if (ko.length) {
    const byRound = {};
    ko.forEach((m) => {
      const r = roundFor(m.group);
      (byRound[r.name] = byRound[r.name] || { order: r.order, matches: [] }).matches.push(m);
    });
    const rounds = Object.keys(byRound).map((name) => ({
      name, order: byRound[name].order,
      matches: byRound[name].matches.sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff)).map((m) => fmtMatch(m, L)),
    }));
    rounds.sort((a, b) => a.order - b.order);
    return { hasReal: true, rounds };
  }

  // Provisional: derive Round of 16 from current standings.
  const groups = computeStandings(matches);
  const byLetter = {};
  groups.forEach((g) => {
    const mm = (g.name || "").match(/([A-Z])\s*$/);
    if (mm) byLetter[mm[1].toUpperCase()] = g;
  });
  const resolve = (label) => {
    const seed = parseInt(label[0], 10);
    const letter = label.slice(1).toUpperCase();
    const g = byLetter[letter];
    const row = g && g.rows.find((r) => r.rank === seed);
    return row ? { name: L(row.team), flag: row.flag || null } : { name: null, flag: null };
  };
  const r16 = R16.map(([a, b]) => {
    const A = resolve(a), B = resolve(b);
    return { labelA: a, teamA: A.name, flagA: A.flag, labelB: b, teamB: B.name, flagB: B.flag, provisional: true };
  });
  return { hasReal: false, provisional: true, rounds: [{ name: "Round of 16", order: 2, matches: r16 }] };
}

module.exports = { getBracket };
