/**
 * Arabic names for national teams. localizeTeam(name, lang) returns the Arabic
 * name when lang === "ar" and a mapping exists, otherwise the original name.
 * Keys match the English team names (lowercased), same set as utils/flags.js.
 */
const AR = {
  "usa": "الولايات المتحدة", "united states": "الولايات المتحدة",
  "united states of america": "الولايات المتحدة",
  "mexico": "المكسيك", "canada": "كندا",
  "brazil": "البرازيل", "argentina": "الأرجنتين", "uruguay": "الأوروغواي",
  "colombia": "كولومبيا", "ecuador": "الإكوادور", "peru": "بيرو",
  "chile": "تشيلي", "paraguay": "باراغواي", "venezuela": "فنزويلا",
  "bolivia": "بوليفيا",
  "france": "فرنسا", "germany": "ألمانيا", "spain": "إسبانيا",
  "portugal": "البرتغال", "netherlands": "هولندا", "belgium": "بلجيكا",
  "italy": "إيطاليا", "croatia": "كرواتيا", "switzerland": "سويسرا",
  "denmark": "الدنمارك", "poland": "بولندا", "serbia": "صربيا",
  "austria": "النمسا", "ukraine": "أوكرانيا", "sweden": "السويد",
  "norway": "النرويج", "greece": "اليونان", "czech republic": "التشيك",
  "czechia": "التشيك", "hungary": "المجر", "romania": "رومانيا",
  "turkey": "تركيا", "türkiye": "تركيا", "scotland": "اسكتلندا",
  "england": "إنجلترا", "wales": "ويلز",
  "morocco": "المغرب", "senegal": "السنغال", "ghana": "غانا",
  "nigeria": "نيجيريا", "cameroon": "الكاميرون", "ivory coast": "ساحل العاج",
  "cote d'ivoire": "ساحل العاج", "côte d'ivoire": "ساحل العاج",
  "egypt": "مصر", "tunisia": "تونس", "algeria": "الجزائر", "mali": "مالي",
  "burkina faso": "بوركينا فاسو", "dr congo": "الكونغو الديمقراطية",
  "cape verde": "الرأس الأخضر", "south africa": "جنوب أفريقيا",
  "japan": "اليابان", "korea republic": "كوريا الجنوبية",
  "south korea": "كوريا الجنوبية", "australia": "أستراليا", "iran": "إيران",
  "iraq": "العراق", "saudi arabia": "السعودية", "qatar": "قطر",
  "united arab emirates": "الإمارات", "uzbekistan": "أوزبكستان",
  "jordan": "الأردن", "oman": "عُمان", "bahrain": "البحرين", "china": "الصين",
  "india": "الهند", "indonesia": "إندونيسيا", "new zealand": "نيوزيلندا",
  "costa rica": "كوستاريكا", "panama": "بنما", "jamaica": "جامايكا",
  "honduras": "هندوراس", "el salvador": "السلفادور", "guatemala": "غواتيمالا",
  "bosnia-herzegovina": "البوسنة والهرسك", "bosnia and herzegovina": "البوسنة والهرسك",
  "bosnia & herzegovina": "البوسنة والهرسك", "bosnia": "البوسنة والهرسك",
  "haiti": "هايتي",
  "curaçao": "كوراساو", "curacao": "كوراساو",
  "cape verde islands": "الرأس الأخضر",
};

function localizeTeam(name, lang) {
  if (lang !== "ar" || !name) return name;
  return AR[name.trim().toLowerCase()] || name;
}

module.exports = { localizeTeam };
