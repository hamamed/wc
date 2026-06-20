const express = require("express");
const router = express.Router();
const { pool, one, many, query } = require("../config/db");
const { requireAdmin } = require("../utils/middleware");
const { applyMatchResult } = require("../utils/scoreMatch");
const { syncWorldCup } = require("../utils/syncService");
const { flagUrl } = require("../utils/flags");
const { teamsFromMatches } = require("../utils/champion");
const { applyChampion, getActualChampion, BONUS } = require("../utils/championScore");
const { computePoints } = require("../utils/scoring");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

// Delete one match: reverse points it awarded, then delete it (predictions
// cascade-delete). Returns the number of predictions removed.
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

// ---- Admin panel ---------------------------------------------------------
router.get("/", requireAdmin, async (req, res, next) => {
  try {
    const matches = await many(
      `SELECT id, team_a AS "teamA", team_b AS "teamB", flag_a AS "flagA", flag_b AS "flagB",
              kickoff_time AS "kickoffTime", status,
              live_score_a AS "liveScoreA", live_score_b AS "liveScoreB",
              actual_score_a AS "actualScoreA", actual_score_b AS "actualScoreB"
       FROM matches ORDER BY kickoff_time ASC`
    );
    const actualChampion = await getActualChampion();
    const users = await many("SELECT id, username FROM users ORDER BY username ASC");
    const announcements = await many(
      'SELECT id, message, active, created_at AS "createdAt" FROM announcements ORDER BY created_at DESC'
    );
    const polls = await many(
      `SELECT p.id, p.question, p.active, p.created_at AS "createdAt",
              (SELECT COUNT(*) FROM poll_votes WHERE poll_id = p.id AND choice)::int AS yes,
              (SELECT COUNT(*) FROM poll_votes WHERE poll_id = p.id AND NOT choice)::int AS no
       FROM polls p ORDER BY p.created_at DESC`
    );
    // Who voted on each poll, and how — grouped by poll for the admin view.
    const voteRows = await many(
      `SELECT v.poll_id AS "pollId", u.username, v.choice
       FROM poll_votes v JOIN users u ON u.id = v.user_id
       ORDER BY v.choice DESC, lower(u.username) ASC`
    );
    const votersByPoll = {};
    voteRows.forEach((v) => {
      (votersByPoll[v.pollId] = votersByPoll[v.pollId] || []).push(v);
    });
    polls.forEach((p) => { p.voters = votersByPoll[p.id] || []; });

    res.render("admin", {
      matches,
      teams: teamsFromMatches(matches),
      actualChampion,
      championBonus: BONUS,
      users,
      announcements,
      polls,
    });
  } catch (err) {
    next(err);
  }
});

// ---- Submit a final result -----------------------------------------------
router.post("/result/:matchId", requireAdmin, async (req, res) => {
  const { matchId } = req.params;
  const actualA = parseInt(req.body.actualScoreA, 10);
  const actualB = parseInt(req.body.actualScoreB, 10);
  try {
    if (Number.isNaN(actualA) || Number.isNaN(actualB) || actualA < 0 || actualB < 0) {
      req.flash("error", "Enter a valid final score for both teams.");
      return res.redirect("/admin");
    }
    const match = await one("SELECT status FROM matches WHERE id = $1", [matchId]);
    if (!match) {
      req.flash("error", "Match not found.");
      return res.redirect("/admin");
    }
    if (match.status === "completed") {
      req.flash("error", "This result is locked and can't be changed.");
      return res.redirect("/admin");
    }
    const scored = await applyMatchResult(matchId, actualA, actualB);
    req.flash("success", `Result saved (${actualA}-${actualB}). Scored ${scored} prediction(s).`);
    res.redirect("/admin");
  } catch (err) {
    console.error(err);
    req.flash("error", "Could not save the result. Try again.");
    res.redirect("/admin");
  }
});

