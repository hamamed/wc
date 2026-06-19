require("dotenv").config();

const express = require("express");
const session = require("express-session");
const flash = require("connect-flash");
const path = require("path");
const { t: translate, LANGS: i18nLangs } = require("./utils/i18n");
const { localizeTeam } = require("./utils/countries");

const app = express();
const PORT = process.env.PORT || 3000;

// Trust the hosting platform's reverse proxy (Render/Railway/etc.) so HTTPS
// and secure cookies work correctly behind it.
app.set("trust proxy", 1);

// ---- View engine ---------------------------------------------------------
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ---- Middleware ----------------------------------------------------------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-this-secret-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }, // 1 week
  })
);

app.use(flash());

// Expose common values to every view.
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  res.locals.isAdmin = !!req.session.isAdmin;
  res.locals.currentPath = req.path;

  // Language / i18n — prefer session, fall back to a persistent cookie so the
  // choice survives server restarts/deploys.
  const lang = req.session.lang || readCookie(req, "lang") || "en";
  res.locals.lang = lang;
  res.locals.dir = lang === "ar" ? "rtl" : "ltr";
  res.locals.langs = i18nLangs;
  res.locals.t = (key) => translate(lang, key);
  res.locals.tn = (name) => localizeTeam(name, lang); // localized team/country name
  // Resolve an avatar value (flag URL, "/avatars/x", or bare filename) to an src.
  res.locals.avatarSrc = (a) =>
    !a ? null : (a.indexOf("http") === 0 || a.indexOf("/") === 0 ? a : "/avatars/" + a);
  next();
});

// Read a single cookie value from the raw header (no extra dependency).
function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const found = header
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + "="));
  return found ? decodeURIComponent(found.split("=").slice(1).join("=")) : null;
}

// Switch language: remember it in the session AND a 1-year cookie.
app.get("/lang/:code", (req, res) => {
  const code = req.params.code;
  if (["en", "fr", "ar"].includes(code)) {
    req.session.lang = code;
    res.cookie("lang", code, {
      maxAge: 1000 * 60 * 60 * 24 * 365, // 1 year
      sameSite: "lax",
      httpOnly: false,
    });
  }
  res.redirect(req.get("referer") || "/");
});

// ---- Routes --------------------------------------------------------------
app.use("/api", require("./routes/api"));
app.use("/", require("./routes/auth"));
app.use("/dashboard", require("./routes/dashboard"));
app.use("/match", require("./routes/match"));
app.use("/profile", require("./routes/profile"));
app.use("/champion", require("./routes/champion"));
app.use("/standings", require("./routes/standings"));
app.use("/leaderboard", require("./routes/leaderboard"));
app.use("/admin", require("./routes/admin"));

// Home -> dashboard when logged in, otherwise the public landing page.
app.get("/", (req, res) => {
  if (req.session.user) return res.redirect("/dashboard");
  res.render("home");
});

// ---- 404 + error handling ------------------------------------------------
app.use((req, res) => {
  res.status(404).render("error", { code: 404, message: "Page not found." });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render("error", {
    code: 500,
    message: "Something went wrong on our end.",
  });
});

const { startAutoSync } = require("./utils/syncService");

app.listen(PORT, () => {
  console.log(`\n⚽  World Cup 2026 Predictor running at http://localhost:${PORT}\n`);
  // Automatically pull fixtures, live scores, and results from the API.
  startAutoSync();
});
