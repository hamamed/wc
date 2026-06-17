/**
 * Scoring rules for a single prediction against an actual result.
 *
 *   Exact score          -> 2 points
 *   Correct outcome only  -> 1 point   (right winner / draw, wrong scoreline)
 *   Wrong outcome         -> 0 points
 */

// Returns -1 (team B wins), 0 (draw), 1 (team A wins).
function outcome(a, b) {
  if (a > b) return 1;
  if (a < b) return -1;
  return 0;
}

function computePoints(predA, predB, actualA, actualB) {
  predA = Number(predA);
  predB = Number(predB);
  actualA = Number(actualA);
  actualB = Number(actualB);

  if (predA === actualA && predB === actualB) return 2;
  if (outcome(predA, predB) === outcome(actualA, actualB)) return 1;
  return 0;
}

module.exports = { computePoints, outcome };
