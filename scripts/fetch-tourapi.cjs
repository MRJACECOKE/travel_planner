/* =============================================================
   scripts/fetch-tourapi.cjs
   한국관광공사 TourAPI(대한민국 구석구석 데이터)로 data/places.json 을 갱신합니다.
   백엔드 없이 "로컬에서 한 번 수집 -> 정적 파일로 동결" 하는 방식입니다.

   준비:
   1) https://www.data.go.kr 회원가입(무료)
   2) "한국관광공사_국문 관광정보 서비스" (TourAPI) 활용신청 -> 자동승인
      (구버전 KorService1 은 폐기됨. 이 스크립트는 신버전 KorService2 를 사용)
   3) 마이페이지 > 오픈API > 인증키(Encoding 또는 Decoding, 자동 판별) 확인

   실행:
   node scripts/fetch-tourapi.cjs --key="발급받은키"                (기본: 지역/유형당 30건)
   node scripts/fetch-tourapi.cjs --key="..." --rows=100            (더 넓게 수집)
   node scripts/fetch-tourapi.cjs --key="..." --details --rows=12   (운영시간/주차까지, 호출 절약)
   또는  $env:TOUR_API_KEY="..." 후  node scripts/fetch-tourapi.cjs

   --details : 장소마다 detailIntro2 를 1회 더 호출해 운영시간/주차 정보를 채웁니다.
              무료 한도 1,000회/일 → 장소가 많으면 --rows 를 낮추거나 data.go.kr 에서 트래픽 증량 신청.
              한도 초과(오류 22) 시엔 그때까지 모은 결과를 저장하고 중단합니다.

   결과: data/places.json 을 source:"live" 로 덮어씁니다(최초 1회 data/places.demo.json 로 백업).
   앱은 다음 로드 시 내장 큐레이션 장소에 이 데이터를 병합합니다.
   ============================================================= */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
var RAW_KEY = args.key || process.env.TOUR_API_KEY;
const ROWS = parseInt(args.rows || "30", 10);
const WITH_DETAILS = !!args.details;

if (!RAW_KEY) {
  console.error("인증키가 필요합니다.  node scripts/fetch-tourapi.cjs --key=\"발급키\"   (또는 TOUR_API_KEY 환경변수)");
  process.exit(1);
}
// 공공데이터포털은 Encoding 키(%2B..)와 Decoding 키(+ / =) 두 가지를 줍니다.
// 이미 퍼센트 인코딩된 키면 그대로, 아니면 URL 인코딩해서 사용합니다.
const KEY = /%[0-9A-Fa-f]{2}/.test(RAW_KEY) ? RAW_KEY : encodeURIComponent(RAW_KEY);
console.log("인증키 형식:", /%[0-9A-Fa-f]{2}/.test(RAW_KEY) ? "Encoding(그대로 사용)" : "Decoding(URL 인코딩 적용)");
if (typeof fetch !== "function") {
  console.error("Node 18+ 가 필요합니다(전역 fetch).");
  process.exit(1);
}

// 한국관광공사 TourAPI 는 KorService1 이 폐기되고 KorService2 로 이관되었습니다.
// (신규 발급 키는 KorService2 에서만 동작)
const BASE = process.env.TOUR_API_BASE || "https://apis.data.go.kr/B551011/KorService2";
const OP_LIST = "areaBasedList2";
const OP_AREACODE = "areaCode2";
const OP_INTRO = "detailIntro2";
const COMMON = "&MobileOS=ETC&MobileApp=donghae&_type=json";

// 지역 -> 관광공사 areaCode (강원=32, 경상북도=35)
const REGIONS = [
  { name: "경주", areaCode: 35 }, { name: "포항", areaCode: 35 },
  { name: "영덕", areaCode: 35 }, { name: "울진", areaCode: 35 },
  { name: "삼척", areaCode: 32 }, { name: "동해", areaCode: 32 },
  { name: "강릉", areaCode: 32 }, { name: "양양", areaCode: 32 },
  { name: "속초", areaCode: 32 }, { name: "고성", areaCode: 32 }
];

// contentTypeId -> 기본 카테고리
const CONTENT_TYPES = [
  { id: 12, category: "OUTDOOR_ATTRACTION" }, // 관광지
  { id: 14, category: "MUSEUM", indoor: true }, // 문화시설
  { id: 28, category: "WALK" },               // 레포츠
  { id: 39, category: "FOOD" },               // 음식점
  { id: 38, category: "MARKET" }              // 쇼핑
];

