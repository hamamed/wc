const express = require("express");
const router = express.Router();
const { collections } = require("../config/firebase");
const { requireLogin } = require("../utils/middleware");

router.get("/", requireLogin, async (req, res, next) => {
  try {
    const snap = await collections.users
      .orderBy("totalPoints", "desc")
      .get();

    const users = snap.docs.map((doc, i) => {
      const u = doc.data();
      return {
        id: doc.id,
        rank: i + 1,
        username: u.username,
        totalPoints: u.totalPoints || 0,
        isMe: doc.id === req.session.user.id,
      };
    });

    res.render("leaderboard", { users });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
