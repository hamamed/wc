/**
 * Computes group standings from completed matches stored in Firestore — the
 * fallback used when the API standings endpoint isn't available (e.g. free plan).
 *
 * Returns the same shape as the API standings:
 *   [ { name, rows: [{ rank, team, flag, played, win, draw, lose, gf, ga, gd, points }] } ]
 */
function sortRows(a, b) {
  return (
    b.points - a.points ||
    b.gd - a.gd ||
    b.gf - a.gf ||
    a.team.localeCompare(b.team)
  );
}

function computeStandings(matches) {
  const groups = {}; // groupName -> { teamName -> stats }
  const flags = {};

  for (const m of matches) {
    if (m.status !== "completed") continue;
    const sa = m.actualScoreA;
    const sb = m.actualScoreB;
    if (sa == null || sb == null) continue;

    const g = m.group || "Standings";
    groups[g] = groups[g] || {};
    flags[m.teamA] = flags[m.teamA] || m.flagA || null;
    flags[m.teamB] = flags[m.teamB] || m.flagB || null;

    for (const t of [m.teamA, m.teamB]) {
      groups[g][t] = groups[g][t] || {
        team: t, played: 0, win: 0, draw: 0, lose: 0, gf: 0, ga: 0, points: 0,
      };
    }
    const A = groups[g][m.teamA];
    const B = groups[g][m.teamB];
    A.played++; B.played++;
    A.gf += sa; A.ga += sb; B.gf += sb; B.ga += sa;
    if (sa > sb) { A.win++; A.points += 3; B.lose++; }
    else if (sa < sb) { B.win++; B.points += 3; A.lose++; }
    else { A.draw++; B.draw++; A.points++; B.points++; }
  }

  return Object.keys(groups)
    .sort()
    .map((name) => {
      const rows = Object.values(groups[name]).map((s) => ({
        ...s,
        gd: s.gf - s.ga,
        flag: flags[s.team] || null,
      }));
      rows.sort(sortRows);
      rows.forEach((r, i) => (r.rank = i + 1));
      return { name, rows };
    });
}

/** From multiple groups, rank the 3rd-placed teams against each other. */
function bestThirds(groups) {
  if (!groups || groups.length < 2) return [];
  const thirds = groups
    .map((g) => g.rows.find((r) => r.rank === 3))
    .filter(Boolean)
    .map((r) => ({ ...r }));
  thirds.sort(sortRows);
  thirds.forEach((r, i) => (r.thirdRank = i + 1));
  return thirds;
}

module.exports = { computeStandings, bestThirds };
