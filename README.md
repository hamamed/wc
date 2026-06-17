# ⚽ World Cup 2026 Match Predictor

A clean, dark-themed sports web app where players predict match scores, earn
points, and climb a leaderboard. Built with **Node.js + Express + EJS +
Firebase (Firestore) + Bootstrap 5 + Font Awesome 6**.

## Features
- **Passwordless auth** — pick a unique username; we create or find your account.
- **Dashboard** — fixtures with score inputs; predictions lock **30 min before
  kickoff** (enforced server-side).
- **Leaderboard** — searchable, ranked by total points.
- **Admin panel** — enter final scores; the **scoring engine** auto-awards points.
- **Scoring**: exact score = **2 pts**, correct outcome only = **1 pt**, wrong = **0**.

---

## 1. Install

```bash
cd worldcup-predictor
npm install
```

## 2. Set up Firebase credentials

1. Go to the [Firebase Console](https://console.firebase.google.com/) and create
   a project.
2. In the project, open **Build → Firestore Database** and click **Create
   database** (start in *production* or *test* mode — your choice).
3. Open **Project Settings (⚙️) → Service accounts**.
4. Click **Generate new private key**. A JSON file downloads.
5. Choose **one** of these ways to give the app the key:

   **Option A — local file (easiest for dev):**
   Rename the downloaded file to `serviceAccountKey.json` and drop it in the
   project root (next to `server.js`). It's already git-ignored.

   **Option B — environment variable (best for hosting):**
   Open `.env` and set `FIREBASE_SERVICE_ACCOUNT` to the entire JSON on one line:
   ```
   FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"...", ...}
   ```

## 3. Configure environment

```bash
cp .env.example .env      # then edit values (SESSION_SECRET, ADMIN_PASSWORD, ...)
```

## 4. (Optional) Seed sample fixtures

```bash
npm run seed
```

## 5. Run

```bash
npm start       # or: npm run dev  (auto-reload with nodemon)
```

Open **http://localhost:3000**.

- Players: enter any username to start predicting.
- Admin: visit **/admin**, log in with `ADMIN_PASSWORD`, add matches and enter
  final scores to trigger scoring.

---

## Firestore schema

```
users/{userId}
  username       string
  usernameLower  string   (lookup key, lowercased)
  totalPoints    number
  createdAt      timestamp

matches/{matchId}
  teamA          string
  teamB          string
  kickoffTime    timestamp
  actualScoreA   number | null
  actualScoreB   number | null
  status         "scheduled" | "completed"

predictions/{predictionId}
  userId            string  (ref users)
  matchId           string  (ref matches)
  predictedScoreA   number
  predictedScoreB   number
  pointsEarned      number
  updatedAt         timestamp
```

> The doc IDs serve as `matchId` / `predictionId`. `users` are stored with a
> `usernameLower` field for case-insensitive uniqueness lookups.

## Project structure

```
worldcup-predictor/
├── server.js                 # Express app + middleware + route mounting
├── seed.js                   # sample fixtures
├── config/
│   └── firebase.js           # firebase-admin init (file OR env credentials)
├── routes/
│   ├── auth.js               # login / signup / logout
│   ├── dashboard.js          # fixtures + predictions (lock logic)
│   ├── leaderboard.js        # ranked users
│   └── admin.js              # results entry + scoring engine
├── utils/
│   ├── scoring.js            # 2/1/0 points logic
│   └── middleware.js         # requireLogin / requireAdmin
├── views/                    # EJS templates
│   ├── partials/ (head, navbar, footer)
│   ├── login.ejs  dashboard.ejs  leaderboard.ejs
│   └── admin.ejs  admin-login.ejs  error.ejs
└── public/css/style.css      # dark sports theme
```
