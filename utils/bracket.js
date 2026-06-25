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

// Official 2026 World Cup Round of 32 (48 teams, groups A–L). Matches 73–88.
// W = group winner (seed 1), R = runner-up (seed 2), 3rd = a best third-placed
// team from one of the listed groups (decided by the FIFA table once known).
const R32 = [
  { a: { seed: 2, g: "A" }, b: { seed: 2, g: "B" } },                 // 73
  { a: { seed: 1, g: "E" }, b: { third: "A/B/C/D/F" } },             // 74
  { a: { seed: 1, g: "F" }, b: { seed: 2, g: "C" } },                 // 75
  { a: { seed: 1, g: "C" }, b: { seed: 2, g: "F" } },                 // 76
  { a: { seed: 1, g: "I" }, b: { third: "C/D/F/G/H" } },             // 77
  { a: { seed: 2, g: "E" }, b: { seed: 2, g: "I" } },                 // 78
  { a: { seed: 1, g: "A" }, b: { third: "C/E/F/H/I" } },             // 79
  { a: { seed: 1, g: "L" }, b: { third: "E/H/I/J/K" } },             // 80
  { a: { seed: 1, g: "D" }, b: { third: "B/E/F/I/J" } },             // 81
  { a: { seed: 1, g: "G" }, b: { third: "A/E/H/I/J" } },             // 82
  { a: { seed: 2, g: "K" }, b: { seed: 2, g: "L" } },                 // 83
  { a: { seed: 1, g: "H" }, b: { seed: 2, g: "J" } },                 // 84
  { a: { seed: 1, g: "B" }, b: { third: "E/F/G/I/J" } },             // 85
  { a: { seed: 1, g: "J" }, b: { seed: 2, g: "H" } },                 // 86
  { a: { seed: 1, g: "K" }, b: { third: "D/E/I/J/L" } },             // 87
  { a: { seed: 2, g: "D" }, b: { seed: 2, g: "G" } },                 // 88
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

// Turn ordered rounds into a left/right mirrored layout:
//   L-R32, L-R16, L-QF, L-SF, FINAL, R-SF, R-QF, R-R16, R-R32
function toColumns(rounds) {
  const left = [], right = [], extras = [];
  let center = null;
  rounds.forEach((rd) => {
    if (/^final$/i.test(rd.name) && rd.matches.length <= 1) { center = { title: rd.name, matches: rd.matches }; return; }
    if (rd.matches.length <= 1) { extras.push({ title: rd.name, matches: rd.matches }); return; }
    const half = Math.ceil(rd.matches.length / 2);
    left.push({ title: rd.name, matches: rd.matches.slice(0, half) });
    right.push({ title: rd.name, matches: rd.matches.slice(half) });
  });
  return [...left, ...(center ? [center] : []), ...right.reverse(), ...extras];
}

function finalize(hasReal, provisional, rounds) {
  return { hasReal, provisional, rounds, columns: toColumns(rounds) };
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
    return finalize(true, false, rounds);
  }

  // Provisional: derive the Round of 32 from current standings.
  const groups = computeStandings(matches);
  const byLetter = {};
  groups.forEach((g) => {
    const mm = (g.name || "").match(/([A-Z])\s*$/);
    if (mm) byLetter[mm[1].toUpperCase()] = g;
  });
  const resolveSlot = (s) => {
    if (s.third) return { name: null, flag: null, label: "3rd " + s.third };
    const label = s.seed + s.g; // "1E", "2A"
    const g = byLetter[s.g.toUpperCase()];
    const row = g && g.rows.find((r) => r.rank === s.seed);
    return { name: row ? L(row.team) : null, flag: row ? (row.flag || null) : null, label };
  };
  const r32 = R32.map((x) => {
    const A = resolveSlot(x.a), B = resolveSlot(x.b);
    return { teamA: A.name, flagA: A.flag, labelA: A.label, teamB: B.name, flagB: B.flag, labelB: B.label, provisional: true };
  });
  const empty = (name, order, count) => ({
    name, order, matches: Array.from({ length: count }, () => ({ labelA: "", labelB: "", provisional: true })),
  });
  return finalize(false, true, [
    { name: "Round of 32", order: 1, matches: r32 },
    empty("Round of 16", 2, 8),
    empty("Quarter-finals", 3, 4),
    empty("Semi-finals", 4, 2),
    empty("Final", 6, 1),
  ]);
}

module.exports = { getBracket };