// cat3 코드 -> 세분화 카테고리 (있으면 contentType 기본값보다 우선)
const CAT3_MAP = {
  "A05020900": "CAFE",
  "A01011200": "BEACH",
  "A01011100": "COAST", "A01011300": "COAST", "A01011400": "COAST", "A01011600": "COAST",
  "A01010700": "WALK", "A01010800": "WALK", "A01010900": "WALK", "A01011700": "WALK",
  "A02050200": "OBSERVATORY",
  "A02060100": "MUSEUM", "A02060500": "MUSEUM",
  "A02060200": "EXHIBITION", "A02060300": "EXHIBITION", "A02061100": "EXHIBITION",
  "A04010100": "MARKET", "A04010200": "MARKET",
  "A03022700": "AQUARIUM"
};

// 카테고리별 기상 프로파일 키 / 실내성 / 기본 체류시간 (data.js 의 WP 프리셋과 동일 이름)
const CAT_META = {
  OUTDOOR_ATTRACTION: { wpKey: "outdoorAttraction", stay: 70, scenic: 62 },
  INDOOR_ATTRACTION: { wpKey: "indoorStrong", indoor: true, stay: 70, scenic: 50 },
  MUSEUM: { wpKey: "indoorStrong", indoor: true, stay: 70, scenic: 45 },
  EXHIBITION: { wpKey: "indoorStrong", indoor: true, stay: 60, scenic: 45 },
  AQUARIUM: { wpKey: "indoorStrong", indoor: true, stay: 80, scenic: 50 },
  MARKET: { wpKey: "marketArcade", partialIndoor: true, stay: 60, scenic: 30 },
  FOOD: { wpKey: "foodIndoor", partialIndoor: true, stay: 60, scenic: 35 },
  CAFE: { wpKey: "cafeOceanIndoor", partialIndoor: true, stay: 60, scenic: 65 },
  OBSERVATORY: { wpKey: "observatoryExposed", stay: 45, scenic: 78 },
  BEACH: { wpKey: "beach", stay: 60, scenic: 68 },
  COAST: { wpKey: "coastExposed", stay: 45, scenic: 74 },
  WALK: { wpKey: "walkShort", stay: 70, scenic: 66 },
  PHOTO_SPOT: { wpKey: "coastExposed", stay: 40, scenic: 72 }
};

function corridorFromLat(lat) {
  const c = (lat - 35.60) / (38.60 - 35.60) * 92 + 10;
  return Math.round(c * 10) / 10;
}
function pk(diff) { return { available: true, difficulty: diff || "normal", covered: false, note: "" }; }

var FIRST_CALL = true;
function maskKey(u) {
  return u.replace(/serviceKey=([^&]{0,8})[^&]*/, function (_, head) { return "serviceKey=" + head + "...(마스킹)"; });
}

async function getJson(url) {
  const r = await fetch(url, { headers: { "Accept": "application/json" } });
  const txt = await r.text();
  if (FIRST_CALL) {
    FIRST_CALL = false;
    console.log("\n[진단] 첫 요청 URL:", maskKey(url));
    console.log("[진단] HTTP 상태:", r.status);
    console.log("[진단] 응답 앞부분:", txt.slice(0, 400).replace(/\s+/g, " "));
    console.log("");
  }
  let j = null;
  try { j = JSON.parse(txt); } catch (e) { /* XML 등 */ }
  // 게이트웨이 레벨 오류 (인증/서비스 경로 문제)
  var gw = j && (j.OpenAPI_ServiceResponse || j.OpenApi_ServiceResponse);
  if (gw && gw.cmmMsgHeader) {
    throw new Error("게이트웨이 오류 " + gw.cmmMsgHeader.returnReasonCode + " " + gw.cmmMsgHeader.errMsg +
      " (" + gw.cmmMsgHeader.returnAuthMsg + ")");
  }
  if (!r.ok) throw new Error("HTTP " + r.status + " " + txt.slice(0, 160));
  if (!j) throw new Error("응답 파싱 실패: " + txt.slice(0, 160));
  const header = j.response && j.response.header;
  if (header && header.resultCode && String(header.resultCode) !== "0000") {
    throw new Error("TourAPI 오류 " + header.resultCode + " " + header.resultMsg);
  }
  const body = j.response && j.response.body;
  let items = body && body.items;
  if (items && typeof items === "object" && items.item) items = items.item;
  if (typeof items === "string") items = [];
  var arr = items ? (Array.isArray(items) ? items : [items]) : [];
  arr._totalCount = body && body.totalCount;
  return arr;
}

