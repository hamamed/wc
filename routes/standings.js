const express = require("express");
const router = express.Router();
const { collections } = require("../config/firebase");
const { requireLogin } = require("../utils/middleware");
const { fetchStandings } = require("../utils/footballApi");
const { computeStandings, bestThirds } = require("../utils/standings");

router.get("/", requireLogin, async (req, res, next) => {
  try {
    let groups;
    let source;

    // Prefer the API's grouped standings; fall back to computing from results.
    try {
      groups = await fetchStandings();
      source = "api";
    } catch (apiErr) {
      const snap = await collections.matches.get();
      const matches = snap.docs.map((d) => {
        const m = d.data();
        return {
          teamA: m.teamA, teamB: m.teamB,
          flagA: m.flagA, flagB: m.flagB,
          actualScoreA: m.actualScoreA, actualScoreB: m.actualScoreB,
          status: m.status, group: m.group || null,
        };
      });
      groups = computeStandings(matches);
      source = "local";
    }

    const thirds = bestThirds(groups);
    res.render("standings", { groups, thirds, source });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
