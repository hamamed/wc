/**
 * Fetches World Cup matches from a football data provider and normalizes them
 * to one shape the importer understands:
 *   { externalId, teamA, teamB, flagA, flagB, kickoff(Date), finished(bool),
 *     scoreA, scoreB }
 *
 * Provider is chosen by which key is set in the environment:
 *   - API_FOOTBALL_KEY  -> API-Sports (api-football.com)   [recommended for WC 2026]
 *   - FOOTBALL_API_KEY  -> football-data.org
 */

// ---- Provider 1: API-Sports / API-Football -------------------------------
// Docs: https://www.api-football.com/documentation-v3
// World Cup league id = 1. Season defaults to 2026 (override with API_FOOTBALL_SEASON).
async function fetchFromApiFootball() {
  const key = process.env.API_FOOTBALL_KEY;
  const league = process.env.API_FOOTBALL_LEAGUE || "1"; // 1 = World Cup
  const season = process.env.API_FOOTBALL_SEASON || "2026";

  const url = `https://v3.football.api-sports.io/fixtures?league=${league}&season=${season}`;
  const res = await fetch(url, { headers: { "x-apisports-key": key } });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API-Football returned ${res.status} ${res.statusText}. ${body}`);
  }

  const data = await res.json();

  // API-Football returns 200 even on quota/param errors, with an `errors` field.
  if (data.errors && (Array.isArray(data.errors) ? data.errors.length : Object.keys(data.errors).length)) {
    throw new Error("API-Football error: " + JSON.stringify(data.errors));
  }

  const FINISHED = new Set(["FT", "AET", "PEN"]);

  return (data.response || [])
    .filter((f) => f.teams && f.teams.home && f.teams.away && f.teams.home.name && f.teams.away.name)
    .map((f) => ({
      externalId: "apf-" + f.fixture.id,
      teamA: f.teams.home.name,
      teamB: f.teams.away.name,
      flagA: f.teams.home.logo || null,
      flagB: f.teams.away.logo || null,
      kickoff: new Date(f.fixture.date),
      finished: FINISHED.has(f.fixture.status && f.fixture.status.short),
      scoreA: f.goals ? f.goals.home : null,
      scoreB: f.goals ? f.goals.away : null,
    }));
}

// ---- Provider 2: football-data.org ---------------------------------------
async function fetchFromFootballData() {
  const key = process.env.FOOTBALL_API_KEY;
  const res = await fetch("https://api.football-data.org/v4/competitions/WC/matches", {
    headers: { "X-Auth-Token": key },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`football-data.org returned ${res.status} ${res.statusText}. ${body}`);
  }
  const data = await res.json();
  return (data.matches || [])
    .filter((m) => m.homeTeam && m.awayTeam && m.homeTeam.name && m.awayTeam.name)
    .map((m) => ({
      externalId: "fd-" + m.id,
      teamA: m.homeTeam.name,
      teamB: m.awayTeam.name,
      flagA: m.homeTeam.crest || null,
      flagB: m.awayTeam.crest || null,
      kickoff: new Date(m.utcDate),
      finished: m.status === "FINISHED",
      scoreA: m.score && m.score.fullTime ? m.score.fullTime.home : null,
      scoreB: m.score && m.score.fullTime ? m.score.fullTime.away : null,
    }));
}

// ---- Dispatcher ----------------------------------------------------------
async function fetchWorldCupMatches() {
  if (process.env.API_FOOTBALL_KEY) return fetchFromApiFootball();
  if (process.env.FOOTBALL_API_KEY) return fetchFromFootballData();
  throw new Error(
    "No football API key set. Add API_FOOTBALL_KEY (api-football.com) or FOOTBALL_API_KEY (football-data.org) to your .env."
  );
}

module.exports = { fetchWorldCupMatches };
