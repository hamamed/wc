/**
 * Rank a match's predictions, attaching provisional points (against the live or
 * final score) and a tie-aware position. Ties share the same rank — two people
 * on the same points are both "1", the next is "3", and so on (standard
 * competition ranking).
 *
 *   raw      [{ username, avatar?, a, b }]
 *   scoreA/B the live score (in-progress) or final score, or null
 *   scored   whether points apply (match completed OR live with a score)
 */
const { computePoints } = require("./scoring");

function rankPredictions(raw, scoreA, scoreB, scored) {
  const hasScore = scored && scoreA != null && scoreB != null;
  const list = raw.map((p) => ({
    ...p,
    pts: hasScore ? computePoints(p.a, p.b, scoreA, scoreB) : null,
  }));

  list.sort((x, y) => {
    const px = x.pts == null ? -Infinity : x.pts;
    const py = y.pts == null ? -Infinity : y.pts;
    if (py !== px) return py - px;
    return String(x.username || "").localeCompare(String(y.username || ""));
  });

  if (hasScore) {
    let rank = 0, prev = null;
    list.forEach((p, i) => {
      if (p.pts !== prev) { rank = i + 1; prev = p.pts; }
      p.rank = rank;
    });
  } else {
    list.forEach((p) => { p.rank = null; });
  }
  return list;
}

module.exports = { rankPredictions };
