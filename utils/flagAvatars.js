/**
 * Country-flag avatars (SVG) served from hampusborgos/country-flags via jsDelivr.
 * Users pick one as their profile picture.
 */
const BASE = "https://cdn.jsdelivr.net/gh/hampusborgos/country-flags/svg/";

const FLAGS = [
  ["us", "USA"], ["mx", "Mexico"], ["ca", "Canada"],
  ["br", "Brazil"], ["ar", "Argentina"], ["uy", "Uruguay"], ["co", "Colombia"],
  ["ec", "Ecuador"], ["pe", "Peru"], ["cl", "Chile"], ["py", "Paraguay"],
  ["ve", "Venezuela"], ["bo", "Bolivia"],
  ["fr", "France"], ["de", "Germany"], ["es", "Spain"], ["pt", "Portugal"],
  ["nl", "Netherlands"], ["be", "Belgium"], ["it", "Italy"], ["hr", "Croatia"],
  ["ch", "Switzerland"], ["dk", "Denmark"], ["pl", "Poland"], ["rs", "Serbia"],
  ["at", "Austria"], ["ua", "Ukraine"], ["se", "Sweden"], ["no", "Norway"],
  ["gr", "Greece"], ["cz", "Czechia"], ["hu", "Hungary"], ["ro", "Romania"],
  ["tr", "Turkey"], ["gb-eng", "England"], ["gb-sct", "Scotland"], ["gb-wls", "Wales"],
  ["ba", "Bosnia"],
  ["ma", "Morocco"], ["sn", "Senegal"], ["gh", "Ghana"], ["ng", "Nigeria"],
  ["cm", "Cameroon"], ["ci", "Ivory Coast"], ["eg", "Egypt"], ["tn", "Tunisia"],
  ["dz", "Algeria"], ["ml", "Mali"], ["cv", "Cape Verde"], ["za", "South Africa"],
  ["cd", "Congo DR"],
  ["jp", "Japan"], ["kr", "South Korea"], ["au", "Australia"], ["ir", "Iran"],
  ["iq", "Iraq"], ["sa", "Saudi Arabia"], ["qa", "Qatar"], ["ae", "UAE"],
  ["uz", "Uzbekistan"], ["jo", "Jordan"], ["cn", "China"], ["in", "India"],
  ["id", "Indonesia"], ["nz", "New Zealand"],
  ["cr", "Costa Rica"], ["pa", "Panama"], ["jm", "Jamaica"], ["hn", "Honduras"],
  ["sv", "El Salvador"], ["gt", "Guatemala"], ["ht", "Haiti"], ["cw", "Curaçao"],
];

const flagUrl = (code) => BASE + code + ".svg";
const options = () => FLAGS.map(([code, name]) => ({ code, name, url: flagUrl(code) }));
const isValidCode = (code) => FLAGS.some(([c]) => c === code);

module.exports = { options, isValidCode, flagUrl };
