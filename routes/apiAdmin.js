/**
 * Admin JSON API for the mobile app — token auth (Bearer) restricted to users
 * whose `is_admin` flag is set. Mirrors the website admin panel actions.
 */
const express = require("express");
const router = express.Router();
const { pool, one, many, query } = require("../config/db");
const { applyMatchResult } = require("../utils/scoreMatch");
const { syncWorldCup } = require("../utils/syncService");
const { flagUrl } = require("../utils/flags");
const { teamsFromMatches } = require("../utils/champion");
const { applyChampion, getActualChampion, BONUS } = require("../utils/championScore");
const { computePoints } = require("../utils/scoring");
const { localizeTeam } = require("../utils/countries");

router.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Authenticate by token AND require the admin role.
async function apiAdmin(req, res, next) {
  try {
    const h = req.get("Authorization") || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: "unauthorized" });
    const u = await one("SELECT id, username, is_admin FROM users WHERE api_token = $1", [token]);
    if (!u) return res.status(401).json({ error: "unauthorized" });
    if (!u.is_admin) return res.status(403).json({ error: "forbidden" });
    req.userId = u.id;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
}
router.use(apiAdmin);

// Delete a match: reverse its awarded points, then delete (predictions cascade).
async function deleteMatchAndPredictions(matchId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT user_id, points_earned FROM predictions WHERE match_id = $1",
      [matchId]
    );
    for (const p of rows) {
      if (p.points_earned) {
        await client.query(
          "UPDATE users SET total_points = total_points - $1 WHERE id = $2",
          [p.points_earned, p.user_id]
        );
      }
    }
    await client.query("DELETE FROM matches WHERE id = $1", [matchId]);
    await client.query("COMMIT");
    return rows.length;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ---- Overview: everything the admin screen needs -------------------------