// ---- Update the LIVE score (no lock, no scoring) -------------------------
router.post("/live/:matchId", requireAdmin, async (req, res) => {
  const { matchId } = req.params;
  const a = parseInt(req.body.actualScoreA, 10);
  const b = parseInt(req.body.actualScoreB, 10);
  try {
    if (Number.isNaN(a) || Number.isNaN(b) || a < 0 || b < 0) {
      req.flash("error", "Enter a valid live score for both teams.");
      return res.redirect("/admin");
    }
    const match = await one("SELECT status FROM matches WHERE id = $1", [matchId]);
    if (!match) {
      req.flash("error", "Match not found.");
      return res.redirect("/admin");
    }
    if (match.status === "completed") {
      req.flash("error", "Match is finished — live score can't be changed.");
      return res.redirect("/admin");
    }
    await query("UPDATE matches SET live_score_a = $1, live_score_b = $2 WHERE id = $3", [a, b, matchId]);
    req.flash("success", `Live score updated to ${a}-${b}.`);
    res.redirect("/admin");
  } catch (err) {
    console.error(err);
    req.flash("error", "Could not update the live score.");
    res.redirect("/admin");
  }
});

// ---- Manually add / edit a user's prediction (with points) ---------------
router.post("/prediction", requireAdmin, async (req, res) => {
  const userId = req.body.userId;
  const matchId = req.body.matchId;
  const a = parseInt(req.body.scoreA, 10);
  const b = parseInt(req.body.scoreB, 10);
  try {
    if (!userId || !matchId || Number.isNaN(a) || Number.isNaN(b) || a < 0 || b < 0 || a > 99 || b > 99) {
      req.flash("error", "Pick a user, a match, and a valid score.");
      return res.redirect("/admin");
    }

    const m = await one("SELECT status, actual_score_a, actual_score_b FROM matches WHERE id = $1", [matchId]);
    if (!m) {
      req.flash("error", "Match not found.");
      return res.redirect("/admin");
    }

    // Points: use the admin's value if given; otherwise compute from the result
    // (if the match is completed), else 0.
    let points;
    const rawPts = req.body.points;
    if (rawPts !== "" && rawPts != null && !Number.isNaN(parseInt(rawPts, 10))) {
      points = parseInt(rawPts, 10);
    } else if (m.status === "completed" && m.actual_score_a != null && m.actual_score_b != null) {
      points = computePoints(a, b, m.actual_score_a, m.actual_score_b);
    } else {
      points = 0;
    }

    await query(
      `INSERT INTO predictions (user_id, match_id, predicted_score_a, predicted_score_b, points_earned, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (user_id, match_id)
       DO UPDATE SET predicted_score_a = EXCLUDED.predicted_score_a,
                     predicted_score_b = EXCLUDED.predicted_score_b,
                     points_earned = EXCLUDED.points_earned, updated_at = now()`,
      [userId, matchId, a, b, points]
    );

    // Keep the user's total consistent.
    await query(
      `UPDATE users SET total_points =
         COALESCE((SELECT SUM(points_earned) FROM predictions WHERE user_id = $1), 0)
         + COALESCE(champion_bonus, 0)
       WHERE id = $1`,
      [userId]
    );

    req.flash("success", `Prediction saved (${a}-${b}, ${points} pts).`);
    res.redirect("/admin");
  } catch (err) {
    console.error(err);
    req.flash("error", "Could not save the prediction.");
    res.redirect("/admin");
  }
});

// ---- Set the actual champion + award bonus -------------------------------
router.post("/champion", requireAdmin, async (req, res) => {
  try {
    const { winners, bonus } = await applyChampion(req.body.champion);
    req.flash("success", `Champion set. Awarded +${bonus} to ${winners} correct prediction(s).`);
    res.redirect("/admin");
  } catch (err) {
    console.error(err);
    req.flash("error", "Could not set the champion.");
    res.redirect("/admin");
  }
});

