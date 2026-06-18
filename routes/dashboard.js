const express = require("express");
const router = express.Router();
const { collections, Timestamp } = require("../config/firebase");
const { requireLogin } = require("../utils/middleware");

const LOCK_MINUTES = 30;
const LOCK_MS = LOCK_MINUTES * 60 * 1000;

// A match locks 30 minutes before kickoff.
function isLocked(kickoffMs) {
  return Date.now() >= kickoffMs - LOCK_MS;
}

// ---- Dashboard: fixtures + the user's predictions ------------------------
router.get("/", requireLogin, async (req, res, next) => {
  try {
    const userId = req.session.user.id;

    const [matchSnap, predSnap] = await Promise.all([
      collections.matches.orderBy("kickoffTime", "asc").get(),
      collections.predictions.where("userId", "==", userId).get(),
    ]);

    // Map predictions by matchId for quick lookup.
    const predByMatch = {};
    predSnap.forEach((d) => {
      const p = d.data();
      predByMatch[p.matchId] = { id: d.id, ...p };
    });

    const matches = matchSnap.docs.map((doc) => {
      const m = doc.data();
      const kickoffMs = m.kickoffTime.toMillis();
      const locked = isLocked(kickoffMs);
      const started = Date.now() >= kickoffMs; // kickoff time has passed
      const pred = predByMatch[doc.id] || null;

      let badge;
      if (m.status === "completed") {
        badge = {
          type: "completed",
          points: pred ? pred.pointsEarned : null,
        };
      } else if (started) {
        badge = { type: "live" };
      } else if (locked) {
        badge = { type: "locked" };
      } else {
        badge = { type: "open" };
      }

      return {
        id: doc.id,
        teamA: m.teamA,
        teamB: m.teamB,
        flagA: m.flagA || null,
        flagB: m.flagB || null,
        kickoffTime: m.kickoffTime.toDate(),
        kickoffMs,
        status: m.status,
        actualScoreA: m.actualScoreA,
        actualScoreB: m.actualScoreB,
        liveScoreA: m.liveScoreA != null ? m.liveScoreA : null,
        liveScoreB: m.liveScoreB != null ? m.liveScoreB : null,
        locked,
        prediction: pred,
        badge,
      };
    });

    res.render("dashboard", { matches });
  } catch (err) {
    next(err);
  }
});

// ---- Submit / edit a prediction -----------------------------------------
router.post("/predict/:matchId", requireLogin, async (req, res) => {
  const { matchId } = req.params;
  const userId = req.session.user.id;
  const scoreA = parseInt(req.body.scoreA, 10);
  const scoreB = parseInt(req.body.scoreB, 10);

  // AJAX requests get JSON; normal form posts get a redirect (graceful fallback).
  const wantsJson = req.xhr || (req.headers.accept || "").includes("application/json");
  const reply = (ok, message) => {
    if (wantsJson) return res.json({ ok, message });
    req.flash(ok ? "success" : "error", message);
    return res.redirect("/dashboard");
  };

  try {
    if (
      Number.isNaN(scoreA) || Number.isNaN(scoreB) ||
      scoreA < 0 || scoreB < 0 || scoreA > 99 || scoreB > 99
    ) {
      return reply(false, res.locals.t("dash.invalid"));
    }

    const matchDoc = await collections.matches.doc(matchId).get();
    if (!matchDoc.exists) {
      return reply(false, "That match no longer exists.");
    }

    const match = matchDoc.data();

    // Server-side lock enforcement — never trust the client.
    if (match.status === "completed" || isLocked(match.kickoffTime.toMillis())) {
      return reply(false, res.locals.t("dash.lockedMsg"));
    }

    // One prediction per user per match — upsert.
    const existing = await collections.predictions
      .where("userId", "==", userId)
      .where("matchId", "==", matchId)
      .limit(1)
      .get();

    const payload = {
      userId,
      matchId,
      predictedScoreA: scoreA,
      predictedScoreB: scoreB,
      pointsEarned: 0,
      updatedAt: Timestamp.now(),
    };

    if (existing.empty) {
      await collections.predictions.add(payload);
    } else {
      await collections.predictions.doc(existing.docs[0].id).update(payload);
    }

    return reply(true, res.locals.t("dash.saved"));
  } catch (err) {
    console.error(err);
    return reply(false, "Could not save your prediction. Try again.");
  }
});

module.exports = router;
