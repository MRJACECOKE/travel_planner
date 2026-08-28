/* =============================================================
   verify-planner-donghae.cjs
   동해안 드라이브 여행 플래너 정적/로직 검증.
   실행: node tests/verify-planner-donghae.cjs
   ============================================================= */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
}
function section(t) { console.log("\n== " + t + " =="); }

/* ---------- 브라우저 전역 shim ---------- */
const sandbox = {};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
sandbox.location = { protocol: "http:", search: "", href: "http://localhost/" };
sandbox.console = console;
sandbox.setTimeout = setTimeout;
sandbox.clearTimeout = clearTimeout;
sandbox.fetch = function () { return Promise.reject(new Error("network disabled in test")); };
sandbox.navigator = { userAgent: "node-test" };
sandbox.document = {
  readyState: "complete",
  addEventListener: function () {},
  getElementById: function () { return null; },
  querySelectorAll: function () { return []; },
  createElement: function () { return { style: {}, setAttribute: function () {}, appendChild: function () {} }; },
  head: { appendChild: function () {} }
};
vm.createContext(sandbox);

const FILES = [
  "js/config.js", "js/data.js", "js/reviews.js", "js/weather.js",
  "js/weatherStrategy.js", "js/routeOptimizer.js", "js/recommendation.js", "js/schedule.js"
];

section("모듈 로드 및 구문 검사");
for (const f of FILES) {
  try {
    const code = fs.readFileSync(path.join(ROOT, f), "utf8");
    vm.runInContext(code, sandbox, { filename: f });
    ok("load " + f, true);
  } catch (e) {
    ok("load " + f, false, e.message);
  }
}

const CONFIG = sandbox.CONFIG;
const DATA = sandbox.DATA;
const Weather = sandbox.Weather;
const WS = sandbox.WeatherStrategy;
const Schedule = sandbox.Schedule;
const REC = sandbox.Recommendation;

/* ---------- 데이터 무결성 ---------- */
section("데이터 무결성");
ok("CONFIG.REGION_ORDER 10개", CONFIG.REGION_ORDER.length === 10);
ok("부산/울산은 관광 범위 제외", CONFIG.ORIGIN_ONLY_REGIONS.join() === "부산,울산");
const ids = DATA.PLACES.map(p => p.id);
ok("장소 30곳 이상", DATA.PLACES.length >= 30, DATA.PLACES.length + "곳");
ok("장소 ID 고유", new Set(ids).size === ids.length);
ok("모든 장소가 추천 범위 지역", DATA.PLACES.every(p => CONFIG.REGION_ORDER.indexOf(p.region) >= 0));
ok("부산/울산 관광지 없음", DATA.PLACES.every(p => ["부산", "울산"].indexOf(p.region) < 0));
const cats = new Set(DATA.PLACES.map(p => p.category));
["DRIVE", "INDOOR_ATTRACTION", "OUTDOOR_ATTRACTION", "FOOD", "CAFE", "MARKET", "MUSEUM", "EXHIBITION", "AQUARIUM", "OBSERVATORY", "COAST", "BEACH", "WALK", "PHOTO_SPOT"].forEach(c => {
  ok("카테고리 존재: " + c, cats.has(c));
});
ok("모든 장소 weatherProfile 보유", DATA.PLACES.every(p => p.weatherProfile && typeof p.weatherProfile.rain === "number"));
ok("각 지역에 실내 볼거리 1곳 이상", CONFIG.REGION_ORDER.every(r =>
  DATA.PLACES.some(p => p.region === r && DATA.isIndoorLike(p))));
ok("각 지역에 드라이브 포인트 1곳 이상", CONFIG.REGION_ORDER.every(r =>
  DATA.PLACES.some(p => p.region === r && p.category === "DRIVE")));
ok("각 지역에 맛집 1곳 이상", CONFIG.REGION_ORDER.every(r =>
  DATA.PLACES.some(p => p.region === r && p.category === "FOOD")));
ok("각 지역에 카페 1곳 이상", CONFIG.REGION_ORDER.every(r =>
  DATA.PLACES.some(p => p.region === r && p.category === "CAFE")));
ok("각 지역에 숙박(모텔 중심) 데이터 존재", CONFIG.REGION_ORDER.every(r =>
  (DATA.LODGING[r] || []).length >= 1));
ok("내장 데이터 상태 DEMO 표시", DATA.status === "DEMO");

section("당일치기(1일) 처리");
(function () {
  const oneDay = { originId: "ulsan", startRegion: "포항", endRegion: "영덕", startDate: "2026-08-29", days: 1, startTime: "08:00", endTime: "20:00", prefs: {} };
  const t = Schedule.buildTrip(oneDay, null);
  ok("빌드 성공", t.ok === true);
  ok("당일치기 플래그", t.dayTrip === true);
  ok("숙박 없음", t.lodging.length === 0);
})();

