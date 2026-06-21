const express = require("express");
const router = express.Router();
const { many } = require("../config/db");
const { requireLogin } = require("../utils/middleware");
const { getUserProfile } = require("../utils/userProfile");
const { getLiveBonus } = require("../utils/liveBonus");

router.get("/", requireLogin, async (req, res, next) => {
  try {
    const [rows, live] = await Promise.all([
      many(
        `SELECT id, username, avatar, total_points AS "totalPoints", last_rank AS "lastRank", last_points AS "lastPoints"
         FROM users`
      ),
      getLiveBonus(),
    ]);

    const me = String(req.session.user.id);
    // Add provisional live points, then rank by the live-adjusted total.
    const enriched = rows.map((u) => {
      const livePts = live[u.id] || 0;
      const base = u.totalPoints || 0;
      return { id: String(u.id), username: u.username, avatar: u.avatar || null, base, livePts, points: base + livePts, lastRank: u.lastRank, lastPoints: u.lastPoints };
    });
    enriched.sort((a, b) => (b.points - a.points) || a.username.localeCompare(b.username));

    const users = enriched.map((u, i) => {
      const rank = i + 1;
      const move = u.lastRank != null ? u.lastRank - rank : 0;
      const gained = u.lastPoints != null ? u.base - u.lastPoints : 0;
      return {
        id: u.id,
        rank,
        username: u.username,
        avatar: u.avatar,
        totalPoints: u.points,   // live-adjusted total
        livePts: u.livePts,
        move,
        gained,
        isMe: u.id === me,
      };
    });

    res.render("leaderboard", { users });
  } catch (err) {
    next(err);
  }
});

// ---- A user's public profile (JSON, for the leaderboard modal) -----------
router.get("/user/:id", requireLogin, async (req, res) => {
  try {
    const data = await getUserProfile(req.params.id, (n) => res.locals.tn(n));
    if (!data) return res.status(404).json({ error: "not_found" });
    data.avatar = res.locals.avatarSrc(data.avatar);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server" });
  }
});

module.exports = router;
