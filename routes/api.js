/**
 * JSON API for the mobile app. Token auth (Bearer) — no cookies — so it works
 * cleanly from a Cordova app. Reuses the same Firestore data as the website.
 */
const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const { collections, Timestamp } = require("../config/firebase");
const { fetchStandings } = require("../utils/footballApi");
const { computeStandings, bestThirds } = require("../utils/standings");
const { LOCK_MS, teamsFromMatches } = require("../utils/champion");
const { getActualChampion } = require("../utils/championScore");
const { localizeTeam } = require("../utils/countries");

const LOCK = 30 * 60 * 1000; // predictions lock 30 min before kickoff

// ---- CORS (token auth, so * is fine) -------------------------------------
router.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ---- Token auth middleware -----------------------------------------------
async function apiAuth(req, res, next) {
  try {
    const h = req.get("Authorization") || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: "unauthorized" });
    const snap = await collections.users.where("apiToken", "==", token).limit(1).get();
    if (snap.empty) return res.status(401).json({ error: "unauthorized" });
    req.userId = snap.docs[0].id;
    req.userData = snap.docs[0].data();
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
}

// ---- Login / sign-up (passwordless) --------------------------------------
router.post("/login", async (req, res) => {
  try {
    const raw = (req.body.username || "").trim();
    if (!/^[a-zA-Z0-9_-]{3,20}$/.test(raw)) {
      return res.status(400).json({ error: "invalid_username" });
    }
    const lower = raw.toLowerCase();
    const token = crypto.randomBytes(24).toString("hex");

    const snap = await collections.users.where("usernameLower", "==", lower).limit(1).get();
    let id, username;
    if (snap.empty) {
      const ref = await collections.users.add({
        username: raw, usernameLower: lower, totalPoints: 0,
        createdAt: Timestamp.now(), apiToken: token,
      });
      id = ref.id; username = raw;
    } else {
      const doc = snap.docs[0];
      id = doc.id; username = doc.data().username;
      await doc.ref.update({ apiToken: token });
    }
    res.json({ token, user: { id, username } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
});

// ---- Fixtures (+ this user's predictions) --------------------------------
router.get("/matches", apiAuth, async (req, res) => {
  try {
    const [mSnap, pSnap] = await Promise.all([
      collections.matches.orderBy("kickoffTime", "asc").get(),
      collections.predictions.where("userId", "==", req.userId).get(),
    ]);
    const predBy = {};
    pSnap.forEach((d) => {
      const p = d.data();
      predBy[p.matchId] = { a: p.predictedScoreA, b: p.predictedScoreB, pts: p.pointsEarned };
    });
    const now = Date.now();
    const L = (n) => localizeTeam(n, req.query.lang || "en");
    const matches = mSnap.docs.map((d) => {
      const m = d.data();
      const k = m.kickoffTime.toMillis();
      const completed = m.status === "completed";
      const started = now >= k;
      const locked = now >= k - LOCK;
      const badge = completed ? "completed" : started ? "live" : locked ? "locked" : "open";
      return {
        id: d.id, teamA: L(m.teamA), teamB: L(m.teamB),
        flagA: m.flagA || null, flagB: m.flagB || null,
        kickoff: k, badge,
        actualA: m.actualScoreA != null ? m.actualScoreA : null,
        actualB: m.actualScoreB != null ? m.actualScoreB : null,
        liveA: m.liveScoreA != null ? m.liveScoreA : null,
        liveB: m.liveScoreB != null ? m.liveScoreB : null,
        pred: predBy[d.id] || null,
      };
    });
    res.json({ matches });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
});

// ---- Submit / edit a prediction ------------------------------------------
router.post("/predict", apiAuth, async (req, res) => {
  try {
    const matchId = req.body.matchId;
    const a = parseInt(req.body.scoreA, 10);
    const b = parseInt(req.body.scoreB, 10);
    if (Number.isNaN(a) || Number.isNaN(b) || a < 0 || b < 0 || a > 99 || b > 99) {
      return res.status(400).json({ error: "invalid" });
    }
    const mDoc = await collections.matches.doc(matchId).get();
    if (!mDoc.exists) return res.status(404).json({ error: "not_found" });
    const m = mDoc.data();
    if (m.status === "completed" || Date.now() >= m.kickoffTime.toMillis() - LOCK) {
      return res.status(403).json({ error: "locked" });
    }
    const ex = await collections.predictions
      .where("userId", "==", req.userId).where("matchId", "==", matchId).limit(1).get();
    const payload = {
      userId: req.userId, matchId, predictedScoreA: a, predictedScoreB: b,
      pointsEarned: 0, updatedAt: Timestamp.now(),
    };
    if (ex.empty) await collections.predictions.add(payload);
    else await collections.predictions.doc(ex.docs[0].id).update(payload);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
});

// ---- Leaderboard ----------------------------------------------------------
router.get("/leaderboard", apiAuth, async (req, res) => {
  try {
    const snap = await collections.users.orderBy("totalPoints", "desc").get();
    const users = snap.docs.map((d, i) => {
      const u = d.data();
      return { rank: i + 1, username: u.username, totalPoints: u.totalPoints || 0, me: d.id === req.userId };
    });
    res.json({ users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
});

// ---- Standings (API or computed fallback) --------------------------------
router.get("/standings", apiAuth, async (req, res) => {
  try {
    let groups;
    try {
      groups = await fetchStandings();
    } catch (e) {
      const snap = await collections.matches.get();
      const matches = snap.docs.map((d) => {
        const m = d.data();
        return {
          teamA: m.teamA, teamB: m.teamB, flagA: m.flagA, flagB: m.flagB,
          actualScoreA: m.actualScoreA, actualScoreB: m.actualScoreB,
          status: m.status, group: m.group || null,
        };
      });
      groups = computeStandings(matches);
    }
    // Localize team names for the requested language.
    const L = (n) => localizeTeam(n, req.query.lang || "en");
    groups = groups.map((g) => ({ name: g.name, rows: g.rows.map((r) => ({ ...r, team: L(r.team) })) }));
    const thirds = bestThirds(groups).map((r) => ({ ...r, team: L(r.team) }));
    res.json({ groups, thirds });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
});

// ---- Profile (stats, history, champion) ----------------------------------
router.get("/profile", apiAuth, async (req, res) => {
  try {
    const [predSnap, matchSnap] = await Promise.all([
      collections.predictions.where("userId", "==", req.userId).get(),
      collections.matches.get(),
    ]);
    const mById = {};
    matchSnap.forEach((d) => (mById[d.id] = d.data()));

    const stats = { totalPoints: req.userData.totalPoints || 0, made: 0, scored: 0, pending: 0, exact: 0, outcome: 0, missed: 0 };
    const history = [];
    predSnap.forEach((d) => {
      const p = d.data();
      const m = mById[p.matchId];
      if (!m) return;
      stats.made++;
      const completed = m.status === "completed";
      if (completed) {
        stats.scored++;
        if (p.pointsEarned === 2) stats.exact++;
        else if (p.pointsEarned === 1) stats.outcome++;
        else stats.missed++;
      } else stats.pending++;
      history.push({
        teamA: m.teamA, teamB: m.teamB, kickoff: m.kickoffTime.toMillis(),
        pred: p.predictedScoreA + "-" + p.predictedScoreB,
        result: completed ? m.actualScoreA + "-" + m.actualScoreB : null,
        points: completed ? p.pointsEarned : null,
      });
    });
    history.sort((a, b) => b.kickoff - a.kickoff);
    stats.hitRate = stats.scored > 0 ? Math.round(((stats.exact + stats.outcome) / stats.scored) * 100) : 0;

    const lang = req.query.lang || "en";
    const L = (n) => localizeTeam(n, lang);
    const actualChampion = await getActualChampion();

    res.json({
      username: req.userData.username,
      stats,
      history: history.map((h) => ({ ...h, teamA: L(h.teamA), teamB: L(h.teamB) })),
      // teams for the champion dropdown: value stays English, label is localized
      teams: teamsFromMatches(Object.values(mById)).map((t) => ({ value: t.name, label: L(t.name), flag: t.flag })),
      championPick: req.userData.championPick || null,
      championLabel: L(req.userData.championPick || ""),
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
    let s = await collections.matches.where("teamA", "==", pick).limit(1).get();
    if (!s.empty) flag = s.docs[0].data().flagA || null;
    else {
      s = await collections.matches.where("teamB", "==", pick).limit(1).get();
      if (!s.empty) flag = s.docs[0].data().flagB || null;
    }
    await collections.users.doc(req.userId).update({
      championPick: pick, championFlag: flag, championPickedAt: Timestamp.now(),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
});

module.exports = router;
