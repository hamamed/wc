/**
 * Maps a national-team name to a flag image URL (flagcdn.com — free, no key).
 * Used as a fallback when the football API doesn't supply a crest, and for
 * manually-added / seeded matches.
 */

// team name (lowercased) -> ISO 3166-1 alpha-2 code (flagcdn codes)
const CODES = {
  "usa": "us", "united states": "us", "united states of america": "us",
  "mexico": "mx", "canada": "ca",
  "brazil": "br", "argentina": "ar", "uruguay": "uy", "colombia": "co",
  "ecuador": "ec", "peru": "pe", "chile": "cl", "paraguay": "py",
  "venezuela": "ve", "bolivia": "bo",
  "france": "fr", "germany": "de", "spain": "es", "portugal": "pt",
  "netherlands": "nl", "belgium": "be", "italy": "it", "croatia": "hr",
  "switzerland": "ch", "denmark": "dk", "poland": "pl", "serbia": "rs",
  "austria": "at", "ukraine": "ua", "sweden": "se", "norway": "no",
  "greece": "gr", "czech republic": "cz", "czechia": "cz", "hungary": "hu",
  "romania": "ro", "turkey": "tr", "türkiye": "tr", "scotland": "gb-sct",
  "england": "gb-eng", "wales": "gb-wls",
  "morocco": "ma", "senegal": "sn", "ghana": "gh", "nigeria": "ng",
  "cameroon": "cm", "ivory coast": "ci", "cote d'ivoire": "ci",
  "côte d'ivoire": "ci", "egypt": "eg", "tunisia": "tn", "algeria": "dz",
  "mali": "ml", "burkina faso": "bf", "dr congo": "cd", "cape verde": "cv",
  "south africa": "za",
  "japan": "jp", "korea republic": "kr", "south korea": "kr",
  "australia": "au", "iran": "ir", "iraq": "iq", "saudi arabia": "sa",
  "qatar": "qa", "united arab emirates": "ae", "uzbekistan": "uz",
  "jordan": "jo", "oman": "om", "bahrain": "bh", "china": "cn",
  "india": "in", "indonesia": "id", "new zealand": "nz",
  "costa rica": "cr", "panama": "pa", "jamaica": "jm", "honduras": "hn",
  "el salvador": "sv", "guatemala": "gt",
};

function flagUrl(teamName) {
  if (!teamName) return null;
  const code = CODES[teamName.trim().toLowerCase()];
  return code ? `https://flagcdn.com/w80/${code}.png` : null;
}

module.exports = { flagUrl };
