/* scripts/export-data.cjs
   내장 DEMO 데이터를 data/*.json 으로 내보냅니다.
   실행: node scripts/export-data.cjs
   실운영 시에는 이 JSON 을 대한민국 구석구석 / TourAPI 결과로 교체하고
   places.json 의 "source" 를 "live" 로 설정하면 앱이 자동 병합합니다.
*/
const fs = require("fs"), vm = require("vm"), path = require("path");
const ROOT = path.join(__dirname, "..");
const s = {};
s.window = s; s.globalThis = s;
s.location = { protocol: "http:", search: "" };
s.console = console;
s.fetch = () => Promise.reject(new Error("offline"));
s.document = { readyState: "complete", addEventListener() {} };
vm.createContext(s);
["js/config.js", "js/data.js", "js/reviews.js"].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), s, { filename: f }));

const D = s.DATA, RE = s.ReviewEngine;

const places = D.PLACES.map(p => ({
  id: p.id, name: p.name, region: p.region, corridor: p.corridor,
  category: p.category, subCategory: p.subCategory, lat: p.lat, lng: p.lng,
  indoor: p.indoor, partialIndoor: p.partialIndoor, inland: p.inland, peninsula: p.peninsula,
  rainFriendly: p.rainFriendly, heavyRainFriendly: p.heavyRainFriendly, windFriendly: p.windFriendly,
  parking: p.parking, openingHours: p.openingHours, closedDays: p.closedDays,
  recommendedStayMinutes: p.stayMin, scenic: p.scenic, driveValue: p.driveValue,
  demoRecent: p.demoRecent, weatherProfile: p.weatherProfile, note: p.note,
  demo: true, sources: []
}));

fs.writeFileSync(path.join(ROOT, "data/places.json"), JSON.stringify({
  source: "demo",
  note: "내장 DEMO 데이터 내보내기. 실운영 시 대한민국 구석구석 / 한국관광공사 TourAPI 결과로 교체하고 source 를 'live' 로 바꾸면 앱이 병합합니다.",
  dataBaseline: s.CONFIG.DATA_BASELINE,
  count: places.length,
  places
}, null, 2));

fs.writeFileSync(path.join(ROOT, "data/reviews.json"), JSON.stringify({
  source: "demo",
  note: "실제 방문자 후기는 포함하지 않습니다. signals 는 장소 유형/주차/접근성에서 파생한 구조적 지표입니다. 실 연동 시 각 항목의 rawReviews 를 [{text,url,source,publishedAt}] 로 채우십시오.",
  adKeywords: RE.AD_KEYWORDS,
  trustBonusKeywords: RE.TRUST_BONUS_KEYWORDS,
  perPlace: D.PLACES.map(p => ({
    placeId: p.id,
    signals: RE.signals(p),
    summary: RE.summarize(p).text,
    reviewNote: RE.summarize(p).reviewNote,
    rawReviews: []
  }))
}, null, 2));

const indoorPlaces = places.filter(p =>
  p.indoor || ["INDOOR_ATTRACTION", "MUSEUM", "EXHIBITION", "AQUARIUM", "MARKET"].includes(p.category));
fs.writeFileSync(path.join(ROOT, "data/indoor-attractions.json"), JSON.stringify({
  source: "demo",
  note: "우천 대응 실내 볼거리 후보. category 가 INDOOR_ATTRACTION/MUSEUM/EXHIBITION/AQUARIUM/MARKET 이거나 indoor=true 인 장소.",
  count: indoorPlaces.length,
  places: indoorPlaces
}, null, 2));

console.log("exported: places", places.length, "· indoor", indoorPlaces.length);
