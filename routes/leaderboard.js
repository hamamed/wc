const express = require("express");
const router = express.Router();
const { many } = require("../config/db");
const { requireLogin } = require("../utils/middleware");

router.get("/", requireLogin, async (req, res, next) => {
  try {
    const rows = await many(
      `SELECT id, username, total_points AS "totalPoints"
       FROM users ORDER BY total_points DESC, username ASC`
    );

    const me = req.session.user.id;
    const users = rows.map((u, i) => ({
      id: String(u.id),
      rank: i + 1,
      username: u.username,
      totalPoints: u.totalPoints || 0,
      isMe: String(u.id) === me,
    }));

    res.render("leaderboard", { users });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
