/**
 * Community forum data layer: posts, up/down votes and comments.
 * Shared by the website routes and the mobile API.
 */
const { one, many, query } = require("../config/db");

// Posts with the caller's vote, comment count and report info.
// sort: "new" = newest first, otherwise "top" = highest score first.
async function listPosts(userId, sort) {
  const order = sort === "new" ? "p.created_at DESC" : "score DESC, p.created_at DESC";
  return many(
    `SELECT p.id, p.body, p.created_at AS "createdAt", p.user_id AS "userId",
            u.username, u.avatar,
            COALESCE((SELECT SUM(value) FROM post_votes WHERE post_id = p.id), 0)::int AS score,
            (SELECT value FROM post_votes WHERE post_id = p.id AND user_id = $1) AS "myVote",
            (SELECT COUNT(*) FROM post_comments WHERE post_id = p.id)::int AS "commentCount",
            (SELECT COUNT(*) FROM post_reports WHERE post_id = p.id)::int AS "reportCount",
            EXISTS(SELECT 1 FROM post_reports WHERE post_id = p.id AND user_id = $1) AS "myReport"
     FROM posts p JOIN users u ON u.id = p.user_id
     ORDER BY ` + order,
    [userId]
  );
}

async function editPost(userId, postId, body, isAdmin) {
  const b = (body || "").trim().slice(0, 2000);
  if (!b) return false;
  const p = await one("SELECT user_id FROM posts WHERE id = $1", [postId]);
  if (!p) return false;
  if (!isAdmin && String(p.user_id) !== String(userId)) return false;
  await query("UPDATE posts SET body = $1 WHERE id = $2", [b, postId]);
  return true;
}

async function reportPost(userId, postId) {
  await query(
    "INSERT INTO post_reports (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [postId, userId]
  );
  return true;
}

async function listComments(postId) {
  return many(
    `SELECT c.id, c.body, c.created_at AS "createdAt", c.user_id AS "userId", u.username, u.avatar
     FROM post_comments c JOIN users u ON u.id = c.user_id
     WHERE c.post_id = $1 ORDER BY c.created_at ASC`,
    [postId]
  );
}

async function createPost(userId, body) {
  const b = (body || "").trim().slice(0, 2000);
  if (!b) return null;
  return one("INSERT INTO posts (user_id, body) VALUES ($1, $2) RETURNING id", [userId, b]);
}

async function addComment(userId, postId, body) {
  const b = (body || "").trim().slice(0, 1000);
  if (!b) return null;
  return one("INSERT INTO post_comments (post_id, user_id, body) VALUES ($1, $2, $3) RETURNING id", [postId, userId, b]);
}

// value: 1 (up), -1 (down) or 0 (clear). Returns the post's new score.
async function votePost(userId, postId, value) {
  const v = value === 1 ? 1 : value === -1 ? -1 : 0;
  if (v === 0) {
    await query("DELETE FROM post_votes WHERE post_id = $1 AND user_id = $2", [postId, userId]);
  } else {
    await query(
      `INSERT INTO post_votes (post_id, user_id, value) VALUES ($1, $2, $3)
       ON CONFLICT (post_id, user_id) DO UPDATE SET value = EXCLUDED.value`,
      [postId, userId, v]
    );
  }
  const r = await one("SELECT COALESCE(SUM(value), 0)::int AS score FROM post_votes WHERE post_id = $1", [postId]);
  return r ? r.score : 0;
}

// Delete a post if the caller owns it (or is admin). Returns true if deleted.
async function deletePost(userId, postId, isAdmin) {
  const p = await one("SELECT user_id FROM posts WHERE id = $1", [postId]);
  if (!p) return false;
  if (!isAdmin && String(p.user_id) !== String(userId)) return false;
  await query("DELETE FROM posts WHERE id = $1", [postId]);
  return true;
}

async function deleteComment(userId, commentId, isAdmin) {
  const c = await one("SELECT user_id FROM post_comments WHERE id = $1", [commentId]);
  if (!c) return false;
  if (!isAdmin && String(c.user_id) !== String(userId)) return false;
  await query("DELETE FROM post_comments WHERE id = $1", [commentId]);
  return true;
}

module.exports = { listPosts, listComments, createPost, editPost, addComment, votePost, reportPost, deletePost, deleteComment };
