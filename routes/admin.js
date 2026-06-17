const express = require("express");
const router = express.Router();
const { admin, db, collections, Timestamp } = require("../config/firebase");
const { requireAdmin } = require("../utils/middleware");
const { computePoints } = require("../utils/scoring");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

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
        kickoffTime: m.kickoffTime.toDate(),
        status: m.status,
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

    const matchRef = collections.matches.doc(matchId);
    const matchDoc = await matchRef.get();
    if (!matchDoc.exists) {
      req.flash("error", "Match not found.");
      return res.redirect("/admin");
    }

    // 1) Record the actual result on the match.
    await matchRef.update({
      actualScoreA: actualA,
      actualScoreB: actualB,
      status: "completed",
    });

    // 2) Fetch every prediction for this match.
    const predSnap = await collections.predictions
      .where("matchId", "==", matchId)
      .get();

    // 3) Re-score each prediction and adjust the user's total by the DELTA,
    //    so re-submitting a corrected result stays consistent (idempotent).
    const batch = db.batch();
    predSnap.forEach((doc) => {
      const p = doc.data();
      const newPoints = computePoints(
        p.predictedScoreA,
        p.predictedScoreB,
        actualA,
        actualB
      );
      const delta = newPoints - (p.pointsEarned || 0);

      batch.update(doc.ref, {
        pointsEarned: newPoints,
        updatedAt: Timestamp.now(),
      });

      if (delta !== 0) {
        batch.update(collections.users.doc(p.userId), {
          totalPoints: admin.firestore.FieldValue.increment(delta),
        });
      }
    });

    await batch.commit();

    req.flash(
      "success",
      `Result saved (${actualA}-${actualB}). Scored ${predSnap.size} prediction(s).`
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

module.exports = router;
