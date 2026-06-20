const express = require("express");
const router = express.Router();
const { many } = require("../config/db");
const { requireLogin } = require("../utils/middleware");
const { getUserProfile } = require("../utils/userProfile");

router.get("/", requireLogin, async (req, res, next) => {
  try {
    const rows = await many(
      `SELECT id, username, avatar, total_points AS "totalPoints", last_rank AS "lastRank", last_points AS "lastPoints"
       FROM users ORDER BY total_points DESC, username ASC`
    );

    const me = req.session.user.id;
    const users = rows.map((u, i) => {
      const rank = i + 1;
      // move > 0 => climbed; < 0 => dropped; null lastRank => no data yet
      const move = u.lastRank != null ? u.lastRank - rank : 0;
      const gained = u.lastPoints != null ? (u.totalPoints || 0) - u.lastPoints : 0;
      return {
        id: String(u.id),
        rank,
        username: u.username,
        avatar: u.avatar || null,
        totalPoints: u.totalPoints || 0,
        move,
        gained,
        isMe: String(u.id) === me,
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
