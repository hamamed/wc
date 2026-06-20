// Guard routes that need a logged-in user.
function requireLogin(req, res, next) {
  if (!req.session.user) {
    req.flash("error", "Please log in to continue.");
    return res.redirect("/login");
  }
  next();
}

// Guard the admin panel. Access is granted either by the ADMIN_PASSWORD prompt
// (sets req.session.isAdmin) or by a user account flagged as admin
// (res.locals.userIsAdmin, computed per-request in server.js).
function requireAdmin(req, res, next) {
  if (req.session.isAdmin || res.locals.userIsAdmin) {
    return next();
  }
  return res.redirect("/admin/login");
}

module.exports = { requireLogin, requireAdmin };