async function fetchSigungu(areaCode) {
  const url = BASE + "/" + OP_AREACODE + "?serviceKey=" + KEY + COMMON +
    "&numOfRows=100&pageNo=1&areaCode=" + areaCode;
  try { return await getJson(url); } catch (e) { console.warn("  ! areaCode2(" + areaCode + "): " + e.message); return []; }
}

var QUOTA_HIT = false;
function isQuota(msg) { return /오류 22|LIMITED_NUMBER_OF_SERVICE_REQUESTS/.test(msg || ""); }

async function detailIntro(contentId, contentTypeId) {
  if (QUOTA_HIT) return null;
  const url = BASE + "/" + OP_INTRO + "?serviceKey=" + KEY + COMMON +
    "&contentId=" + contentId + "&contentTypeId=" + contentTypeId;
  try {
    const it = (await getJson(url))[0] || {};
    // 필드명이 contentType 별로 다름 - 흔한 것만 추출
    const hours = it.usetime || it.opentime || it.usetimeculture || it.opentimefood || "";
    const rest = it.restdate || it.restdateculture || it.restdatefood || "";
    const parking = it.parking || it.parkingculture || it.parkingfood || it.parkinglodging || "";
    return {
      openingHours: cleanHours(hours),
      closedDays: rest ? [] : [],
      parkingText: strip(parking)
    };
  } catch (e) { if (isQuota(e.message)) QUOTA_HIT = true; return null; }
}

function strip(s) { return String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(); }
function cleanHours(s) {
  s = strip(s);
  const m = /(\d{1,2}:\d{2})\s*[-~]\s*(\d{1,2}:\d{2})/.exec(s);
  return m ? (m[1] + "-" + m[2]) : "상시";
}