// ---- Add a match manually ------------------------------------------------
router.post("/match", requireAdmin, async (req, res) => {
  const { teamA, teamB, kickoffTime } = req.body;
  try {
    if (!teamA || !teamB || !kickoffTime) {
      req.flash("error", "Team A, Team B and kickoff time are required.");
      return res.redirect("/admin");
    }
    await query(
      `INSERT INTO matches (team_a, team_b, flag_a, flag_b, kickoff_time, status)
       VALUES ($1, $2, $3, $4, $5, 'scheduled')`,
      [teamA.trim(), teamB.trim(), flagUrl(teamA), flagUrl(teamB), new Date(kickoffTime).toISOString()]
    );
    req.flash("success", `Match added: ${teamA} vs ${teamB}.`);
    res.redirect("/admin");
  } catch (err) {
    console.error(err);
    req.flash("error", "Could not add the match.");
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

// ---- Delete several selected matches -------------------------------------
router.post("/delete-selected", requireAdmin, async (req, res) => {
  let ids = req.body.matchIds || [];
  if (!Array.isArray(ids)) ids = [ids];
  ids = ids.filter(Boolean);
  if (ids.length === 0) {
    req.flash("error", "No matches selected.");
    return res.redirect("/admin");
  }
  try {
    for (const id of ids) await deleteMatchAndPredictions(id);
    req.flash("success", `Deleted ${ids.length} match(es).`);
    res.redirect("/admin");
  } catch (err) {
    console.error(err);
    req.flash("error", "Could not delete the selected matches.");
    res.redirect("/admin");
  }
});

// ---- Sync from the football API ------------------------------------------
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

// ---- Announcements -------------------------------------------------------
router.post("/announcement", requireAdmin, async (req, res) => {
  try {
    const msg = (req.body.message || "").trim();
    if (!msg) { req.flash("error", "Announcement message is required."); return res.redirect("/admin"); }
    await query("INSERT INTO announcements (message) VALUES ($1)", [msg.slice(0, 500)]);
    req.flash("success", "Announcement posted.");
    res.redirect("/admin");
  } catch (err) { console.error(err); req.flash("error", "Could not post the announcement."); res.redirect("/admin"); }
});
router.post("/announcement/:id/toggle", requireAdmin, async (req, res) => {
  try {
    await query("UPDATE announcements SET active = NOT active WHERE id = $1", [req.params.id]);
    res.redirect("/admin");
  } catch (err) { console.error(err); res.redirect("/admin"); }
});
router.post("/announcement/:id/delete", requireAdmin, async (req, res) => {
  try {
    await query("DELETE FROM announcements WHERE id = $1", [req.params.id]);
    req.flash("success", "Announcement deleted.");
    res.redirect("/admin");
  } catch (err) { console.error(err); res.redirect("/admin"); }
});

// ---- Polls ---------------------------------------------------------------
router.post("/poll", requireAdmin, async (req, res) => {
  try {
    const q = (req.body.question || "").trim();
    if (!q) { req.flash("error", "Poll question is required."); return res.redirect("/admin"); }
    await query("INSERT INTO polls (question) VALUES ($1)", [q.slice(0, 500)]);
    req.flash("success", "Poll created.");
    res.redirect("/admin");
  } catch (err) { console.error(err); req.flash("error", "Could not create the poll."); res.redirect("/admin"); }
});
router.post("/poll/:id/edit", requireAdmin, async (req, res) => {
  try {
    const q = (req.body.question || "").trim();
    if (!q) { req.flash("error", "Poll question is required."); return res.redirect("/admin"); }
    await query("UPDATE polls SET question = $1 WHERE id = $2", [q.slice(0, 500), req.params.id]);
    req.flash("success", "Poll updated.");
    res.redirect("/admin");
  } catch (err) { console.error(err); req.flash("error", "Could not update the poll."); res.redirect("/admin"); }
});
router.post("/poll/:id/toggle", requireAdmin, async (req, res) => {
  try {
    await query("UPDATE polls SET active = NOT active WHERE id = $1", [req.params.id]);
    res.redirect("/admin");
  } catch (err) { console.error(err); res.redirect("/admin"); }
});
router.post("/poll/:id/delete", requireAdmin, async (req, res) => {
  try {
    await query("DELETE FROM polls WHERE id = $1", [req.params.id]);
    req.flash("success", "Poll deleted.");
    res.redirect("/admin");
  } catch (err) { console.error(err); res.redirect("/admin"); }
});

// ---- User management -----------------------------------------------------
router.get("/users", requireAdmin, async (req, res, next) => {
  try {
    const rows = await many(
      `SELECT id, username, total_points AS "totalPoints", created_at AS "createdAt",
              champion_pick AS "championPick"
       FROM users ORDER BY created_at DESC`
    );
    const users = rows.map((u) => ({
      id: String(u.id),
      username: u.username,
      totalPoints: u.totalPoints || 0,
      createdAt: u.createdAt ? new Date(u.createdAt) : null,
      championPick: u.championPick || null,
    }));
    res.render("admin-users", { users });
  } catch (err) {
    next(err);
  }
});

router.get("/users/:id/predictions", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await one("SELECT username FROM users WHERE id = $1", [id]);
    const rows = await many(
      `SELECT m.team_a, m.team_b, m.kickoff_time, m.status,
              m.actual_score_a, m.actual_score_b,
              p.predicted_score_a, p.predicted_score_b, p.points_earned
       FROM predictions p JOIN matches m ON m.id = p.match_id
       WHERE p.user_id = $1 ORDER BY m.kickoff_time DESC`,
      [id]
    );
    const predictions = rows.map((p) => {
      const completed = p.status === "completed";
      return {
        match: `${p.team_a} vs ${p.team_b}`,
        kickoffMs: p.kickoff_time ? new Date(p.kickoff_time).getTime() : 0,
        pick: `${p.predicted_score_a}-${p.predicted_score_b}`,
        result: completed ? `${p.actual_score_a}-${p.actual_score_b}` : "—",
        points: p.points_earned || 0,
        completed,
      };
    });
    res.json({ username: user ? user.username : "User", predictions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed" });
  }
});

router.post("/users/rename/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const raw = (req.body.username || "").trim();
  try {
    if (!/^[a-zA-Z0-9_-]{3,20}$/.test(raw)) {
      req.flash("error", "Username must be 3-20 chars (letters, numbers, _ or -).");
      return res.redirect("/admin/users");
    }
    const lower = raw.toLowerCase();
    const clash = await one("SELECT id FROM users WHERE username_lower = $1", [lower]);
    if (clash && String(clash.id) !== id) {
      req.flash("error", `Username "${raw}" is already taken.`);
      return res.redirect("/admin/users");
    }
    await query("UPDATE users SET username = $1, username_lower = $2 WHERE id = $3", [raw, lower, id]);
    req.flash("success", `User renamed to ${raw}.`);
    res.redirect("/admin/users");
  } catch (err) {
    console.error(err);
    req.flash("error", "Could not rename the user.");
    res.redirect("/admin/users");
  }
});

router.post("/users/reset/:id", requireAdmin, async (req, res) => {
  try {
    await query("UPDATE users SET total_points = 0, champion_bonus = 0 WHERE id = $1", [req.params.id]);
    req.flash("success", "User points reset to 0.");
    res.redirect("/admin/users");
  } catch (err) {
    console.error(err);
    req.flash("error", "Could not reset points.");
    res.redirect("/admin/users");
  }
});

// Clear a user's PIN so they can set a new one on next login (unlock support).
router.post("/users/resetpin/:id", requireAdmin, async (req, res) => {
  try {
    await query("UPDATE users SET pin = NULL WHERE id = $1", [req.params.id]);
    req.flash("success", "PIN cleared — the user will set a new one next login.");
    res.redirect("/admin/users");
  } catch (err) {
    console.error(err);
    req.flash("error", "Could not reset the PIN.");
    res.redirect("/admin/users");
  }
});

router.post("/users/delete/:id", requireAdmin, async (req, res) => {
  try {
    const c = await one("SELECT count(*)::int AS n FROM predictions WHERE user_id = $1", [req.params.id]);
    await query("DELETE FROM users WHERE id = $1", [req.params.id]);
    req.flash("success", `User deleted (${c ? c.n : 0} prediction(s) removed).`);
    res.redirect("/admin/users");
  } catch (err) {
    console.error(err);
    req.flash("error", "Could not delete the user.");
    res.redirect("/admin/users");
  }
});

module.exports = router;
