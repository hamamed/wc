/**
 * Champion bonus: when the admin sets the actual World Cup winner, every user
 * who predicted that team gets a one-time bonus added to their totalPoints.
 *
 * Idempotent: each user's awarded bonus is tracked in `championBonus`, so
 * changing the actual champion re-adjusts totals by the delta.
 */
const { admin, db, collections } = require("../config/firebase");

const BONUS = parseInt(process.env.CHAMPION_BONUS || "10", 10);
const SETTINGS_DOC = "worldcup";

async function getActualChampion() {
  const doc = await collections.settings.doc(SETTINGS_DOC).get();
  return doc.exists ? doc.data().actualChampion || null : null;
}

async function applyChampion(team) {
  const actual = (team || "").trim() || null;

  // Save the actual champion.
  await collections.settings.doc(SETTINGS_DOC).set(
    { actualChampion: actual },
    { merge: true }
  );

  // Re-score every user's champion bonus by the delta.
  const usersSnap = await collections.users.get();
  const batch = db.batch();
  let winners = 0;

  usersSnap.forEach((doc) => {
    const u = doc.data();
    const newBonus = actual && u.championPick === actual ? BONUS : 0;
    const delta = newBonus - (u.championBonus || 0);
    if (newBonus > 0) winners++;
    if (delta !== 0) {
      batch.update(doc.ref, {
        championBonus: newBonus,
        totalPoints: admin.firestore.FieldValue.increment(delta),
      });
    } else if (u.championBonus == null) {
      batch.update(doc.ref, { championBonus: 0 });
    }
  });

  await batch.commit();
  return { winners, bonus: BONUS };
}

module.exports = { applyChampion, getActualChampion, BONUS };
