/**
 * Seeds a handful of sample World Cup 2026 fixtures into Firestore.
 * Run once with:  npm run seed
 */
require("dotenv").config();
const { collections, Timestamp } = require("./config/firebase");

function hoursFromNow(h) {
  return Timestamp.fromDate(new Date(Date.now() + h * 60 * 60 * 1000));
}

const fixtures = [
  // An open one (kickoff in the future, > 30 min away)
  { teamA: "USA", teamB: "Mexico", kickoffTime: hoursFromNow(6) },
  { teamA: "Canada", teamB: "Brazil", kickoffTime: hoursFromNow(30) },
  { teamA: "Argentina", teamB: "France", kickoffTime: hoursFromNow(54) },
  // A locked one (kicks off within 30 minutes)
  { teamA: "England", teamB: "Germany", kickoffTime: hoursFromNow(0.25) },
];

async function seed() {
  console.log("Seeding fixtures...");
  for (const f of fixtures) {
    await collections.matches.add({
      ...f,
      actualScoreA: null,
      actualScoreB: null,
      status: "scheduled",
    });
    console.log(`  + ${f.teamA} vs ${f.teamB}`);
  }
  console.log("Done. ⚽");
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
