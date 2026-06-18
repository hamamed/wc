// Champion predictions lock at end of 25 June 2026 (GMT+1). Override via env.
const LOCK_MS = Date.parse(
  process.env.CHAMPION_LOCK || "2026-06-25T23:59:59+01:00"
);

// Build a sorted list of participating teams (with flags) from a matches array.
function teamsFromMatches(matchDatas) {
  const map = {};
  matchDatas.forEach((m) => {
    if (m.teamA) map[m.teamA] = map[m.teamA] || m.flagA || null;
    if (m.teamB) map[m.teamB] = map[m.teamB] || m.flagB || null;
  });
  return Object.keys(map)
    .sort()
    .map((name) => ({ name, flag: map[name] }));
}

module.exports = { LOCK_MS, teamsFromMatches };
