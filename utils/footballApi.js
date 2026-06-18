/**
 * Fetches World Cup matches from football-data.org (free tier includes the
 * "WC" competition). Requires a free API token in FOOTBALL_API_KEY.
 *
 * Get a key: https://www.football-data.org/client/register
 */
const ENDPOINT = "https://api.football-data.org/v4/competitions/WC/matches";

async function fetchWorldCupMatches() {
  const key = process.env.FOOTBALL_API_KEY;
  if (!key) {
    throw new Error("FOOTBALL_API_KEY is not set in your environment (.env).");
  }

  const res = await fetch(ENDPOINT, { headers: { "X-Auth-Token": key } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`football-data.org returned ${res.status} ${res.statusText}. ${body}`);
  }

  const data = await res.json();
  const raw = data.matches || [];

  // Normalize; skip matches whose teams aren't decided yet (group placeholders).
  return raw
    .filter((m) => m.homeTeam && m.awayTeam && m.homeTeam.name && m.awayTeam.name)
    .map((m) => ({
      externalId: String(m.id),
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

module.exports = { fetchWorldCupMatches };
