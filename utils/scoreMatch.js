/**
 * Records a match's final result and (re)scores every prediction for it,
 * adjusting each user's totalPoints by the DELTA so re-running stays correct
 * (idempotent). Shared by the admin manual-entry route and the API import.
 *
 * Returns the number of predictions scored.
 */
const { admin, db, collections, Timestamp } = require("../config/firebase");
const { computePoints } = require("./scoring");

async function applyMatchResult(matchId, actualA, actualB) {
  actualA = Number(actualA);
  actualB = Number(actualB);

  await collections.matches.doc(matchId).update({
    actualScoreA: actualA,
    actualScoreB: actualB,
    status: "completed",
  });

  const predSnap = await collections.predictions
    .where("matchId", "==", matchId)
    .get();

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

    batch.update(doc.ref, { pointsEarned: newPoints, updatedAt: Timestamp.now() });
    if (delta !== 0) {
      batch.update(collections.users.doc(p.userId), {
        totalPoints: admin.firestore.FieldValue.increment(delta),
      });
    }
  });

  await batch.commit();
  return predSnap.size;
}

module.exports = { applyMatchResult };
