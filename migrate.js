/**
 * One-time migration: copy existing data from Firestore into PostgreSQL.
 *
 * Requirements:
 *   - serviceAccountKey.json (or FIREBASE_SERVICE_ACCOUNT) for Firestore read access
 *   - DATABASE_URL for the Postgres target
 *   - the schema already created:  psql "$DATABASE_URL" -f schema.sql
 *
 * Run:  npm run migrate
 */
require("dotenv").config();
const { collections } = require("./config/firebase");
const { pool, one, query } = require("./config/db");

const ts = (t) => (t && t.toDate ? t.toDate() : t || new Date());

async function migrate() {
  const userMap = {};
  const matchMap = {};

  // ---- users ----
  const usersSnap = await collections.users.get();
  for (const d of usersSnap.docs) {
    const u = d.data();
    const row = await one(
      `INSERT INTO users
         (username, username_lower, total_points, avatar, champion_pick, champion_flag,
          champion_bonus, champion_picked_at, api_token, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (username_lower) DO UPDATE SET username = users.username
       RETURNING id`,
      [
        u.username,
        u.usernameLower || (u.username || "").toLowerCase(),
        u.totalPoints || 0,
        u.avatar || null,
        u.championPick || null,
        u.championFlag || null,
        u.championBonus || 0,
        u.championPickedAt ? ts(u.championPickedAt) : null,
        u.apiToken || null,
        ts(u.createdAt),
      ]
    );
    userMap[d.id] = row.id;
  }

  // ---- matches (merge-safe: keep an existing Postgres match, just map its id) ----
  const matchesSnap = await collections.matches.get();
  for (const d of matchesSnap.docs) {
    const m = d.data();
    const vals = [
      m.externalId || null,
      m.teamA, m.teamB, m.flagA || null, m.flagB || null,
      ts(m.kickoffTime),
      m.actualScoreA != null ? m.actualScoreA : null,
      m.actualScoreB != null ? m.actualScoreB : null,
      m.liveScoreA != null ? m.liveScoreA : null,
      m.liveScoreB != null ? m.liveScoreB : null,
      m.status || "scheduled",
      m.group || null,
    ];
    let row;
    if (m.externalId) {
      // Upsert by external_id; on conflict keep the live Postgres row, return its id.
      row = await one(
        `INSERT INTO matches
           (external_id, team_a, team_b, flag_a, flag_b, kickoff_time,
            actual_score_a, actual_score_b, live_score_a, live_score_b, status, grp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (external_id) DO UPDATE SET external_id = matches.external_id
         RETURNING id`,
        vals
      );
    } else {
      // No external_id: match an existing one by teams + kickoff, else insert.
      const ex = await one(
        "SELECT id FROM matches WHERE team_a = $1 AND team_b = $2 AND kickoff_time = $3 LIMIT 1",
        [m.teamA, m.teamB, ts(m.kickoffTime)]
      );
      row = ex || await one(
        `INSERT INTO matches
           (external_id, team_a, team_b, flag_a, flag_b, kickoff_time,
            actual_score_a, actual_score_b, live_score_a, live_score_b, status, grp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id`,
        vals
      );
    }
    matchMap[d.id] = row.id;
  }

  // ---- predictions ----
  const predsSnap = await collections.predictions.get();
  let predCount = 0;
  for (const d of predsSnap.docs) {
    const p = d.data();
    const uid = userMap[p.userId];
    const mid = matchMap[p.matchId];
    if (!uid || !mid) continue;
    await query(
      `INSERT INTO predictions (user_id, match_id, predicted_score_a, predicted_score_b, points_earned, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id, match_id) DO NOTHING`,
      [uid, mid, p.predictedScoreA, p.predictedScoreB, p.pointsEarned || 0, ts(p.updatedAt)]
    );
    predCount++;
  }

  // ---- settings (actual champion) ----
  try {
    const s = await collections.settings.doc("worldcup").get();
    if (s.exists) {
      await query(
        `INSERT INTO settings (key, value) VALUES ('actualChampion', to_jsonb($1::text))
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [s.data().actualChampion || null]
      );
    }
  } catch (e) { /* no settings is fine */ }

  // ---- recompute points so totals match the migrated predictions ----
  await query(
    `UPDATE predictions p SET points_earned = CASE
       WHEN m.status = 'completed' AND m.actual_score_a IS NOT NULL AND m.actual_score_b IS NOT NULL THEN
         CASE
           WHEN p.predicted_score_a = m.actual_score_a AND p.predicted_score_b = m.actual_score_b THEN 4
           WHEN sign(p.predicted_score_a - p.predicted_score_b) = sign(m.actual_score_a - m.actual_score_b)
                AND (p.predicted_score_a - p.predicted_score_b) = (m.actual_score_a - m.actual_score_b) THEN 2
           WHEN sign(p.predicted_score_a - p.predicted_score_b) = sign(m.actual_score_a - m.actual_score_b) THEN 1
           ELSE 0
         END
       ELSE 0
     END
     FROM matches m WHERE m.id = p.match_id`
  );
  await query(
    `UPDATE users u SET total_points =
       COALESCE((SELECT SUM(points_earned) FROM predictions WHERE user_id = u.id), 0)
       + COALESCE(u.champion_bonus, 0)`
  );

  console.log(
    `✅ Migrated ${Object.keys(userMap).length} users, ${Object.keys(matchMap).length} matches, ${predCount} predictions (points recomputed).`
  );
  await pool.end();
  process.exit(0);
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
