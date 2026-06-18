const express = require("express");
const router = express.Router();
const { many } = require("../config/db");
const { requireLogin } = require("../utils/middleware");

router.get("/", requireLogin, async (req, res, next) => {
  try {
    const rows = await many(
      `SELECT id, username, total_points AS "totalPoints", last_rank AS "lastRank"
       FROM users ORDER BY total_points DESC, username ASC`
    );

    const me = req.session.user.id;
    const users = rows.map((u, i) => {
      const rank = i + 1;
      // move > 0 => climbed; < 0 => dropped; null lastRank => no data yet
      const move = u.lastRank != null ? u.lastRank - rank : 0;
      return {
        id: String(u.id),
        rank,
        username: u.username,
        totalPoints: u.totalPoints || 0,
        move,
        isMe: String(u.id) === me,
      };
    });

    res.render("leaderboard", { users });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
