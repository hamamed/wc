const express = require("express");
const router = express.Router();
const { many } = require("../config/db");
const { requireLogin } = require("../utils/middleware");
const { fetchStandings } = require("../utils/footballApi");
const { computeStandings, bestThirds } = require("../utils/standings");
const { getBracket } = require("../utils/bracket");

router.get("/", requireLogin, async (req, res, next) => {
  try {
    let groups;
    let source;

    try {
      groups = await fetchStandings();
      source = "api";
    } catch (apiErr) {
      const matches = await many(
        `SELECT team_a AS "teamA", team_b AS "teamB", flag_a AS "flagA", flag_b AS "flagB",
                actual_score_a AS "actualScoreA", actual_score_b AS "actualScoreB",
                status, grp AS "group"
         FROM matches`
      );
      groups = computeStandings(matches);
      source = "local";
    }

    const thirds = bestThirds(groups);
    const bracket = await getBracket((n) => res.locals.tn(n));
    res.render("standings", { groups, thirds, source, bracket });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