section("data/*.json 파일");
["data/places.json", "data/reviews.json", "data/indoor-attractions.json"].forEach(f => {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
    ok(f + " 유효 JSON · source=demo|live", j.source === "demo" || j.source === "live");
  } catch (e) { ok(f + " 유효 JSON", false, e.message); }
});
try {
  const pj = JSON.parse(fs.readFileSync(path.join(ROOT, "data/places.json"), "utf8"));
  if (pj.source === "demo") {
    ok("places.json(demo) 개수 == 내장 장소 수", pj.places.length === DATA.PLACES.length, pj.places.length + " vs " + DATA.PLACES.length);
  } else {
    ok("places.json(live) 장소 존재 + 필수 필드", pj.places.length > 0 &&
      pj.places.every(p => p.id && p.name && p.region && typeof p.lat === "number" && typeof p.lng === "number" && p.category),
      pj.places.length + "곳");
    ok("places.json(live) 모든 region 이 추천 범위", pj.places.every(p => CONFIG.regionIndex(p.region) >= 0));
  }
} catch (e) { ok("places.json 검사", false, e.message); }

/* ---------- 날씨 엔진 ---------- */
section("다중 날씨 / 예보 일치도");
const regionsAll = CONFIG.REGION_ORDER.map(n => ({ name: n, center: DATA.REGION_META[n].center }));

function build(scenario, input) {
  return Weather.fetchAll(regionsAll, tripDates(input), scenario).then(wd => {
    return { wd, trip: Schedule.buildTrip(input, wd) };
  });
}
function tripDates(input) {
  const arr = [];
  for (let d = 0; d < input.days; d++) {
    const t = new Date(input.startDate + "T12:00:00"); t.setDate(t.getDate() + d);
    arr.push(t.toISOString().slice(0, 10));
  }
  return arr;
}
function classesOf(trip) { return trip.days.map(d => d.weatherClass); }
function countCat(trip, pred) {
  let n = 0; trip.days.forEach(d => d.items.forEach(it => { if (pred(it)) n++; })); return n;
}
function maxBacktrack(trip) {
  const seq = [];
  trip.days.forEach(d => d.items.forEach(it => seq.push(it.corridor)));
  let mb = 0;
  for (let i = 1; i < seq.length; i++) mb = Math.max(mb, seq[i - 1] - seq[i]);
  return mb;
}

const results = {};
const chain = Promise.resolve()
  .then(() => Weather.fetchAll(regionsAll, ["2026-08-29", "2026-08-30"], "disagree"))
  .then(wd => {
    const g = wd.byRegion["강릉"].today;
    ok("예보 불일치 시 uncertain=true", g.uncertain === true, "spread=" + g.agreement.spread);
    ok("예보 불일치 시 신뢰도 낮음", g.confidence === "낮음", g.confidence);
    ok("공급자 3곳 종합", g.providers.length === 3);
    ok("공급자 값이 서로 다름", new Set(g.providers.map(p => p.pop)).size >= 2);
  });

/* ---------- 필수 테스트 A ~ F ---------- */
const A = { originId: "ulsan", startRegion: "포항", endRegion: "강릉", startDate: "2026-08-29", days: 4, startTime: "08:30", endTime: "18:00", prefs: {} };
const B = { originId: "ulsan", startRegion: "포항", endRegion: "강릉", startDate: "2026-08-29", days: 4, startTime: "08:30", endTime: "18:00", prefs: {} };
const E = { originId: "seoul", startRegion: "강릉", endRegion: "고성", startDate: "2026-08-29", days: 3, startTime: "09:00", endTime: "17:00", prefs: {} };
const F = { originId: "daegu", startRegion: "경주", endRegion: "속초", startDate: "2026-08-29", days: 5, startTime: "08:00", endTime: "18:00", prefs: {} };

