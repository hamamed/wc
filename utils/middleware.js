// Guard routes that need a logged-in user.
function requireLogin(req, res, next) {
  if (!req.session.user) {
    req.flash("error", "Please log in to continue.");
    return res.redirect("/login");
  }
  next();
}

// Guard the admin panel. Admin access is granted by an ADMIN_PASSWORD prompt
// (see routes/admin.js) which sets req.session.isAdmin.
function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.redirect("/admin/login");
  }
  next();
}

module.exports = { requireLogin, requireAdmin };
