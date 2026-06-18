/**
 * PostgreSQL connection pool + small query helpers.
 * Configure with DATABASE_URL (e.g. postgres://user:pass@localhost:5432/worldcup).
 */
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
});

pool.on("error", (err) => console.error("Unexpected PG pool error:", err));

async function query(text, params) {
  return pool.query(text, params);
}
async function one(text, params) {
  const r = await pool.query(text, params);
  return r.rows[0] || null;
}
async function many(text, params) {
  const r = await pool.query(text, params);
  return r.rows;
}

module.exports = { pool, query, one, many };