chain
  .then(() => build("clear", A))
  .then(({ trip }) => {
    section("테스트 A - 기본 북상 (맑음)");
    ok("빌드 성공", trip.ok === true, JSON.stringify(trip.errors || []));
    ok("방향 감지 = 북상", trip.dir === "north");
    const regionSeq = [];
    trip.days.forEach(d => d.regions.forEach(r => { if (regionSeq[regionSeq.length - 1] !== r) regionSeq.push(r); }));
    const idxSeq = regionSeq.map(r => CONFIG.regionIndex(r));
    ok("지역 인덱스 단조 비감소", idxSeq.every((v, i) => i === 0 || v >= idxSeq[i - 1]), idxSeq.join("→"));
    ok("역주행(회랑 후퇴) 8 이하", maxBacktrack(trip) <= 8, "max=" + maxBacktrack(trip).toFixed(1));
    ok("부산/울산 관광지 미포함", trip.days.every(d => d.items.every(it => ["부산", "울산"].indexOf(it.region) < 0)));
    ok("경주~강릉 범위만 포함", trip.days.every(d => d.items.every(it => {
      const i = CONFIG.regionIndex(it.region);
      return i >= CONFIG.regionIndex("포항") && i <= CONFIG.regionIndex("강릉");
    })));
    ok("각 DAY 이동시간/체류시간 계산됨", trip.days.every(d => d.items.every(it => it.travelMin >= 0 && it.stayMin > 0 && /^\d\d:\d\d$/.test(it.arrive))));
    ok("운영시간 종료된 실내 시설은 일정에 없음", trip.days.every(d => d.items.every(it => {
      var fixed = it.category === "DRIVE" || it.openingHours === "상시" || it.openingHours === "24시간";
      return fixed || it.open;
    })), trip.days.flatMap(d => d.items.filter(it => !it.open && it.category !== "DRIVE" && it.openingHours !== "상시").map(it => it.name + "@" + it.arrive)).join(", "));
    ok("추가 우회시간 값 존재", trip.days.every(d => d.items.every(it => typeof it.detourMin === "number")));
    ok("당일치기 아님 표시", trip.dayTrip === false);
    ok("출발지→첫목적지 경로(departure) 존재", !!trip.departure && trip.departure.originName === "울산" &&
      trip.departure.min > 0 && trip.departure.km > 0, JSON.stringify(trip.departure && { o: trip.departure.originName, m: trip.departure.min }));
    ok("네이버 길찾기 딥링크 형식", !!trip.departure && /^https:\/\/map\.naver\.com\/p\/directions\//.test(trip.departure.naverDirections));
    ok("숙박 밤 수 = 여행일수 - 1", trip.lodging.length === trip.days.length - 1, trip.lodging.length + " vs " + (trip.days.length - 1));
    ok("숙박에 autoRegion 기록", trip.lodging.every(lo => CONFIG.regionIndex(lo.autoRegion) >= 0));
    ok("각 숙박에 지역과 모텔 추천 존재", trip.lodging.every(lo =>
      CONFIG.regionIndex(lo.region) >= 0 && lo.options.length >= 1 && lo.lodgingType.indexOf("모텔") >= 0 &&
      lo.options.every(o => /map\.naver\.com/.test(o.naverUrl) && /모텔/.test(decodeURIComponent(o.naverUrl)))));
    ok("마지막 날은 숙박 없음(여행 종료)", trip.days[trip.days.length - 1].lodging.isLastDay === true);
    results.A_clear = trip;
  })
  .then(() => build("rain", B))
  .then(({ trip }) => {
    section("테스트 B - 우천 대응");
    const clear = results.A_clear;
    const rIndoor = countCat(trip, it => it.indoorLike);
    const cIndoor = countCat(clear, it => it.indoorLike);
    const rBeachWalk = countCat(trip, it => ["BEACH", "WALK"].indexOf(it.category) >= 0);
    const cBeachWalk = countCat(clear, it => ["BEACH", "WALK"].indexOf(it.category) >= 0);
    const rDrive = countCat(trip, it => it.category === "DRIVE");
    const cDrive = countCat(clear, it => it.category === "DRIVE");
    ok("우천 시 실내 볼거리 증가(또는 동등)", rIndoor >= cIndoor && rIndoor >= 2, "rain=" + rIndoor + " clear=" + cIndoor);
    ok("우천 시 해변/산책 감소(또는 동등)", rBeachWalk <= cBeachWalk, "rain=" + rBeachWalk + " clear=" + cBeachWalk);
    ok("우천 시 드라이브 비중 유지·강화(붕괴 아님)", rDrive >= cDrive - 1 && rDrive >= 2, "rain=" + rDrive + " clear=" + cDrive);
    ok("우천 대응 DAY 플래그 존재", trip.days.some(d => d.rainAdaptive));
    ok("우천 경고 근거(강수확률) 존재", trip.days.some(d => d.weather && d.weather.agreement && d.weather.agreement.mean >= 50));
    ok("북상 방향 유지", maxBacktrack(trip) <= 8, "max=" + maxBacktrack(trip).toFixed(1));
    ok("실내 관광지 카드가 일정에 포함", trip.days.some(d => d.items.some(it => it.indoorLike)));
    ok("추천 이유에 우천 관련 문구", trip.days.some(d => d.items.some(it => (it.reasons || []).some(x => /비|우천|실내|드라이브/.test(x)))));
  })
  .then(() => build("heavy-rain", B))
  .then(({ trip }) => {
    section("테스트 C - 폭우/강풍");
    ok("강한 비/강풍 DAY 감지", trip.days.some(d => d.weatherClass === "HEAVY_RAIN" || d.windDanger));
    const exposedScheduled = [];
    trip.days.forEach(d => d.items.forEach(it => {
      const exposed = ["BEACH", "COAST", "PHOTO_SPOT", "WALK"].indexOf(it.category) >= 0 ||
        (it.category === "OBSERVATORY" && !it.partialIndoor);
      if (exposed) exposedScheduled.push(it);
    }));
    ok("노출 야외는 제외되거나 체류 축소됨", exposedScheduled.every(it => it.weatherAction === "shortened" || it.weatherFit >= 40),
      exposedScheduled.filter(it => it.weatherAction !== "shortened" && it.weatherFit < 40).map(it => it.name).join(", "));
    ok("실내 볼거리 우선(비중 >= 드라이브+야외 중 하나)", countCat(trip, it => it.indoorLike) >= 2);
    ok("우천 재구성 노트 존재", trip.days.some(d => (d.rebuildNotes || []).length > 0) || trip.days.some(d => d.rainAdaptive));
    ok("안전/우천 경고 표시 근거", trip.days.some(d => d.rainAdaptive || d.windDanger));
    ok("북상 방향 유지", maxBacktrack(trip) <= 8, "max=" + maxBacktrack(trip).toFixed(1));
  })
  .then(() => build("clear", E))
  .then(({ trip }) => {
    section("테스트 E - 서울 출발 (강릉→고성)");
    ok("빌드 성공", trip.ok === true);
    ok("경북 지역 추천 없음", trip.days.every(d => d.items.every(it =>
      CONFIG.regionIndex(it.region) >= CONFIG.regionIndex("강릉"))),
      trip.days.flatMap(d => d.items.map(it => it.region)).join(","));
    ok("강릉→양양→속초→고성 방향", maxBacktrack(trip) <= 8);
  })
  .then(() => build("clear", F))
  .then(({ trip }) => {
    section("테스트 F - 범위 제한 (경주→속초)");
    ok("빌드 성공", trip.ok === true);
    ok("고성 추천 없음", trip.days.every(d => d.items.every(it => it.region !== "고성")));
    ok("경주~속초 범위만", trip.days.every(d => d.items.every(it =>
      CONFIG.regionIndex(it.region) <= CONFIG.regionIndex("속초"))));
  })
  .then(() => {
    section("정적 파일 검사");
    const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    ok("charset utf-8 선언", /<meta\s+charset=["']?utf-8/i.test(html));
    ok("다크 모드 미구현", !/prefers-color-scheme\s*:\s*dark/i.test(html) && !/data-theme/i.test(html));
    const styleCss = fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8");
    ok("light only 명시", /color-scheme[":\s]+light/i.test(html) || /color-scheme\s*:\s*light/i.test(styleCss));
    ["config", "data", "reviews", "weather", "weatherStrategy", "routeOptimizer", "recommendation", "schedule", "map", "ui", "app"].forEach(m => {
      ok("스크립트 포함: js/" + m + ".js", html.indexOf("js/" + m + ".js") >= 0);
    });
    const openDiv = (html.match(/<div\b/g) || []).length, closeDiv = (html.match(/<\/div>/g) || []).length;
    ok("div 태그 균형", openDiv === closeDiv, openDiv + " vs " + closeDiv);
    const openSec = (html.match(/<section\b/g) || []).length, closeSec = (html.match(/<\/section>/g) || []).length;
    ok("section 태그 균형", openSec === closeSec, openSec + " vs " + closeSec);
    for (const cf of ["css/style.css", "css/responsive.css"]) {
      const css = fs.readFileSync(path.join(ROOT, cf), "utf8");
      ok(cf + " 중괄호 균형", (css.match(/{/g) || []).length === (css.match(/}/g) || []).length);
      ok(cf + " 다크모드 없음", !/prefers-color-scheme\s*:\s*dark/i.test(css));
    }
    ok("맑은 고딕 글꼴 사용", /Malgun Gothic|맑은 고딕/.test(fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8")));
  })
  .then(() => {
    console.log("\n----------------------------------------");
    console.log("결과: " + pass + " PASS / " + fail + " FAIL");
    process.exit(fail ? 1 : 0);
  })
  .catch(e => {
    console.error("\n테스트 실행 오류:", e);
    process.exit(1);
  });
