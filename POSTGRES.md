# Migrating from Firestore to PostgreSQL (on your VPS)

The app now uses **PostgreSQL** instead of Firestore. Here's how to set it up on
your Hetzner VPS and move your existing data over.

## 1. Install PostgreSQL (on the VPS)
```bash
apt-get update
apt-get install -y postgresql postgresql-contrib
systemctl enable --now postgresql
```

## 2. Create the database and user
```bash
sudo -u postgres psql <<'SQL'
CREATE USER wcuser WITH PASSWORD 'choose-a-strong-password';
CREATE DATABASE worldcup OWNER wcuser;
GRANT ALL PRIVILEGES ON DATABASE worldcup TO wcuser;
SQL
```

## 3. Point the app at the database
In your project's `.env`:
```
DATABASE_URL=postgres://wcuser:choose-a-strong-password@localhost:5432/worldcup
PGSSL=false
```

## 4. Install deps + create the tables
```bash
cd /root/worldcup-predictor
git pull
npm install            # installs the new "pg" dependency
psql "$DATABASE_URL" -f schema.sql      # creates the tables
```
(If `psql` can't read `$DATABASE_URL`, paste the connection string directly:
`psql "postgres://wcuser:...@localhost:5432/worldcup" -f schema.sql`.)

## 5. (Optional) Migrate your existing Firestore data
Only if you have data in Firestore you want to keep. You need your
`serviceAccountKey.json` present (or `FIREBASE_SERVICE_ACCOUNT` set):
```bash
npm run migrate
```
This copies users, matches, predictions, and the champion setting into Postgres,
remapping the old IDs. Safe to re-run (it upserts).

> Skip this step if you're starting fresh — just use the app or `npm run seed`.

## 6. Restart
```bash
pm2 restart wc2026-predictor
pm2 logs wc2026-predictor --lines 20
```

---

## Notes
- **firebase-admin is now optional** — it's only used by `npm run migrate`. Once
  you've migrated (or if starting fresh), you can remove `serviceAccountKey.json`.
- **Backups:** `pg_dump "$DATABASE_URL" > backup.sql` to snapshot the DB.
- **Schema** lives in `schema.sql`. Tables: `users`, `matches`, `predictions`,
  `settings`. Deleting a match/user cascades to its predictions automatically.
- The **mobile app** keeps working unchanged — it talks to the same `/api`
  endpoints, which now read/write Postgres.