router.get("/overview", async (req, res) => {
  try {
    const L = (n) => localizeTeam(n, req.query.lang || "en");
    const [mRows, uRows, announcements, pollRows, actualChampion, voteRows] = await Promise.all([
      many(
        `SELECT id, team_a, team_b, flag_a, flag_b, kickoff_time, status,
                actual_score_a, actual_score_b, live_score_a, live_score_b
         FROM matches ORDER BY kickoff_time ASC`
      ),
      many(
        `SELECT id, username, total_points, champion_pick, is_admin, created_at
         FROM users ORDER BY created_at DESC`
      ),
      many("SELECT id, message, active FROM announcements ORDER BY created_at DESC"),
      many(
        `SELECT p.id, p.question, p.active,
                (SELECT COUNT(*) FROM poll_votes WHERE poll_id = p.id AND choice)::int AS yes,
                (SELECT COUNT(*) FROM poll_votes WHERE poll_id = p.id AND NOT choice)::int AS no
         FROM polls p ORDER BY p.created_at DESC`
      ),
      getActualChampion(),
      many(
        `SELECT v.poll_id, u.username, v.choice
         FROM poll_votes v JOIN users u ON u.id = v.user_id
         ORDER BY v.choice DESC, lower(u.username) ASC`
      ),
    ]);

    const votersByPoll = {};
    voteRows.forEach((v) => {
      (votersByPoll[v.poll_id] = votersByPoll[v.poll_id] || []).push({ username: v.username, choice: v.choice });
    });

    const matches = mRows.map((m) => ({
      id: String(m.id),
      teamA: L(m.team_a), teamB: L(m.team_b),
      rawA: m.team_a, rawB: m.team_b,
      flagA: m.flag_a || null, flagB: m.flag_b || null,
      kickoff: new Date(m.kickoff_time).getTime(),
      status: m.status,
      actualA: m.actual_score_a, actualB: m.actual_score_b,
      liveA: m.live_score_a, liveB: m.live_score_b,
    }));

    res.json({
      matches,
      users: uRows.map((u) => ({
        id: String(u.id), username: u.username,
        totalPoints: u.total_points || 0, championPick: u.champion_pick || null,
        isAdmin: !!u.is_admin, createdAt: new Date(u.created_at).getTime(),
      })),
      announcements: announcements.map((a) => ({ id: String(a.id), message: a.message, active: a.active })),
      polls: pollRows.map((p) => ({
        id: String(p.id), question: p.question, active: p.active,
        yes: p.yes, no: p.no, voters: votersByPoll[p.id] || [],
      })),
      teams: teamsFromMatches(mRows.map((m) => ({ teamA: m.team_a, teamB: m.team_b, flagA: m.flag_a, flagB: m.flag_b })))
        .map((t) => ({ name: t.name, label: L(t.name), flag: t.flag })),
      champion: { actual: actualChampion, label: actualChampion ? L(actualChampion) : null, bonus: BONUS },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
});

// ---- Matches -------------------------------------------------------------
router.post("/match", async (req, res) => {
  try {
    const { teamA, teamB, kickoffTime } = req.body;
    if (!teamA || !teamB || !kickoffTime) return res.status(400).json({ error: "missing" });
    await query(
      `INSERT INTO matches (team_a, team_b, flag_a, flag_b, kickoff_time, status)
       VALUES ($1, $2, $3, $4, $5, 'scheduled')`,
      [String(teamA).trim(), String(teamB).trim(), flagUrl(teamA), flagUrl(teamB), new Date(kickoffTime).toISOString()]
    );
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "server" }); }
});

router.post("/result/:id", async (req, res) => {
  try {
    const a = parseInt(req.body.a, 10), b = parseInt(req.body.b, 10);
    if (Number.isNaN(a) || Number.isNaN(b) || a < 0 || b < 0) return res.status(400).json({ error: "invalid" });
    const m = await one("SELECT status FROM matches WHERE id = $1", [req.params.id]);
    if (!m) return res.status(404).json({ error: "not_found" });
    if (m.status === "completed") return res.status(403).json({ error: "locked" });
    const scored = await applyMatchResult(req.params.id, a, b);
    res.json({ ok: true, scored });
  } catch (err) { console.error(err); res.status(500).json({ error: "server" }); }
});

router.post("/live/:id", async (req, res) => {
  try {
    const a = parseInt(req.body.a, 10), b = parseInt(req.body.b, 10);
    if (Number.isNaN(a) || Number.isNaN(b) || a < 0 || b < 0) return res.status(400).json({ error: "invalid" });
    const m = await one("SELECT status FROM matches WHERE id = $1", [req.params.id]);
    if (!m) return res.status(404).json({ error: "not_found" });
    if (m.status === "completed") return res.status(403).json({ error: "locked" });
    await query("UPDATE matches SET live_score_a = $1, live_score_b = $2 WHERE id = $3", [a, b, req.params.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "server" }); }
});

router.post("/delete/:id", async (req, res) => {
  try {
    const removed = await deleteMatchAndPredictions(req.params.id);
    res.json({ ok: true, removed });
  } catch (err) { console.error(err); res.status(500).json({ error: "server" }); }
});

router.post("/import", async (req, res) => {
  try {
    const r = await syncWorldCup();
    res.json({ ok: true, ...r });
  } catch (err) { console.error(err); res.status(500).json({ error: "server", message: err.message }); }
});

// ---- Champion ------------------------------------------------------------
router.post("/champion", async (req, res) => {
  try {
    const { winners, bonus } = await applyChampion(req.body.champion);
    res.json({ ok: true, winners, bonus });
  } catch (err) { console.error(err); res.status(500).json({ error: "server" }); }
});

// ---- Manual prediction ---------------------------------------------------
router.post("/prediction", async (req, res) => {
  try {
    const userId = req.body.userId, matchId = req.body.matchId;
    const a = parseInt(req.body.scoreA, 10), b = parseInt(req.body.scoreB, 10);
    if (!userId || !matchId || Number.isNaN(a) || Number.isNaN(b) || a < 0 || b < 0 || a > 99 || b > 99) {
      return res.status(400).json({ error: "invalid" });
    }
    const m = await one("SELECT status, actual_score_a, actual_score_b FROM matches WHERE id = $1", [matchId]);
    if (!m) return res.status(404).json({ error: "not_found" });

    let points;
    const rawPts = req.body.points;
    if (rawPts !== "" && rawPts != null && !Number.isNaN(parseInt(rawPts, 10))) points = parseInt(rawPts, 10);
    else if (m.status === "completed" && m.actual_score_a != null && m.actual_score_b != null) points = computePoints(a, b, m.actual_score_a, m.actual_score_b);
    else points = 0;

    await query(
      `INSERT INTO predictions (user_id, match_id, predicted_score_a, predicted_score_b, points_earned, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (user_id, match_id)
       DO UPDATE SET predicted_score_a = EXCLUDED.predicted_score_a,
                     predicted_score_b = EXCLUDED.predicted_score_b,
                     points_earned = EXCLUDED.points_earned, updated_at = now()`,
      [userId, matchId, a, b, points]
    );
    await query(
      `UPDATE users SET total_points =
         COALESCE((SELECT SUM(points_earned) FROM predictions WHERE user_id = $1), 0) + COALESCE(champion_bonus, 0)
       WHERE id = $1`,
      [userId]
    );
    res.json({ ok: true, points });
  } catch (err) { console.error(err); res.status(500).json({ error: "server" }); }
});

// ---- Announcements -------------------------------------------------------
router.post("/announcement", async (req, res) => {
  try {
    const msg = (req.body.message || "").trim();
    if (!msg) return res.status(400).json({ error: "empty" });
    await query("INSERT INTO announcements (message) VALUES ($1)", [msg.slice(0, 500)]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "server" }); }
});
router.post("/announcement/:id/toggle", async (req, res) => {
  try { await query("UPDATE announcements SET active = NOT active WHERE id = $1", [req.params.id]); res.json({ ok: true }); }
  catch (err) { console.error(err); res.status(500).json({ error: "server" }); }
});
router.post("/announcement/:id/delete", async (req, res) => {
  try { await query("DELETE FROM announcements WHERE id = $1", [req.params.id]); res.json({ ok: true }); }
  catch (err) { console.error(err); res.status(500).json({ error: "server" }); }
});

