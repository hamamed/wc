const express = require("express");
const router = express.Router();
const { one, query } = require("../config/db");
const { requireLogin } = require("../utils/middleware");
const forum = require("../utils/forum");

// Community feed.
router.get("/", requireLogin, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const me = String(userId);
    // Capture the previous "seen" time BEFORE resetting it, to flag what's new.
    const u = await one("SELECT community_seen_at FROM users WHERE id = $1", [userId]);
    const prevSeen = u && u.community_seen_at ? new Date(u.community_seen_at).getTime() : 0;

    const posts = await forum.listPosts(userId);
    for (const p of posts) {
      p.comments = await forum.listComments(p.id);
      p.comments.forEach((c) => { c.isNew = new Date(c.createdAt).getTime() > prevSeen && String(c.userId) !== me; });
      p.isNew = new Date(p.createdAt).getTime() > prevSeen && String(p.userId) !== me;
      p.hasNewComments = p.comments.some((c) => c.isNew);
    }
    // Mark the feed as seen so the badge clears.
    try { await query("UPDATE users SET community_seen_at = now() WHERE id = $1", [userId]); } catch (_) {}
    res.locals.communityNew = 0;
    res.render("community", { posts });
  } catch (err) {
    next(err);
  }
});

router.post("/post", requireLogin, async (req, res) => {
  try {
    await forum.createPost(req.session.user.id, req.body.body);
    res.redirect("/community");
  } catch (err) { console.error(err); res.redirect("/community"); }
});

router.post("/post/:id/comment", requireLogin, async (req, res) => {
  try {
    await forum.addComment(req.session.user.id, req.params.id, req.body.body);
    res.redirect("/community#post-" + req.params.id);
  } catch (err) { console.error(err); res.redirect("/community"); }
});

// AJAX vote — returns the new score.
router.post("/post/:id/vote", requireLogin, async (req, res) => {
  try {
    const value = parseInt(req.body.value, 10);
    const score = await forum.votePost(req.session.user.id, req.params.id, value);
    res.json({ ok: true, score, myVote: value === 0 ? null : value });
  } catch (err) { console.error(err); res.status(500).json({ error: "server" }); }
});

router.post("/post/:id/delete", requireLogin, async (req, res) => {
  try {
    await forum.deletePost(req.session.user.id, req.params.id, !!res.locals.userIsAdmin || !!req.session.isAdmin);
    res.redirect("/community");
  } catch (err) { console.error(err); res.redirect("/community"); }
});

router.post("/comment/:id/delete", requireLogin, async (req, res) => {
  try {
    await forum.deleteComment(req.session.user.id, req.params.id, !!res.locals.userIsAdmin || !!req.session.isAdmin);
    res.redirect("/community");
  } catch (err) { console.error(err); res.redirect("/community"); }
});

module.exports = router;
