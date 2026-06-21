const express = require("express");
const router = express.Router();
const { requireLogin } = require("../utils/middleware");
const forum = require("../utils/forum");

// Community feed.
router.get("/", requireLogin, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const posts = await forum.listPosts(userId);
    // Attach comments for each post (small community — fine to load inline).
    for (const p of posts) {
      p.comments = await forum.listComments(p.id);
    }
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
