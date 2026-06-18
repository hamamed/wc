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
  const LIVE = new Set(["1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"]);

  return (data.response || [])
    .filter((f) => f.teams && f.teams.home && f.teams.away && f.teams.home.name && f.teams.away.name)
    .map((f) => {
      const short = f.fixture.status && f.fixture.status.short;
      return {
        externalId: "apf-" + f.fixture.id,
        teamA: f.teams.home.name,
        teamB: f.teams.away.name,
        flagA: f.teams.home.logo || null,
        flagB: f.teams.away.logo || null,
        kickoff: new Date(f.fixture.date),
        finished: FINISHED.has(short),
        inPlay: LIVE.has(short),
        scoreA: f.goals ? f.goals.home : null,
        scoreB: f.goals ? f.goals.away : null,
        group: (f.league && f.league.round) || null,
      };
    });
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
      inPlay: m.status === "IN_PLAY" || m.status === "PAUSED",
      scoreA: m.score && m.score.fullTime ? m.score.fullTime.home : null,
      scoreB: m.score && m.score.fullTime ? m.score.fullTime.away : null,
      group: m.group ? m.group.replace("GROUP_", "Group ") : null,
    }));
}

// ---- Standings (group tables) --------------------------------------------
// Returns: [ { name, rows: [{ rank, team, flag, played, win, draw, lose, gf, ga, gd, points }] } ]
async function fetchStandingsApiFootball() {
  const key = process.env.API_FOOTBALL_KEY;
  const league = process.env.API_FOOTBALL_LEAGUE || "1";
  const season = process.env.API_FOOTBALL_SEASON || "2026";
  const url = `https://v3.football.api-sports.io/standings?league=${league}&season=${season}`;
  const res = await fetch(url, { headers: { "x-apisports-key": key } });
  if (!res.ok) throw new Error(`API-Football standings ${res.status}`);
  const data = await res.json();
  if (data.errors && (Array.isArray(data.errors) ? data.errors.length : Object.keys(data.errors).length)) {
    throw new Error("API-Football: " + JSON.stringify(data.errors));
  }
  const league0 = data.response && data.response[0] && data.response[0].league;
  const groups = (league0 && league0.standings) || [];
  return groups.map((rows) => ({
    name: (rows[0] && rows[0].group) || "Group",
    rows: rows.map((r) => ({
      rank: r.rank,
      team: r.team.name,
      flag: r.team.logo || null,
      played: r.all.played,
      win: r.all.win,
      draw: r.all.draw,
      lose: r.all.lose,
      gf: r.all.goals.for,
      ga: r.all.goals.against,
      gd: r.goalsDiff,
      points: r.points,
    })),
  }));
}

async function fetchStandingsFootballData() {
  const key = process.env.FOOTBALL_API_KEY;
  const res = await fetch("https://api.football-data.org/v4/competitions/WC/standings", {
    headers: { "X-Auth-Token": key },
  });
  if (!res.ok) throw new Error(`football-data standings ${res.status}`);
  const data = await res.json();
  return (data.standings || [])
    .filter((s) => s.type === "TOTAL")
    .map((s) => ({
      name: s.group ? s.group.replace("GROUP_", "Group ") : (s.stage || "Group"),
      rows: (s.table || []).map((r) => ({
        rank: r.position,
        team: r.team.name,
        flag: r.team.crest || null,
        played: r.playedGames,
        win: r.won,
        draw: r.draw,
        lose: r.lost,
        gf: r.goalsFor,
        ga: r.goalsAgainst,
        gd: r.goalDifference,
        points: r.points,
      })),
    }));
}

async function fetchStandings() {
  if (process.env.API_FOOTBALL_KEY) return fetchStandingsApiFootball();
  if (process.env.FOOTBALL_API_KEY) return fetchStandingsFootballData();
  throw new Error("No football API key set for standings.");
}

// ---- Dispatcher ----------------------------------------------------------
async function fetchWorldCupMatches() {
  if (process.env.API_FOOTBALL_KEY) return fetchFromApiFootball();
  if (process.env.FOOTBALL_API_KEY) return fetchFromFootballData();
  throw new Error(
    "No football API key set. Add API_FOOTBALL_KEY (api-football.com) or FOOTBALL_API_KEY (football-data.org) to your .env."
  );
}

module.exports = { fetchWorldCupMatches, fetchStandings };
