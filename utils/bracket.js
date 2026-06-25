/**
 * Full 2026 World Cup knockout bracket (32 teams, matches 73–104).
 * Slots are filled from the group standings (group winners / runners-up) and,
 * as real knockout fixtures arrive from the football API, with the actual
 * teams + scores. Winners propagate up the bracket (Winner Match 74 → …).
 */
const { many } = require("../config/db");
const { computeStandings } = require("./standings");

const KO_ROUNDS = [
  { re: /round\s*of\s*32|1\/16|last\s*32/i, name: "Round of 32", order: 1 },
  { re: /round\s*of\s*16|1\/8|last\s*16/i, name: "Round of 16", order: 2 },
  { re: /quarter/i, name: "Quarter-finals", order: 3 },
  { re: /semi/i, name: "Semi-finals", order: 4 },
  { re: /third|3rd|play-?off/i, name: "Third place", order: 5 },
  { re: /final/i, name: "Final", order: 6 },
];
function roundFor(grp) {
  if (!grp || /group/i.test(grp)) return null;
  for (const r of KO_ROUNDS) if (r.re.test(grp)) return r;
  return null;
}
const ROUND_NAME = { 1: "Round of 32", 2: "Round of 16", 3: "Quarter-finals", 4: "Semi-finals", 5: "Third place", 6: "Final" };

// Each match in bracket display order (left side first, then right side),
// with the FIFA matchups (W=winner, R=runner-up, 3rd=best third, w#=winner of
// match #, l#=loser of match #).
const TEMPLATE = [
  // ---- Round of 32 (left side) ----
  { n: 74, o: 1, a: { s: 1, g: "E" }, b: { t: "A/B/C/D/F" } },
  { n: 77, o: 1, a: { s: 1, g: "I" }, b: { t: "C/D/F/G/H" } },
  { n: 73, o: 1, a: { s: 2, g: "A" }, b: { s: 2, g: "B" } },
  { n: 75, o: 1, a: { s: 1, g: "F" }, b: { s: 2, g: "C" } },
  { n: 83, o: 1, a: { s: 2, g: "K" }, b: { s: 2, g: "L" } },
  { n: 84, o: 1, a: { s: 1, g: "H" }, b: { s: 2, g: "J" } },
  { n: 81, o: 1, a: { s: 1, g: "D" }, b: { t: "B/E/F/I/J" } },
  { n: 82, o: 1, a: { s: 1, g: "G" }, b: { t: "A/E/H/I/J" } },
  // ---- Round of 32 (right side) ----
  { n: 76, o: 1, a: { s: 1, g: "C" }, b: { s: 2, g: "F" } },
  { n: 78, o: 1, a: { s: 2, g: "E" }, b: { s: 2, g: "I" } },
  { n: 79, o: 1, a: { s: 1, g: "A" }, b: { t: "C/E/F/H/I" } },
  { n: 80, o: 1, a: { s: 1, g: "L" }, b: { t: "E/H/I/J/K" } },
  { n: 86, o: 1, a: { s: 1, g: "J" }, b: { s: 2, g: "H" } },
  { n: 88, o: 1, a: { s: 2, g: "D" }, b: { s: 2, g: "G" } },
  { n: 85, o: 1, a: { s: 1, g: "B" }, b: { t: "E/F/G/I/J" } },
  { n: 87, o: 1, a: { s: 1, g: "K" }, b: { t: "D/E/I/J/L" } },
  // ---- Round of 16 ----
  { n: 89, o: 2, a: { w: 74 }, b: { w: 77 } },
  { n: 90, o: 2, a: { w: 73 }, b: { w: 75 } },
  { n: 93, o: 2, a: { w: 83 }, b: { w: 84 } },
  { n: 94, o: 2, a: { w: 81 }, b: { w: 82 } },
  { n: 91, o: 2, a: { w: 76 }, b: { w: 78 } },
  { n: 92, o: 2, a: { w: 79 }, b: { w: 80 } },
  { n: 95, o: 2, a: { w: 86 }, b: { w: 88 } },
  { n: 96, o: 2, a: { w: 85 }, b: { w: 87 } },
  // ---- Quarter-finals ----
  { n: 97, o: 3, a: { w: 89 }, b: { w: 90 } },
  { n: 98, o: 3, a: { w: 93 }, b: { w: 94 } },
  { n: 99, o: 3, a: { w: 91 }, b: { w: 92 } },
  { n: 100, o: 3, a: { w: 95 }, b: { w: 96 } },
  // ---- Semi-finals ----
  { n: 101, o: 4, a: { w: 97 }, b: { w: 98 } },
  { n: 102, o: 4, a: { w: 99 }, b: { w: 100 } },
  // ---- Final + third place ----
  { n: 104, o: 6, a: { w: 101 }, b: { w: 102 } },
  { n: 103, o: 5, a: { l: 101 }, b: { l: 102 } },
];

