const express = require("express");
const router = express.Router();
const { admin, db, collections, Timestamp } = require("../config/firebase");
const { requireAdmin } = require("../utils/middleware");
const { applyMatchResult } = require("../utils/scoreMatch");
const { syncWorldCup } = require("../utils/syncService");
const { flagUrl } = require("../utils/flags");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

// Delete one match: reverse any points it awarded, remove its predictions,
// then remove the match. Returns the number of predictions removed.
async function deleteMatchAndPredictions(matchId) {
  const predSnap = await collections.predictions
    .where("matchId", "==", matchId)
    .get();

  const batch = db.batch();
  predSnap.forEach((doc) => {
    const p = doc.data();
    if (p.pointsEarned) {
      batch.update(collections.users.doc(p.userId), {
        totalPoints: admin.firestore.FieldValue.increment(-p.pointsEarned),
      });
    }
    batch.delete(doc.ref);
  });
  batch.delete(collections.matches.doc(matchId));
  await batch.commit();
  return predSnap.size;
}

// ---- Admin login (simple shared password) --------------------------------
router.get("/login", (req, res) => {
  if (req.session.isAdmin) return res.redirect("/admin");
  res.render("admin-login");
});

router.post("/login", (req, res) => {
  if ((req.body.password || "") === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.redirect("/admin");
  }
  req.flash("error", "Incorrect admin password.");
  res.redirect("/admin/login");
});

router.get("/logout", (req, res) => {
  req.session.isAdmin = false;
  res.redirect("/dashboard");
});

// ---- Admin panel: list matches, enter results ----------------------------
router.get("/", requireAdmin, async (req, res, next) => {
  try {
    const snap = await collections.matches.orderBy("kickoffTime", "asc").get();
    const matches = snap.docs.map((doc) => {
      const m = doc.data();
      return {
        id: doc.id,
        teamA: m.teamA,
        teamB: m.teamB,
        flagA: m.flagA || null,
        flagB: m.flagB || null,
        kickoffTime: m.kickoffTime.toDate(),
        status: m.status,
        liveScoreA: m.liveScoreA != null ? m.liveScoreA : null,
        liveScoreB: m.liveScoreB != null ? m.liveScoreB : null,
        actualScoreA: m.actualScoreA,
        actualScoreB: m.actualScoreB,
      };
    });
    res.render("admin", { matches });
  } catch (err) {
    next(err);
  }
});

// ---- Submit a final result + run the scoring engine ----------------------
router.post("/result/:matchId", requireAdmin, async (req, res) => {
  const { matchId } = req.params;
  const actualA = parseInt(req.body.actualScoreA, 10);
  const actualB = parseInt(req.body.actualScoreB, 10);

  try {
    if (Number.isNaN(actualA) || Number.isNaN(actualB) || actualA < 0 || actualB < 0) {
      req.flash("error", "Enter a valid final score for both teams.");
      return res.redirect("/admin");
    }

    const matchDoc = await collections.matches.doc(matchId).get();
    if (!matchDoc.exists) {
      req.flash("error", "Match not found.");
      return res.redirect("/admin");
    }

    // Result is locked once set — no changing it afterwards.
    if (matchDoc.data().status === "completed") {
      req.flash("error", "This result is locked and can't be changed.");
      return res.redirect("/admin");
    }

    // Record the result + score every prediction (shared helper).
    const scored = await applyMatchResult(matchId, actualA, actualB);

    req.flash(
      "success",
      `Result saved (${actualA}-${actualB}). Scored ${scored} prediction(s).`
    );
    res.redirect("/admin");
  } catch (err) {
    console.error(err);
    req.flash("error", "Could not save the result. Try again.");
    res.redirect("/admin");
  }
});

// ---- Optional: quickly add a new match -----------------------------------
router.post("/match", requireAdmin, async (req, res) => {
  const { teamA, teamB, kickoffTime } = req.body;
  try {
    if (!teamA || !teamB || !kickoffTime) {
      req.flash("error", "Team A, Team B and kickoff time are required.");
      return res.redirect("/admin");
    }
    await collections.matches.add({
      teamA: teamA.trim(),
      teamB: teamB.trim(),
      flagA: flagUrl(teamA),
      flagB: flagUrl(teamB),
      kickoffTime: Timestamp.fromDate(new Date(kickoffTime)),
      actualScoreA: null,
      actualScoreB: null,
      status: "scheduled",
    });
    req.flash("success", `Match added: ${teamA} vs ${teamB}.`);
    res.redirect("/admin");
  } catch (err) {
    console.error(err);
    req.flash("error", "Could not add the match.");
    res.redirect("/admin");
  }
});

// ---- Update the LIVE score (does NOT lock or score predictions) ----------
router.post("/live/:matchId", requireAdmin, async (req, res) => {
  const { matchId } = req.params;
  const a = parseInt(req.body.actualScoreA, 10);
  const b = parseInt(req.body.actualScoreB, 10);

  try {
    if (Number.isNaN(a) || Number.isNaN(b) || a < 0 || b < 0) {
      req.flash("error", "Enter a valid live score for both teams.");
      return res.redirect("/admin");
    }

    const matchDoc = await collections.matches.doc(matchId).get();
    if (!matchDoc.exists) {
      req.flash("error", "Match not found.");
      return res.redirect("/admin");
    }
    if (matchDoc.data().status === "completed") {
      req.flash("error", "Match is finished — live score can't be changed.");
      return res.redirect("/admin");
    }

    await collections.matches.doc(matchId).update({
      liveScoreA: a,
      liveScoreB: b,
    });

    req.flash("success", `Live score updated to ${a}-${b}.`);
    res.redirect("/admin");
  } catch (err) {
    console.error(err);
    req.flash("error", "Could not update the live score.");
    res.redirect("/admin");
  }
});

// ---- Delete a single match -----------------------------------------------
router.post("/delete/:matchId", requireAdmin, async (req, res) => {
  try {
    const removed = await deleteMatchAndPredictions(req.params.matchId);
    req.flash("success", `Match deleted (${removed} prediction(s) removed).`);
    res.redirect("/admin");
  } catch (err) {
    console.error(err);
    req.flash("error", "Could not delete the match.");
    res.redirect("/admin");
  }
});

// ---- Delete several selected matches at once -----------------------------
router.post("/delete-selected", requireAdmin, async (req, res) => {
  // matchIds arrives as a single string or an array depending on count.
  let ids = req.body.matchIds || [];
  if (!Array.isArray(ids)) ids = [ids];
  ids = ids.filter(Boolean);

  if (ids.length === 0) {
    req.flash("error", "No matches selected.");
    return res.redirect("/admin");
  }

  try {
    for (const id of ids) {
      await deleteMatchAndPredictions(id);
    }
    req.flash("success", `Deleted ${ids.length} match(es).`);
    res.redirect("/admin");
  } catch (err) {
    console.error(err);
    req.flash("error", "Could not delete the selected matches.");
    res.redirect("/admin");
  }
});

// ---- Manual "sync now" (the same routine the auto-sync runs) --------------
router.post("/import", requireAdmin, async (req, res) => {
  try {
    const r = await syncWorldCup();
    req.flash(
      "success",
      `Sync done: ${r.total} fixtures — ${r.created} new, ${r.updated} updated, ${r.live} live, ${r.scored} scored.`
    );
    res.redirect("/admin");
  } catch (err) {
    console.error(err);
    req.flash("error", "API sync failed: " + err.message);
    res.redirect("/admin");
  }
});

module.exports = router;
