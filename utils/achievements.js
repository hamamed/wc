/**
 * Derive achievement badges from a user's stats + a chronological points list.
 *   stats        { made, exact, totalPoints, ... }
 *   pointsChron  points per completed prediction, oldest→newest (null = pending)
 *   championCorrect  whether the user's champion pick is already correct
 * Returns [{ key, icon, earned }]. Labels come from i18n (ach.<key>).
 */
function computeAchievements(stats, pointsChron, championCorrect) {
  let streak = 0, best = 0;
  (pointsChron || []).forEach((p) => {
    if (p == null) return;
    if (p > 0) { streak++; if (streak > best) best = streak; }
    else streak = 0;
  });
  const made = stats.made || 0, exact = stats.exact || 0, total = stats.totalPoints || 0;
  return [
    { key: "firstPick", icon: "fa-flag-checkered", earned: made >= 1 },
    { key: "sharp", icon: "fa-bullseye", earned: exact >= 1 },
    { key: "hattrick", icon: "fa-star", earned: exact >= 3 },
    { key: "streak3", icon: "fa-fire", earned: best >= 3 },
    { key: "century", icon: "fa-medal", earned: total >= 100 },
    { key: "veteran", icon: "fa-shield-halved", earned: made >= 20 },
    { key: "oracle", icon: "fa-crown", earned: !!championCorrect },
  ];
}

module.exports = { computeAchievements };
