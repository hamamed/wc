/**
 * Scoring rules for a single prediction against an actual result.
 *
 *   Exact score                 -> 4 points
 *   Correct goal difference      -> 2 points  (e.g. predicted 2-0, ended 3-1)
 *   Correct outcome only         -> 1 point   (right winner / draw, wrong margin)
 *   Wrong outcome                -> 0 points
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

  // Exact scoreline.
  if (predA === actualA && predB === actualB) return 4;
  // Same outcome (winner or draw) is required for any further points.
  if (outcome(predA, predB) !== outcome(actualA, actualB)) return 0;
  // Right outcome AND same goal difference.
  if (predA - predB === actualA - actualB) return 2;
  // Right outcome only.
  return 1;
}

module.exports = { computePoints, outcome };
