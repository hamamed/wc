/**
 * JSON API for the mobile app — token auth (Bearer), backed by PostgreSQL.
 * Same data the website uses.
 */
const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const { one, many, query } = require("../config/db");
const { fetchStandings } = require("../utils/footballApi");
const { computeStandings, bestThirds } = require("../utils/standings");
const { LOCK_MS, teamsFromMatches } = require("../utils/champion");
const { getActualChampion } = require("../utils/championScore");
const { localizeTeam } = require("../utils/countries");
const { validPin, hashPin, verifyPin } = require("../utils/pin");
const { options: flagOptions, isValidCode, flagUrl } = require("../utils/flagAvatars");

const LOCK = 30 * 60 * 1000;

router.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

async function apiAuth(req, res, next) {
  try {
    const h = req.get("Authorization") || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: "unauthorized" });
    const u = await one(
      `SELECT id, username, avatar, total_points, champion_pick FROM users WHERE api_token = $1`,
      [token]
    );
    if (!u) return res.status(401).json({ error: "unauthorized" });
    req.userId = u.id;
    req.userData = u;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
}

// ---- Latest app version (public — for the in-app "update" prompt) --------
const APP_VERSION = process.env.APP_VERSION || "1.0.0";
router.get("/app-version", (req, res) => {
  res.json({ version: APP_VERSION, url: "https://koydam.com/download/hama.apk" });
});