// ---- Polls ---------------------------------------------------------------
router.post("/poll", async (req, res) => {
  try {
    const q = (req.body.question || "").trim();
    if (!q) return res.status(400).json({ error: "empty" });
    await query("INSERT INTO polls (question) VALUES ($1)", [q.slice(0, 500)]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "server" }); }
});
router.post("/poll/:id/edit", async (req, res) => {
  try {
    const q = (req.body.question || "").trim();
    if (!q) return res.status(400).json({ error: "empty" });
    await query("UPDATE polls SET question = $1 WHERE id = $2", [q.slice(0, 500), req.params.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "server" }); }
});
router.post("/poll/:id/toggle", async (req, res) => {
  try { await query("UPDATE polls SET active = NOT active WHERE id = $1", [req.params.id]); res.json({ ok: true }); }
  catch (err) { console.error(err); res.status(500).json({ error: "server" }); }
});
router.post("/poll/:id/delete", async (req, res) => {
  try { await query("DELETE FROM polls WHERE id = $1", [req.params.id]); res.json({ ok: true }); }
  catch (err) { console.error(err); res.status(500).json({ error: "server" }); }
});

// ---- User management -----------------------------------------------------
router.post("/users/rename/:id", async (req, res) => {
  try {
    const raw = (req.body.username || "").trim();
    if (!/^[a-zA-Z0-9_-]{3,20}$/.test(raw)) return res.status(400).json({ error: "invalid" });
    const lower = raw.toLowerCase();
    const clash = await one("SELECT id FROM users WHERE username_lower = $1", [lower]);
    if (clash && String(clash.id) !== String(req.params.id)) return res.status(409).json({ error: "taken" });
    await query("UPDATE users SET username = $1, username_lower = $2 WHERE id = $3", [raw, lower, req.params.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "server" }); }
});
router.post("/users/reset/:id", async (req, res) => {
  try { await query("UPDATE users SET total_points = 0, champion_bonus = 0 WHERE id = $1", [req.params.id]); res.json({ ok: true }); }
  catch (err) { console.error(err); res.status(500).json({ error: "server" }); }
});
router.post("/users/resetpin/:id", async (req, res) => {
  try { await query("UPDATE users SET pin = NULL WHERE id = $1", [req.params.id]); res.json({ ok: true }); }
  catch (err) { console.error(err); res.status(500).json({ error: "server" }); }
});
router.post("/users/admin/:id", async (req, res) => {
  try {
    const u = await one("UPDATE users SET is_admin = NOT is_admin WHERE id = $1 RETURNING is_admin", [req.params.id]);
    res.json({ ok: true, isAdmin: u ? u.is_admin : false });
  } catch (err) { console.error(err); res.status(500).json({ error: "server" }); }
});
router.post("/users/delete/:id", async (req, res) => {
  try { await query("DELETE FROM users WHERE id = $1", [req.params.id]); res.json({ ok: true }); }
  catch (err) { console.error(err); res.status(500).json({ error: "server" }); }
});
router.post("/users/:userId/predictions/:matchId/edit", async (req, res) => {
  try {
    const { userId, matchId } = req.params;
    const a = parseInt(req.body.scoreA, 10), b = parseInt(req.body.scoreB, 10);
    if (Number.isNaN(a) || Number.isNaN(b) || a < 0 || b < 0 || a > 99 || b > 99) return res.status(400).json({ error: "invalid" });
    const m = await one("SELECT status, actual_score_a, actual_score_b FROM matches WHERE id = $1", [matchId]);
    if (!m) return res.status(404).json({ error: "not_found" });
    let points;
    const rawPts = req.body.points;
    if (rawPts !== "" && rawPts != null && !Number.isNaN(parseInt(rawPts, 10))) points = parseInt(rawPts, 10);
    else if (m.status === "completed" && m.actual_score_a != null && m.actual_score_b != null) points = computePoints(a, b, m.actual_score_a, m.actual_score_b);
    else points = 0;
    await query(
      `INSERT INTO predictions (user_id, match_id, predicted_score_a, predicted_score_b, points_earned, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (user_id, match_id)
       DO UPDATE SET predicted_score_a = EXCLUDED.predicted_score_a,
                     predicted_score_b = EXCLUDED.predicted_score_b,
                     points_earned = EXCLUDED.points_earned, updated_at = now()`,
      [userId, matchId, a, b, points]
    );
    await query(
      `UPDATE users SET total_points =
         COALESCE((SELECT SUM(points_earned) FROM predictions WHERE user_id = $1), 0) + COALESCE(champion_bonus, 0)
       WHERE id = $1`,
      [userId]
    );
    res.json({ ok: true, points, pick: a + "-" + b });
  } catch (err) { console.error(err); res.status(500).json({ error: "server" }); }
});
router.post("/users/:userId/predictions/:matchId/delete", async (req, res) => {
  try {
    const { userId, matchId } = req.params;
    await query("DELETE FROM predictions WHERE user_id = $1 AND match_id = $2", [userId, matchId]);
    await query(
      `UPDATE users SET total_points =
         COALESCE((SELECT SUM(points_earned) FROM predictions WHERE user_id = $1), 0) + COALESCE(champion_bonus, 0)
       WHERE id = $1`,
      [userId]
    );
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "server" }); }
});
router.get("/users/:id/predictions", async (req, res) => {
  try {
    const L = (n) => localizeTeam(n, req.query.lang || "en");
    const user = await one("SELECT username FROM users WHERE id = $1", [req.params.id]);
    const rows = await many(
      `SELECT m.id AS match_id, m.team_a, m.team_b, m.status, m.actual_score_a, m.actual_score_b,
              p.predicted_score_a, p.predicted_score_b, p.points_earned, m.kickoff_time
       FROM predictions p JOIN matches m ON m.id = p.match_id
       WHERE p.user_id = $1 ORDER BY m.kickoff_time DESC`,
      [req.params.id]
    );
    res.json({
      username: user ? user.username : "User",
      predictions: rows.map((p) => {
        const completed = p.status === "completed";
        return {
          matchId: String(p.match_id),
          match: L(p.team_a) + " vs " + L(p.team_b),
          pick: p.predicted_score_a + "-" + p.predicted_score_b,
          predA: p.predicted_score_a, predB: p.predicted_score_b,
          result: completed ? p.actual_score_a + "-" + p.actual_score_b : "—",
          points: p.points_earned || 0, completed,
        };
      }),
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "server" }); }
});

module.exports = router;
