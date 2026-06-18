const express = require("express");
const router = express.Router();
const { admin, db, collections, Timestamp } = require("../config/firebase");
const { requireAdmin } = require("../utils/middleware");
const { applyMatchResult } = require("../utils/scoreMatch");
const { fetchWorldCupMatches } = require("../utils/footballApi");
const { flagUrl } = require("../utils/flags");

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

// ---- Delete a match (and its predictions, reversing any points) ----------
router.post("/delete/:matchId", requireAdmin, async (req, res) => {
  const { matchId } = req.params;
  try {
    const predSnap = await collections.predictions
      .where("matchId", "==", matchId)
      .get();

    const batch = db.batch();

    // Reverse any points this match awarded, then remove its predictions.
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

    req.flash("success", `Match deleted (${predSnap.size} prediction(s) removed).`);
    res.redirect("/admin");
  } catch (err) {
    console.error(err);
    req.flash("error", "Could not delete the match.");
    res.redirect("/admin");
  }
});

// ---- Import fixtures from the football API -------------------------------
router.post("/import", requireAdmin, async (req, res) => {
  try {
    const apiMatches = await fetchWorldCupMatches();
    let created = 0;
    let updated = 0;
    let scored = 0;

    for (const m of apiMatches) {
      const flagA = m.flagA || flagUrl(m.teamA);
      const flagB = m.flagB || flagUrl(m.teamB);

      const snap = await collections.matches
        .where("externalId", "==", m.externalId)
        .limit(1)
        .get();

      if (snap.empty) {
        const ref = await collections.matches.add({
          externalId: m.externalId,
          teamA: m.teamA,
          teamB: m.teamB,
          flagA,
          flagB,
          kickoffTime: Timestamp.fromDate(m.kickoff),
          actualScoreA: null,
          actualScoreB: null,
          status: "scheduled",
        });
        created++;
        if (m.finished && m.scoreA != null && m.scoreB != null) {
          await applyMatchResult(ref.id, m.scoreA, m.scoreB);
          scored++;
        }
      } else {
        const doc = snap.docs[0];
        // Refresh fixture info but never clobber an already-completed result.
        await doc.ref.update({
          teamA: m.teamA,
          teamB: m.teamB,
          flagA,
          flagB,
          kickoffTime: Timestamp.fromDate(m.kickoff),
        });
        updated++;
        if (
          m.finished &&
          doc.data().status !== "completed" &&
          m.scoreA != null &&
          m.scoreB != null
        ) {
          await applyMatchResult(doc.id, m.scoreA, m.scoreB);
          scored++;
        }
      }
    }

    req.flash(
      "success",
      `API import done: ${created} new, ${updated} updated, ${scored} auto-scored.`
    );
    res.redirect("/admin");
  } catch (err) {
    console.error(err);
    req.flash("error", "API import failed: " + err.message);
    res.redirect("/admin");
  }
});

module.exports = router;