// ---- Login / sign-up -----------------------------------------------------
router.post("/login", async (req, res) => {
  try {
    const raw = (req.body.username || "").trim();
    if (!/^[a-zA-Z0-9_-]{3,20}$/.test(raw)) {
      return res.status(400).json({ error: "invalid_username" });
    }
    const lower = raw.toLowerCase();
    const pin = (req.body.pin || "").trim();
    const token = crypto.randomBytes(24).toString("hex");

    const user = await one("SELECT id, username, pin FROM users WHERE username_lower = $1", [lower]);

    // New account — must choose a PIN.
    if (!user) {
      if (!pin) return res.json({ needPin: true, mode: "create" });
      if (!validPin(pin)) return res.status(400).json({ error: "invalid_pin" });
      const r = await one(
        "INSERT INTO users (username, username_lower, pin, api_token) VALUES ($1, $2, $3, $4) RETURNING id, username",
        [raw, lower, hashPin(pin), token]
      );
      return res.json({ token, user: { id: String(r.id), username: r.username } });
    }

    // Existing account without a PIN — set one now.
    if (!user.pin) {
      if (!pin) return res.json({ needPin: true, mode: "set" });
      if (!validPin(pin)) return res.status(400).json({ error: "invalid_pin" });
      await query("UPDATE users SET pin = $1, api_token = $2 WHERE id = $3", [hashPin(pin), token, user.id]);
      return res.json({ token, user: { id: String(user.id), username: user.username } });
    }

    // Existing account with a PIN — verify.
    if (!pin) return res.json({ needPin: true, mode: "enter" });
    if (!verifyPin(pin, user.pin)) return res.status(401).json({ error: "bad_pin" });
    await query("UPDATE users SET api_token = $1 WHERE id = $2", [token, user.id]);
    res.json({ token, user: { id: String(user.id), username: user.username } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
});

// ---- Fixtures ------------------------------------------------------------
router.get("/matches", apiAuth, async (req, res) => {
  try {
    const [rows, preds] = await Promise.all([
      many(
        `SELECT id, team_a, team_b, flag_a, flag_b, kickoff_time, status,
                actual_score_a, actual_score_b, live_score_a, live_score_b
         FROM matches ORDER BY kickoff_time ASC`
      ),
      many(
        "SELECT match_id, predicted_score_a, predicted_score_b, points_earned FROM predictions WHERE user_id = $1",
        [req.userId]
      ),
    ]);
    const predBy = {};
    preds.forEach((p) => {
      predBy[p.match_id] = { a: p.predicted_score_a, b: p.predicted_score_b, pts: p.points_earned };
    });
    const now = Date.now();
    const L = (n) => localizeTeam(n, req.query.lang || "en");
    const matches = rows.map((m) => {
      const k = new Date(m.kickoff_time).getTime();
      const completed = m.status === "completed";
      const started = now >= k;
      const locked = now >= k - LOCK;
      const badge = completed ? "completed" : started ? "live" : locked ? "locked" : "open";
      return {
        id: String(m.id), teamA: L(m.team_a), teamB: L(m.team_b),
        flagA: m.flag_a || null, flagB: m.flag_b || null,
        kickoff: k, badge,
        actualA: m.actual_score_a, actualB: m.actual_score_b,
        liveA: m.live_score_a, liveB: m.live_score_b,
        pred: predBy[m.id] || null,
      };
    });
    res.json({ matches });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
});

// ---- Predict -------------------------------------------------------------
router.post("/predict", apiAuth, async (req, res) => {
  try {
    const matchId = req.body.matchId;
    const a = parseInt(req.body.scoreA, 10);
    const b = parseInt(req.body.scoreB, 10);
    if (Number.isNaN(a) || Number.isNaN(b) || a < 0 || b < 0 || a > 99 || b > 99) {
      return res.status(400).json({ error: "invalid" });
    }
    const m = await one("SELECT status, kickoff_time FROM matches WHERE id = $1", [matchId]);
    if (!m) return res.status(404).json({ error: "not_found" });
    if (m.status === "completed" || Date.now() >= new Date(m.kickoff_time).getTime() - LOCK) {
      return res.status(403).json({ error: "locked" });
    }
    await query(
      `INSERT INTO predictions (user_id, match_id, predicted_score_a, predicted_score_b, points_earned, updated_at)
       VALUES ($1, $2, $3, $4, 0, now())
       ON CONFLICT (user_id, match_id)
       DO UPDATE SET predicted_score_a = EXCLUDED.predicted_score_a,
                     predicted_score_b = EXCLUDED.predicted_score_b, updated_at = now()`,
      [req.userId, matchId, a, b]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
});

// ---- Leaderboard ----------------------------------------------------------
router.get("/leaderboard", apiAuth, async (req, res) => {
  try {
    const rows = await many(
      "SELECT id, username, avatar, total_points, last_rank, last_points FROM users ORDER BY total_points DESC, username ASC"
    );
    const users = rows.map((u, i) => {
      const rank = i + 1;
      const move = u.last_rank != null ? u.last_rank - rank : 0;
      const gained = u.last_points != null ? (u.total_points || 0) - u.last_points : 0;
      return {
        rank, username: u.username, avatar: res.locals.avatarSrc(u.avatar),
        totalPoints: u.total_points || 0, move, gained, me: u.id === req.userId,
      };
    });
    res.json({ users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
});

// ---- Standings ------------------------------------------------------------
router.get("/standings", apiAuth, async (req, res) => {
  try {
    let groups;
    try {
      groups = await fetchStandings();
    } catch (e) {
      const matches = await many(
        `SELECT team_a AS "teamA", team_b AS "teamB", flag_a AS "flagA", flag_b AS "flagB",
                actual_score_a AS "actualScoreA", actual_score_b AS "actualScoreB", status, grp AS "group"
         FROM matches`
      );
      groups = computeStandings(matches);
    }
    const L = (n) => localizeTeam(n, req.query.lang || "en");
    groups = groups.map((g) => ({ name: g.name, rows: g.rows.map((r) => ({ ...r, team: L(r.team) })) }));
    const thirds = bestThirds(groups).map((r) => ({ ...r, team: L(r.team) }));
    res.json({ groups, thirds });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
});

// ---- Profile --------------------------------------------------------------
router.get("/profile", apiAuth, async (req, res) => {
  try {
    const [rows, allMatches, actualChampion] = await Promise.all([
      many(
        `SELECT p.predicted_score_a, p.predicted_score_b, p.points_earned,
                m.team_a, m.team_b, m.kickoff_time, m.status, m.actual_score_a, m.actual_score_b
         FROM predictions p JOIN matches m ON m.id = p.match_id WHERE p.user_id = $1`,
        [req.userId]
      ),
      many(`SELECT team_a AS "teamA", team_b AS "teamB", flag_a AS "flagA", flag_b AS "flagB" FROM matches`),
      getActualChampion(),
    ]);

    const lang = req.query.lang || "en";
    const L = (n) => localizeTeam(n, lang);

    const stats = { totalPoints: req.userData.total_points || 0, made: 0, scored: 0, pending: 0, exact: 0, outcome: 0, missed: 0 };
    const history = rows.map((p) => {
      stats.made++;
      const completed = p.status === "completed";
      if (completed) {
        stats.scored++;
        if (p.points_earned === 2) stats.exact++;
        else if (p.points_earned === 1) stats.outcome++;
        else stats.missed++;
      } else stats.pending++;
      return {
        teamA: L(p.team_a), teamB: L(p.team_b), kickoff: new Date(p.kickoff_time).getTime(),
        pred: p.predicted_score_a + "-" + p.predicted_score_b,
        result: completed ? p.actual_score_a + "-" + p.actual_score_b : null,
        points: completed ? p.points_earned : null,
      };
    });
    history.sort((a, b) => b.kickoff - a.kickoff);
    stats.hitRate = stats.scored > 0 ? Math.round(((stats.exact + stats.outcome) / stats.scored) * 100) : 0;

    res.json({
      username: req.userData.username,
      avatar: res.locals.avatarSrc(req.userData.avatar),
      flags: flagOptions(),
      stats, history,
      teams: teamsFromMatches(allMatches).map((t) => ({ value: t.name, label: L(t.name), flag: t.flag })),
      championPick: req.userData.champion_pick || null,
      championLabel: L(req.userData.champion_pick || ""),
      championLockMs: LOCK_MS,
      championLocked: Date.now() >= LOCK_MS,
      actualChampion,
      actualChampionLabel: actualChampion ? L(actualChampion) : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
});

// ---- Champion pick --------------------------------------------------------
router.post("/champion", apiAuth, async (req, res) => {
  try {
    if (Date.now() >= LOCK_MS) return res.status(403).json({ error: "locked" });
    const pick = (req.body.champion || "").trim();
    if (!pick) return res.status(400).json({ error: "empty" });
    let flag = null;
    const a = await one("SELECT flag_a FROM matches WHERE team_a = $1 LIMIT 1", [pick]);
    if (a) flag = a.flag_a || null;
    else {
      const b = await one("SELECT flag_b FROM matches WHERE team_b = $1 LIMIT 1", [pick]);
      if (b) flag = b.flag_b || null;
    }
    await query(
      "UPDATE users SET champion_pick = $1, champion_flag = $2, champion_picked_at = now() WHERE id = $3",
      [pick, flag, req.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
});

// ---- Change username -----------------------------------------------------
router.post("/username", apiAuth, async (req, res) => {
  try {
    const raw = (req.body.username || "").trim();
    if (!/^[a-zA-Z0-9_-]{3,20}$/.test(raw)) return res.status(400).json({ error: "invalid" });
    const lower = raw.toLowerCase();
    const clash = await one("SELECT id FROM users WHERE username_lower = $1", [lower]);
    if (clash && clash.id !== req.userId) return res.status(409).json({ error: "taken" });
    await query("UPDATE users SET username = $1, username_lower = $2 WHERE id = $3", [raw, lower, req.userId]);
    res.json({ ok: true, username: raw });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
});

// ---- Set the profile picture to a chosen flag ----------------------------
router.post("/avatar", apiAuth, async (req, res) => {
  try {
    const code = (req.body.avatar || "").trim();
    if (!isValidCode(code)) return res.status(400).json({ error: "invalid" });
    const url = flagUrl(code);
    await query("UPDATE users SET avatar = $1 WHERE id = $2", [url, req.userId]);
    res.json({ ok: true, avatar: url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
});

// ---- All predictions for a locked match ----------------------------------
router.get("/match/:id/predictions", apiAuth, async (req, res) => {
  try {
    const m = await one("SELECT team_a, team_b, kickoff_time, status FROM matches WHERE id = $1", [req.params.id]);
    if (!m) return res.status(404).json({ error: "not_found" });
    const k = new Date(m.kickoff_time).getTime();
    const locked = Date.now() >= k - LOCK || m.status === "completed";
    if (!locked) return res.status(403).json({ error: "locked" });
    const preds = (await many(
      `SELECT u.username, u.avatar, p.predicted_score_a AS a, p.predicted_score_b AS b, p.points_earned AS pts
       FROM predictions p JOIN users u ON u.id = p.user_id
       WHERE p.match_id = $1 ORDER BY p.points_earned DESC NULLS LAST, u.username ASC`,
      [req.params.id]
    )).map((p) => ({ username: p.username, a: p.a, b: p.b, pts: p.pts, avatar: res.locals.avatarSrc(p.avatar) }));
    const L = (n) => localizeTeam(n, req.query.lang || "en");
    res.json({ teamA: L(m.team_a), teamB: L(m.team_b), completed: m.status === "completed", preds });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
});

// ---- Community: announcements + feature polls ----------------------------
router.get("/community", apiAuth, async (req, res) => {
  try {
    const [announcements, polls] = await Promise.all([
      many("SELECT id, message FROM announcements WHERE active ORDER BY created_at DESC"),
      many(
        `SELECT p.id, p.question,
                (SELECT COUNT(*) FROM poll_votes WHERE poll_id = p.id AND choice)::int AS yes,
                (SELECT COUNT(*) FROM poll_votes WHERE poll_id = p.id AND NOT choice)::int AS no,
                (SELECT choice FROM poll_votes WHERE poll_id = p.id AND user_id = $1) AS "myVote"
         FROM polls p WHERE p.active ORDER BY p.created_at DESC`,
        [req.userId]
      ),
    ]);
    res.json({
      announcements: announcements.map((a) => ({ id: String(a.id), message: a.message })),
      polls: polls.map((p) => ({
        id: String(p.id), question: p.question,
        yes: p.yes, no: p.no,
        myVote: p.myVote === null || p.myVote === undefined ? null : !!p.myVote,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
});

// ---- Vote on a poll (users may change their vote) ------------------------
router.post("/vote", apiAuth, async (req, res) => {
  try {
    const pollId = req.body.pollId;
    if (!pollId) return res.status(400).json({ error: "invalid" });
    const choice = req.body.choice === "yes" || req.body.choice === true;
    await query(
      `INSERT INTO poll_votes (poll_id, user_id, choice) VALUES ($1, $2, $3)
       ON CONFLICT (poll_id, user_id) DO UPDATE SET choice = EXCLUDED.choice`,
      [pollId, req.userId, choice]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
});

module.exports = router;