(async () => {
  const out = [];
  const seen = new Set();

  // 1) 지역명 -> 시군구 코드 매핑 (강원 32 / 경북 35)
  console.log("시군구 코드 조회...");
  const sigunguByRegion = {};
  for (const areaCode of [32, 35]) {
    const list = await fetchSigungu(areaCode);
    list.forEach(function (s) {
      const nm = strip(s.name);
      REGIONS.forEach(function (rg) {
        if (rg.areaCode === areaCode && (nm.indexOf(rg.name) === 0 || nm === rg.name)) {
          sigunguByRegion[rg.name] = { areaCode: areaCode, sigunguCode: s.code };
        }
      });
    });
  }
  const mapped = Object.keys(sigunguByRegion);
  console.log("  매핑됨:", mapped.length ? mapped.map(function (k) { return k + "=" + sigunguByRegion[k].sigunguCode; }).join(", ") : "(없음)");
  if (!mapped.length) {
    console.error("\n시군구 코드를 하나도 못 받았습니다. 위 [진단] 응답을 확인하십시오(키 승인/서비스 확인).");
    process.exit(1);
  }

  if (WITH_DETAILS) {
    console.log("\n--details: 장소마다 detailIntro2 를 1회 더 호출합니다. 무료 1,000회/일 한도에 유의하세요.");
    console.log("  · 한도가 걱정되면 --rows=12 처럼 낮춰 부분 수집하거나, data.go.kr 에서 트래픽 증량 신청 후 재실행.\n");
  }

  for (const rg of REGIONS) {
    if (QUOTA_HIT) break;
    const sg = sigunguByRegion[rg.name];
    if (!sg) { console.warn("  ! " + rg.name + ": 시군구 코드 미확인 - 건너뜀"); continue; }
    for (const ct of CONTENT_TYPES) {
      if (QUOTA_HIT) break;
      const url = BASE + "/" + OP_LIST + "?serviceKey=" + KEY + COMMON +
        "&numOfRows=" + ROWS + "&pageNo=1&arrange=A" +
        "&contentTypeId=" + ct.id + "&areaCode=" + sg.areaCode + "&sigunguCode=" + sg.sigunguCode;
      let items = [];
      try { items = await getJson(url); }
      catch (e) {
        console.warn("  ! " + rg.name + "/" + ct.id + ": " + e.message);
        if (isQuota(e.message)) { QUOTA_HIT = true; break; }
        if (!out.length && /게이트웨이 오류|HTTP 4|응답 파싱/.test(e.message)) {
          console.error("\n첫 요청부터 실패하여 중단합니다. 원인:");
          console.error("  - '...오류 30 SERVICE_KEY_IS_NOT_REGISTERED' : 키가 등록/승인되지 않음.");
          console.error("    · data.go.kr 마이페이지 > 오픈API > 개발계정 상세 에서 '승인' 상태인지, ");
          console.error("      그 화면의 '일반 인증키(Decoding)' 값을 정확히 복사했는지 확인.");
          console.error("    · 활용신청 직후면 반영까지 최대 1시간 걸립니다.");
          console.error("  - '...오류 20' : 서비스 승인 대기/거부.");
          console.error("  - '...오류 22' : 일 트래픽 초과 → 내일 재시도.");
          console.error("  - 'HTTP 500 / SERVICE ERROR' 가 뜨면 잠시 후 재시도.");
          process.exit(1);
        }
        continue;
      }

      const before = out.length;
      for (const it of items) {
        const lat = parseFloat(it.mapy), lng = parseFloat(it.mapx);
        if (!lat || !lng) continue;
        const id = "tour-" + it.contentid;
        if (seen.has(id)) continue;
        seen.add(id);

        const category = CAT3_MAP[strip(it.cat3)] || ct.category;
        const meta = CAT_META[category] || CAT_META.OUTDOOR_ATTRACTION;
        const hasImg = !!strip(it.firstimage);

        const rec = {
          id: id,
          name: strip(it.title),
          region: rg.name,
          corridor: corridorFromLat(lat),
          category: category,
          subCategory: strip(it.cat3 || it.cat2 || ""),
          lat: lat, lng: lng,
          indoor: !!meta.indoor,
          partialIndoor: !!meta.partialIndoor,
          wpKey: meta.wpKey,
          stayMin: meta.stay,
          scenic: meta.scenic,
          driveValue: category === "COAST" || category === "OBSERVATORY" ? 24 : 15,
          demoRecent: 50 + (hasImg ? 8 : 0),
          parking: pk("normal"),
          openingHours: "상시",
          closedDays: [],
          note: "",
          sources: [{ name: "한국관광공사 TourAPI", contentId: it.contentid, tel: strip(it.tel || "") }]
        };

        if (WITH_DETAILS) {
          const d = await detailIntro(it.contentid, ct.id);
          if (d) {
            rec.openingHours = d.openingHours;
            if (/무료|가능|있음|완비/.test(d.parkingText)) rec.parking = pk("easy");
            else if (/불가|없음|주변|협소/.test(d.parkingText)) rec.parking = pk("hard");
          }
          await new Promise(r => setTimeout(r, 120)); // rate limit 완화
        }
        out.push(rec);
      }
      console.log("  " + rg.name + " / type " + ct.id +
        " : API " + (items._totalCount != null ? items._totalCount : items.length) + "건 -> 채택 " + (out.length - before) + " (누적 " + out.length + ")");
    }
  }

  if (!out.length) {
    console.error("\n수집 결과가 0건입니다.");
    console.error("  · 각 줄의 'API N건' 이 0 이면: 키는 유효하지만 해당 시군구에 결과가 없다는 뜻입니다(드묾).");
    console.error("    맨 위 [진단] 응답 앞부분을 그대로 공유해 주십시오.");
    console.error("  · 'API N건' 이 0 이 아닌데 '채택 0' 이면: 좌표(mapx/mapy) 없는 항목만 온 것. --rows 를 늘려 재시도.");
    console.error("  · '게이트웨이 오류 30' : 키 미승인/오타(발급 직후 최대 1시간).  '오류 20' : 승인 대기/거부.  '오류 22' : 일 1,000회 초과.");
    process.exit(1);
  }
  if (QUOTA_HIT) {
    console.warn("\n[주의] 일 트래픽 한도(오류 22)에 도달해 수집을 중단했습니다.");
    console.warn("  여기까지 모은 " + out.length + "곳은 저장합니다. 내일 다시 실행하거나, data.go.kr 에서 트래픽 증량 신청 후 재실행하세요.");
  }

  // DEMO 백업 후 덮어쓰기
  const target = path.join(ROOT, "data/places.json");
  if (fs.existsSync(target) && !fs.existsSync(path.join(ROOT, "data/places.demo.json"))) {
    fs.copyFileSync(target, path.join(ROOT, "data/places.demo.json"));
    console.log("\n기존 DEMO 데이터를 data/places.demo.json 로 백업했습니다.");
  }
  fs.writeFileSync(target, JSON.stringify({
    source: "live",
    note: "한국관광공사 TourAPI 로 수집한 실데이터. 앱이 자동 병합합니다. weatherProfile/corridor 는 카테고리 추정값이므로 필요 시 수동 보정하십시오.",
    collectedAt: new Date().toISOString(),
    count: out.length,
    places: out
  }, null, 2));
  console.log("\n완료: data/places.json (" + out.length + "곳, source=live). 앱을 새로고침하면 병합됩니다.");
})().catch(e => { console.error(e); process.exit(1); });