const norm = (s) => (s == null ? "" : String(s).trim().toLowerCase());

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

async function getBracket(L) {
  L = L || ((x) => x);
  const matches = await many(
    `SELECT team_a AS "teamA", team_b AS "teamB", flag_a AS "flagA", flag_b AS "flagB",
            actual_score_a AS "actualScoreA", actual_score_b AS "actualScoreB",
            live_score_a AS "liveScoreA", live_score_b AS "liveScoreB",
            status, grp AS "group", kickoff_time AS "kickoff"
     FROM matches`
  );

  // Real knockout fixtures, grouped by canonical round name (raw team names kept for matching).
  const realByRound = {};
  let realCount = 0;
  matches.forEach((m) => {
    const r = roundFor(m.group);
    if (!r) return;
    realCount++;
    const completed = m.status === "completed";
    (realByRound[r.name] = realByRound[r.name] || []).push({
      teamA: m.teamA, teamB: m.teamB, flagA: m.flagA, flagB: m.flagB,
      scoreA: completed ? m.actualScoreA : (m.liveScoreA != null ? m.liveScoreA : null),
      scoreB: completed ? m.actualScoreB : (m.liveScoreB != null ? m.liveScoreB : null),
      completed, used: false,
    });
  });

  // Group winners / runners-up from current standings.
  const groups = computeStandings(matches);
  const byLetter = {};
  groups.forEach((g) => {
    const mm = (g.name || "").match(/([A-Z])\s*$/);
    if (mm) byLetter[mm[1].toUpperCase()] = g;
  });

  const winners = {}, losers = {}; // matchNum -> { name, display, flag }
  const out = {}; // matchNum -> built match

  // Resolve a slot to { team:{name,display,flag}|null, label }.
  function resolveSlot(s) {
    if (s.t) return { team: null, label: "3rd " + s.t };
    if (s.w) return { team: winners[s.w] || null, label: "W" + s.w };
    if (s.l) return { team: losers[s.l] || null, label: "L" + s.l };
    // seed
    const label = (s.s === 1 ? "1" : "2") + s.g;
    const g = byLetter[s.g.toUpperCase()];
    const row = g && g.rows.find((r) => r.rank === s.s);
    return row ? { team: { name: row.team, display: L(row.team), flag: row.flag || null }, label } : { team: null, label };
  }

  // Process in numeric order so winners are known for later rounds.
  const order = TEMPLATE.slice().sort((a, b) => a.n - b.n);
  for (const tpl of order) {
    const A = resolveSlot(tpl.a), B = resolveSlot(tpl.b);
    let teamA = A.team, teamB = B.team, scoreA = null, scoreB = null, completed = false;

    // Overlay a real fixture for this slot (match by a known team name).
    const names = [teamA && teamA.name, teamB && teamB.name].filter(Boolean).map(norm);
    const list = realByRound[ROUND_NAME[tpl.o]] || [];
    if (names.length) {
      const real = list.find((r) => !r.used && (names.includes(norm(r.teamA)) || names.includes(norm(r.teamB))));
      if (real) {
        real.used = true;
        teamA = { name: real.teamA, display: L(real.teamA), flag: real.flagA };
        teamB = { name: real.teamB, display: L(real.teamB), flag: real.flagB };
        scoreA = real.scoreA; scoreB = real.scoreB; completed = real.completed;
      }
    }

    // Winner/loser propagation (only when a finished match has a decisive score).
    if (completed && scoreA != null && scoreB != null && scoreA !== scoreB) {
      const w = scoreA > scoreB ? teamA : teamB;
      const l = scoreA > scoreB ? teamB : teamA;
      if (w) winners[tpl.n] = w;
      if (l) losers[tpl.n] = l;
    }

    out[tpl.n] = {
      n: tpl.n,
      teamA: teamA ? teamA.display : null, flagA: teamA ? teamA.flag : null, labelA: A.label,
      teamB: teamB ? teamB.display : null, flagB: teamB ? teamB.flag : null, labelB: B.label,
      scoreA, scoreB, completed,
      winA: completed && scoreA != null && scoreA > scoreB,
      winB: completed && scoreB != null && scoreB > scoreA,
    };
  }

  // Group rounds in template (display) order.
  const rounds = [];
  const seen = {};
  TEMPLATE.forEach((tpl) => {
    const name = ROUND_NAME[tpl.o];
    let rd = seen[name];
    if (!rd) { rd = seen[name] = { name, order: tpl.o, matches: [] }; rounds.push(rd); }
    rd.matches.push(out[tpl.n]);
  });
  rounds.sort((a, b) => a.order - b.order);

  return { hasReal: realCount > 0, provisional: realCount === 0, rounds, columns: toColumns(rounds) };
}

module.exports = { getBracket };
