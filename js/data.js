/* =============================================================
   data.js - 관광 데이터 모델 + 내장 DEMO 데이터
   -------------------------------------------------------------
   - 모든 내장 장소는 DEMO DATA 입니다. 좌표/유형/운영시간은
     공개된 일반 정보를 참고한 대표값이며, 실운영 전에는
     대한민국 구석구석 / 한국관광공사 TourAPI 연동으로 교체합니다.
   - "최근 후기" 성격의 문장은 임의로 생성하지 않습니다.
     demoRecent 는 실제 방문자 수가 아닌 DEMO 관심도 지표입니다.
   - 카테고리: DRIVE, INDOOR_ATTRACTION, OUTDOOR_ATTRACTION, FOOD,
     CAFE, MARKET, MUSEUM, EXHIBITION, AQUARIUM, OBSERVATORY,
     COAST, BEACH, WALK, PHOTO_SPOT
   ============================================================= */
(function (global) {
  "use strict";

  /* 카테고리별 기상 적합도 프로파일 (0-100). 값이 높을수록 그 날씨에서 방문 가치가 유지됩니다. */
  var WP = {
    indoorStrong:      { clear: 78, lightRain: 96, rain: 100, heavyRain: 96, strongWind: 96 },
    marketArcade:      { clear: 74, lightRain: 92, rain: 96,  heavyRain: 90, strongWind: 90 },
    foodIndoor:        { clear: 80, lightRain: 90, rain: 94,  heavyRain: 86, strongWind: 86 },
    cafeOceanIndoor:   { clear: 82, lightRain: 92, rain: 96,  heavyRain: 86, strongWind: 84 },
    observatoryIndoor: { clear: 86, lightRain: 88, rain: 90,  heavyRain: 78, strongWind: 74 },
    coastalDrive:      { clear: 90, lightRain: 82, rain: 64,  heavyRain: 30, strongWind: 26 },
    inlandDrive:       { clear: 80, lightRain: 80, rain: 72,  heavyRain: 54, strongWind: 52 },
    outdoorAttraction: { clear: 92, lightRain: 60, rain: 36,  heavyRain: 16, strongWind: 20 },
    walkShort:         { clear: 92, lightRain: 60, rain: 38,  heavyRain: 18, strongWind: 22 },
    walkLong:          { clear: 94, lightRain: 42, rain: 18,  heavyRain: 6,  strongWind: 10 },
    beach:             { clear: 96, lightRain: 50, rain: 22,  heavyRain: 8,  strongWind: 12 },
    coastExposed:      { clear: 95, lightRain: 54, rain: 26,  heavyRain: 10, strongWind: 10 },
    observatoryExposed:{ clear: 94, lightRain: 46, rain: 22,  heavyRain: 8,  strongWind: 6 }
  };

  function pk(difficulty, covered, note) {
    return { available: true, difficulty: difficulty || "normal", covered: !!covered, note: note || "" };
  }

  /* 장소 레코드 기본값 채우기 */
  function P(o) {
    o.demo = true;
    o.sources = [];
    o.subCategory = o.subCategory || "";
    o.indoor = !!o.indoor;
    // 맛집·카페는 별도 표기가 없으면 실내(착석) 시설로 간주 (실내 볼거리 분류와는 무관)
    if ((o.category === "CAFE" || o.category === "FOOD") && !o.indoor && o.partialIndoor == null) o.partialIndoor = true;
    o.partialIndoor = !!o.partialIndoor;
    o.inland = !!o.inland;
    o.peninsula = !!o.peninsula;
    o.note = o.note || "";
    o.openingHours = o.openingHours || "상시";
    o.closedDays = o.closedDays || [];        // 0=일 .. 6=토
    o.stayMin = o.stayMin || 60;
    o.scenic = (o.scenic == null) ? 60 : o.scenic;
    o.driveValue = (o.driveValue == null) ? 18 : o.driveValue;
    o.demoRecent = (o.demoRecent == null) ? 60 : o.demoRecent; // DEMO 관심도(실측 방문자 수 아님)
    o.parking = o.parking || pk("normal", false, "");
    var base = WP[o.wpKey] || WP.outdoorAttraction;
    o.weatherProfile = {
      clear: base.clear, lightRain: base.lightRain, rain: base.rain,
      heavyRain: base.heavyRain, strongWind: base.strongWind
    };
    if (o.wpOverride) {
      for (var k in o.wpOverride) { if (o.wpOverride.hasOwnProperty(k)) o.weatherProfile[k] = o.wpOverride[k]; }
    }
    o.rainFriendly = o.weatherProfile.rain >= 70;
    o.heavyRainFriendly = o.weatherProfile.heavyRain >= 70;
    o.windFriendly = o.weatherProfile.strongWind >= 70;
    return o;
  }

  var REGION_META = {
    "경주": { center: [35.75, 129.50], hub: "감포·양남 해안" },
    "포항": { center: [36.03, 129.37], hub: "영일만·호미곶" },
    "영덕": { center: [36.41, 129.40], hub: "강구항·해맞이공원" },
    "울진": { center: [36.99, 129.40], hub: "죽변·왕피천" },
    "삼척": { center: [37.44, 129.17], hub: "장호·죽서루" },
    "동해": { center: [37.52, 129.11], hub: "묵호·추암" },
    "강릉": { center: [37.77, 128.90], hub: "경포·안목" },
    "양양": { center: [38.08, 128.62], hub: "하조대·낙산" },
    "속초": { center: [38.20, 128.59], hub: "속초항·설악" },
    "고성": { center: [38.40, 128.47], hub: "화진포·통일전망대" }
  };

  /* 출발지 (관광 후보 아님). corridorRef 는 회랑상 진입 위치 근사값. */
  var ORIGINS = [
    { id: "busan",    name: "부산",  lat: 35.1796, lng: 129.0756, corridorRef: 4,  approach: "expressway" },
    { id: "ulsan",    name: "울산",  lat: 35.5384, lng: 129.3114, corridorRef: 7,  approach: "national" },
    { id: "daegu",    name: "대구",  lat: 35.8714, lng: 128.6014, corridorRef: 16, approach: "expressway" },
    { id: "andong",   name: "안동",  lat: 36.5684, lng: 128.7294, corridorRef: 30, approach: "national" },
    { id: "daejeon",  name: "대전",  lat: 36.3504, lng: 127.3845, corridorRef: 24, approach: "expressway" },
    { id: "cheongju", name: "청주",  lat: 36.6424, lng: 127.4890, corridorRef: 24, approach: "expressway" },
    { id: "wonju",    name: "원주",  lat: 37.3422, lng: 127.9202, corridorRef: 66, approach: "expressway" },
    { id: "chuncheon",name: "춘천",  lat: 37.8813, lng: 127.7300, corridorRef: 88, approach: "expressway" },
    { id: "seoul",    name: "서울",  lat: 37.5665, lng: 126.9780, corridorRef: 66, approach: "expressway" },
    { id: "gangneung",name: "강릉",  lat: 37.7519, lng: 128.8761, corridorRef: 68, approach: "national" }
  ];

  var PLACES = [
    /* ---------------- 경주 (동해안 구간) ---------------- */
    P({ id: "gj-jusangjeolli", name: "양남 주상절리군", region: "경주", corridor: 10.0, category: "COAST", subCategory: "지질명소", lat: 35.6640, lng: 129.4703, wpKey: "coastExposed", stayMin: 45, scenic: 84, driveValue: 60, demoRecent: 70, parking: pk("normal", false) }),
    P({ id: "gj-eupcheon", name: "읍천항 벽화마을", region: "경주", corridor: 10.5, category: "WALK", subCategory: "항구산책", lat: 35.6717, lng: 129.4720, wpKey: "walkShort", stayMin: 40, scenic: 62, driveValue: 30, demoRecent: 52 }),
    P({ id: "gj-yangnam-drive", name: "경주 감포 해안도로 (31번국도)", region: "경주", corridor: 11.5, category: "DRIVE", subCategory: "해안드라이브", lat: 35.7200, lng: 129.4900, wpKey: "coastalDrive", stayMin: 25, scenic: 80, driveValue: 82, demoRecent: 66, parking: pk("normal", false, "정차 지점 제한적") }),
    P({ id: "gj-munmudaewang", name: "문무대왕릉", region: "경주", corridor: 12.0, category: "PHOTO_SPOT", subCategory: "해중릉", lat: 35.7280, lng: 129.4790, wpKey: "coastExposed", stayMin: 30, scenic: 70, driveValue: 30, demoRecent: 64 }),
    P({ id: "gj-gampo-cafe", name: "감포 오션뷰 카페", region: "경주", corridor: 13.0, category: "CAFE", subCategory: "바다조망", lat: 35.7690, lng: 129.5060, wpKey: "cafeOceanIndoor", stayMin: 60, scenic: 72, driveValue: 24, demoRecent: 58, parking: pk("easy", false) }),
    P({ id: "gj-najeong", name: "나정고운모래해변", region: "경주", corridor: 13.3, category: "BEACH", subCategory: "해수욕장", lat: 35.7810, lng: 129.5050, wpKey: "beach", stayMin: 45, scenic: 66, driveValue: 22, demoRecent: 48 }),
    P({ id: "gj-gampohang", name: "감포항 회센터", region: "경주", corridor: 13.6, category: "FOOD", subCategory: "회·물회", lat: 35.8040, lng: 129.5085, wpKey: "foodIndoor", stayMin: 60, scenic: 40, demoRecent: 60, partialIndoor: true, parking: pk("normal", false) }),

    /* ---------------- 포항 ---------------- */
    P({ id: "ph-coastdrive", name: "포항 호미로 해안도로", region: "포항", corridor: 20.3, category: "DRIVE", subCategory: "해안드라이브", lat: 36.0200, lng: 129.5600, wpKey: "coastalDrive", stayMin: 25, scenic: 82, driveValue: 84, demoRecent: 62 }),
    P({ id: "ph-guryongpo-street", name: "구룡포 근대문화역사거리", region: "포항", corridor: 20.6, category: "OUTDOOR_ATTRACTION", subCategory: "근대거리", lat: 35.9880, lng: 129.5530, wpKey: "walkShort", stayMin: 70, scenic: 66, driveValue: 30, demoRecent: 74, partialIndoor: true, parking: pk("hard", false, "골목 주차 어려움") }),
    P({ id: "ph-morri", name: "구룡포 모리국수", region: "포항", corridor: 20.7, category: "FOOD", subCategory: "향토국수", lat: 35.9885, lng: 129.5535, wpKey: "foodIndoor", stayMin: 45, scenic: 20, demoRecent: 66, partialIndoor: true, parking: pk("hard", false) }),
    P({ id: "ph-homigot", name: "호미곶 해맞이광장", region: "포항", corridor: 21.0, category: "PHOTO_SPOT", subCategory: "해맞이", lat: 36.0760, lng: 129.5680, wpKey: "coastExposed", stayMin: 50, scenic: 74, driveValue: 34, demoRecent: 72, peninsula: true, parking: pk("easy", false) }),
    P({ id: "ph-jukdo-market", name: "죽도시장", region: "포항", corridor: 22.0, category: "MARKET", subCategory: "수산시장", lat: 36.0330, lng: 129.3650, wpKey: "marketArcade", stayMin: 70, scenic: 30, demoRecent: 80, partialIndoor: true, parking: pk("hard", true, "공영주차장 이용") }),
    P({ id: "ph-yeongildae", name: "영일대해수욕장", region: "포항", corridor: 22.2, category: "BEACH", subCategory: "해수욕장", lat: 36.0620, lng: 129.3800, wpKey: "beach", stayMin: 60, scenic: 68, driveValue: 24, demoRecent: 66 }),
    P({ id: "ph-spacewalk", name: "포항 스페이스워크", region: "포항", corridor: 22.5, category: "OBSERVATORY", subCategory: "체험조형물", lat: 36.0700, lng: 129.3900, wpKey: "observatoryExposed", stayMin: 60, scenic: 76, driveValue: 20, demoRecent: 78, openingHours: "10:00-20:00", closedDays: [1], note: "강풍·우천 시 운영 통제될 수 있음", parking: pk("normal", false) }),
    P({ id: "ph-museum", name: "포항시립미술관", region: "포항", corridor: 22.6, category: "MUSEUM", subCategory: "미술관", lat: 36.0781, lng: 129.3894, wpKey: "indoorStrong", stayMin: 70, scenic: 40, demoRecent: 55, indoor: true, openingHours: "10:00-18:00", closedDays: [1], parking: pk("easy", false) }),
    P({ id: "ph-cafe1703", name: "카페 1703 (칠포)", region: "포항", corridor: 24.4, category: "CAFE", subCategory: "바다조망", lat: 36.0900, lng: 129.4100, wpKey: "cafeOceanIndoor", stayMin: 60, scenic: 74, demoRecent: 63, parking: pk("easy", false) }),
    P({ id: "ph-igari", name: "이가리 닻 전망대", region: "포항", corridor: 24.6, category: "OBSERVATORY", subCategory: "해상전망대", lat: 36.1740, lng: 129.3760, wpKey: "observatoryExposed", stayMin: 40, scenic: 80, driveValue: 24, demoRecent: 70 }),

    /* ---------------- 영덕 ---------------- */
    P({ id: "yd-jangsa", name: "장사상륙작전 전승기념관", region: "영덕", corridor: 30.0, category: "EXHIBITION", subCategory: "안보전시관", lat: 36.3320, lng: 129.3680, wpKey: "indoorStrong", stayMin: 70, scenic: 40, demoRecent: 50, indoor: true, partialIndoor: true, openingHours: "09:00-18:00", closedDays: [1], parking: pk("easy", true) }),
    P({ id: "yd-ganggu", name: "강구항 대게거리", region: "영덕", corridor: 31.0, category: "FOOD", subCategory: "대게·해산물", lat: 36.3620, lng: 129.3960, wpKey: "foodIndoor", stayMin: 80, scenic: 40, demoRecent: 82, partialIndoor: true, parking: pk("normal", false) }),
    P({ id: "yd-samsa", name: "삼사해상공원", region: "영덕", corridor: 31.5, category: "OUTDOOR_ATTRACTION", subCategory: "해상공원", lat: 36.3830, lng: 129.4090, wpKey: "outdoorAttraction", stayMin: 50, scenic: 66, driveValue: 26, demoRecent: 52, parking: pk("easy", false) }),
    P({ id: "yd-fishmuseum", name: "영덕어촌민속전시관", region: "영덕", corridor: 32.0, category: "MUSEUM", subCategory: "민속전시관", lat: 36.4010, lng: 129.4290, wpKey: "indoorStrong", stayMin: 55, scenic: 45, demoRecent: 44, indoor: true, openingHours: "09:00-18:00", closedDays: [1], parking: pk("easy", false) }),
    P({ id: "yd-bluroad", name: "영덕 블루로드 B코스", region: "영덕", corridor: 32.5, category: "WALK", subCategory: "해안트레킹", lat: 36.4060, lng: 129.4300, wpKey: "walkLong", stayMin: 120, scenic: 82, driveValue: 20, demoRecent: 58 }),
    P({ id: "yd-windfarm", name: "영덕 풍력발전단지", region: "영덕", corridor: 33.1, category: "DRIVE", subCategory: "고지대드라이브", lat: 36.4360, lng: 129.4340, wpKey: "inlandDrive", stayMin: 40, scenic: 78, driveValue: 70, demoRecent: 60, wpOverride: { strongWind: 34 }, note: "능선 구간으로 강풍 영향 큼" }),
    P({ id: "yd-haemaji", name: "영덕 해맞이공원·창포말등대", region: "영덕", corridor: 33.4, category: "OBSERVATORY", subCategory: "등대·해안공원", lat: 36.4290, lng: 129.4500, wpKey: "observatoryExposed", stayMin: 60, scenic: 80, driveValue: 24, demoRecent: 64 }),
    P({ id: "yd-goraebul", name: "고래불해수욕장", region: "영덕", corridor: 35.0, category: "BEACH", subCategory: "해수욕장", lat: 36.5730, lng: 129.4260, wpKey: "beach", stayMin: 60, scenic: 66, demoRecent: 50 }),

    /* ---------------- 울진 ---------------- */
    P({ id: "uj-hupo-skywalk", name: "후포 등기산 스카이워크", region: "울진", corridor: 40.0, category: "OBSERVATORY", subCategory: "해상전망대", lat: 36.6790, lng: 129.4530, wpKey: "observatoryExposed", stayMin: 45, scenic: 80, driveValue: 22, demoRecent: 66, parking: pk("normal", false) }),
    P({ id: "uj-hupo-port", name: "후포항 (왕돌초 회)", region: "울진", corridor: 40.2, category: "FOOD", subCategory: "회·대게", lat: 36.6800, lng: 129.4540, wpKey: "foodIndoor", stayMin: 70, scenic: 35, demoRecent: 62, partialIndoor: true }),
    P({ id: "uj-wolsongjeong", name: "월송정", region: "울진", corridor: 41.5, category: "WALK", subCategory: "관동팔경·송림", lat: 36.7530, lng: 129.4640, wpKey: "walkShort", stayMin: 35, scenic: 64, demoRecent: 46, wpOverride: { rain: 46 } }),
    P({ id: "uj-coastdrive", name: "울진 죽변 해안도로 (구 7번국도)", region: "울진", corridor: 43.4, category: "DRIVE", subCategory: "해안드라이브", lat: 36.9900, lng: 129.4100, wpKey: "coastalDrive", stayMin: 25, scenic: 80, driveValue: 82, demoRecent: 58 }),
    P({ id: "uj-mangyangjeong", name: "망양정 해맞이공원", region: "울진", corridor: 43.0, category: "OBSERVATORY", subCategory: "관동팔경 정자", lat: 36.9200, lng: 129.4270, wpKey: "observatoryExposed", stayMin: 40, scenic: 78, driveValue: 22, demoRecent: 52 }),
    P({ id: "uj-expo-aquarium", name: "울진 왕피천엑스포공원 아쿠아리움", region: "울진", corridor: 44.0, category: "AQUARIUM", subCategory: "아쿠아리움", lat: 36.9930, lng: 129.4000, wpKey: "indoorStrong", stayMin: 80, scenic: 45, demoRecent: 64, indoor: true, openingHours: "09:00-18:00", parking: pk("easy", false) }),
    P({ id: "uj-seongryu", name: "성류굴", region: "울진", corridor: 44.2, category: "INDOOR_ATTRACTION", subCategory: "석회동굴", lat: 36.9750, lng: 129.3720, wpKey: "indoorStrong", stayMin: 60, scenic: 60, demoRecent: 58, indoor: true, inland: true, openingHours: "09:00-17:30", note: "동굴 내부 계단·저조도", parking: pk("normal", false) }),
    P({ id: "uj-jukbyeon-rail", name: "죽변 해안스카이레일", region: "울진", corridor: 46.0, category: "OUTDOOR_ATTRACTION", subCategory: "레일바이크형", lat: 37.0530, lng: 129.4230, wpKey: "walkShort", stayMin: 80, scenic: 78, driveValue: 20, demoRecent: 70, partialIndoor: true, note: "예약 권장, 차량형 부분 지붕", openingHours: "09:00-18:00", wpOverride: { rain: 58, heavyRain: 30 } }),
    P({ id: "uj-jukbyeon-heart", name: "죽변항·하트해변", region: "울진", corridor: 46.2, category: "PHOTO_SPOT", subCategory: "항구·포토존", lat: 37.0570, lng: 129.4260, wpKey: "coastExposed", stayMin: 45, scenic: 72, demoRecent: 60 }),

    /* ---------------- 삼척 ---------------- */
    P({ id: "sc-imwon", name: "임원항·수로부인 헌화공원", region: "삼척", corridor: 50.0, category: "OBSERVATORY", subCategory: "해안전망공원", lat: 37.2300, lng: 129.3450, wpKey: "observatoryExposed", stayMin: 50, scenic: 76, driveValue: 22, demoRecent: 48, note: "엘리베이터·고지대 노출" }),
    P({ id: "sc-jangho", name: "삼척 장호항", region: "삼척", corridor: 51.0, category: "BEACH", subCategory: "투명카누·스노클링", lat: 37.3200, lng: 129.2850, wpKey: "beach", stayMin: 90, scenic: 86, driveValue: 26, demoRecent: 80 }),
    P({ id: "sc-cablecar", name: "삼척해상케이블카", region: "삼척", corridor: 51.1, category: "OBSERVATORY", subCategory: "해상케이블카", lat: 37.3150, lng: 129.2830, wpKey: "observatoryIndoor", stayMin: 60, scenic: 78, demoRecent: 68, partialIndoor: true, openingHours: "09:00-18:00", note: "강풍 시 운행 중단", wpOverride: { strongWind: 30, heavyRain: 60 }, parking: pk("normal", false) }),
    P({ id: "sc-choka", name: "초곡 용굴 촛대바위길", region: "삼척", corridor: 52.0, category: "WALK", subCategory: "해안 보드워크", lat: 37.3520, lng: 129.2650, wpKey: "walkShort", stayMin: 60, scenic: 82, demoRecent: 64, wpOverride: { rain: 30, heavyRain: 10 } }),
    P({ id: "sc-hwanseon", name: "환선굴", region: "삼척", corridor: 53.0, category: "INDOOR_ATTRACTION", subCategory: "석회동굴", lat: 37.2600, lng: 129.0900, wpKey: "indoorStrong", stayMin: 130, scenic: 66, demoRecent: 60, indoor: true, inland: true, openingHours: "08:30-17:00", note: "매표소~동굴 급경사 도보 구간", parking: pk("normal", false) }),
    P({ id: "sc-jukseoru", name: "죽서루", region: "삼척", corridor: 55.0, category: "MUSEUM", subCategory: "국가유산·누각", lat: 37.4460, lng: 129.1630, wpKey: "observatoryIndoor", stayMin: 40, scenic: 66, demoRecent: 46, partialIndoor: true, wpOverride: { rain: 66, heavyRain: 40 } }),
    P({ id: "sc-newmillennium-drive", name: "삼척 새천년 해안도로", region: "삼척", corridor: 55.4, category: "DRIVE", subCategory: "해안드라이브", lat: 37.4400, lng: 129.1800, wpKey: "coastalDrive", stayMin: 25, scenic: 82, driveValue: 84, demoRecent: 62 }),
    P({ id: "sc-isabu", name: "이사부사자공원", region: "삼척", corridor: 55.2, category: "OUTDOOR_ATTRACTION", subCategory: "테마공원", lat: 37.4350, lng: 129.2030, wpKey: "outdoorAttraction", stayMin: 50, scenic: 60, demoRecent: 40 }),

    /* ---------------- 동해 ---------------- */
    P({ id: "dh-chuam", name: "추암 촛대바위·출렁다리", region: "동해", corridor: 58.0, category: "PHOTO_SPOT", subCategory: "기암·출렁다리", lat: 37.4770, lng: 129.1450, wpKey: "coastExposed", stayMin: 60, scenic: 88, driveValue: 26, demoRecent: 82, parking: pk("normal", false) }),
    P({ id: "dh-mureung", name: "무릉계곡", region: "동해", corridor: 59.0, category: "WALK", subCategory: "계곡트레킹", lat: 37.4840, lng: 129.0300, wpKey: "walkLong", stayMin: 120, scenic: 80, demoRecent: 54, inland: true, note: "우천 시 계곡물 불어남 주의" }),
    P({ id: "dh-mukho", name: "묵호등대·논골담길", region: "동해", corridor: 60.0, category: "WALK", subCategory: "언덕마을 산책", lat: 37.5520, lng: 129.1160, wpKey: "walkShort", stayMin: 60, scenic: 78, demoRecent: 66, parking: pk("hard", false, "언덕 아래 주차 후 도보") }),
    P({ id: "dh-dokkaebi", name: "도째비골 스카이밸리", region: "동해", corridor: 60.1, category: "OBSERVATORY", subCategory: "스카이워크·유리전망", lat: 37.5530, lng: 129.1180, wpKey: "observatoryExposed", stayMin: 50, scenic: 80, demoRecent: 72, note: "강풍 시 유리다리·집와이어 통제", parking: pk("hard", false) }),
    P({ id: "dh-mukho-market", name: "묵호항 어시장", region: "동해", corridor: 60.2, category: "MARKET", subCategory: "수산시장", lat: 37.5500, lng: 129.1170, wpKey: "marketArcade", stayMin: 50, scenic: 30, demoRecent: 58, partialIndoor: true }),
    P({ id: "dh-cafe-dojaebi", name: "도째비골 바다조망 카페", region: "동해", corridor: 60.3, category: "CAFE", subCategory: "바다조망", lat: 37.5545, lng: 129.1185, wpKey: "cafeOceanIndoor", stayMin: 60, scenic: 76, demoRecent: 60, parking: pk("normal", false) }),
    P({ id: "dh-mangsang", name: "망상해수욕장", region: "동해", corridor: 62.0, category: "BEACH", subCategory: "해수욕장", lat: 37.6260, lng: 129.0700, wpKey: "beach", stayMin: 60, scenic: 64, demoRecent: 48 }),

    /* ---------------- 강릉 ---------------- */
    P({ id: "gn-coastdrive", name: "강릉 헌화로 해안도로 (금진~심곡)", region: "강릉", corridor: 65.6, category: "DRIVE", subCategory: "해안드라이브", lat: 37.6600, lng: 129.0300, wpKey: "coastalDrive", stayMin: 30, scenic: 90, driveValue: 92, demoRecent: 74, note: "국내 대표 해안 드라이브 구간" }),
    P({ id: "gn-jeongdongjin", name: "정동진·모래시계공원", region: "강릉", corridor: 66.0, category: "COAST", subCategory: "해안명소", lat: 37.6900, lng: 129.0330, wpKey: "coastExposed", stayMin: 60, scenic: 76, demoRecent: 70, parking: pk("easy", false) }),
    P({ id: "gn-arte", name: "아르떼뮤지엄 강릉", region: "강릉", corridor: 66.4, category: "EXHIBITION", subCategory: "미디어아트", lat: 37.6860, lng: 128.8780, wpKey: "indoorStrong", stayMin: 80, scenic: 55, demoRecent: 82, indoor: true, openingHours: "10:00-20:00", parking: pk("easy", true) }),
    P({ id: "gn-haslla", name: "하슬라아트월드", region: "강릉", corridor: 66.6, category: "MUSEUM", subCategory: "조각·설치미술", lat: 37.6880, lng: 129.0380, wpKey: "observatoryIndoor", stayMin: 90, scenic: 78, demoRecent: 64, partialIndoor: true, openingHours: "09:00-18:00", wpOverride: { rain: 68, heavyRain: 44 }, parking: pk("easy", false) }),
    P({ id: "gn-anmok", name: "안목해변 커피거리", region: "강릉", corridor: 70.0, category: "CAFE", subCategory: "카페거리·해변", lat: 37.7710, lng: 128.9470, wpKey: "cafeOceanIndoor", stayMin: 70, scenic: 74, demoRecent: 84, parking: pk("hard", true, "공영주차장 혼잡") }),
    P({ id: "gn-jungang-market", name: "강릉중앙시장", region: "강릉", corridor: 70.5, category: "MARKET", subCategory: "전통시장", lat: 37.7550, lng: 128.8970, wpKey: "marketArcade", stayMin: 60, scenic: 30, demoRecent: 76, partialIndoor: true, parking: pk("hard", true) }),
    P({ id: "gn-ojukheon", name: "오죽헌", region: "강릉", corridor: 71.0, category: "MUSEUM", subCategory: "국가유산", lat: 37.7790, lng: 128.8780, wpKey: "observatoryIndoor", stayMin: 60, scenic: 58, demoRecent: 56, partialIndoor: true, openingHours: "09:00-18:00", wpOverride: { rain: 62, heavyRain: 40 }, parking: pk("easy", false) }),
    P({ id: "gn-chodang", name: "초당순두부마을", region: "강릉", corridor: 71.4, category: "FOOD", subCategory: "순두부", lat: 37.7890, lng: 128.9140, wpKey: "foodIndoor", stayMin: 60, scenic: 35, demoRecent: 78, partialIndoor: true, parking: pk("normal", false) }),
    P({ id: "gn-chamsori", name: "참소리축음기·에디슨과학박물관", region: "강릉", corridor: 72.4, category: "MUSEUM", subCategory: "과학·음향박물관", lat: 37.8020, lng: 128.9060, wpKey: "indoorStrong", stayMin: 70, scenic: 45, demoRecent: 50, indoor: true, openingHours: "09:00-18:00", parking: pk("easy", false) }),
    P({ id: "gn-gyeongpo", name: "경포해변", region: "강릉", corridor: 72.6, category: "BEACH", subCategory: "해수욕장", lat: 37.7950, lng: 128.9090, wpKey: "beach", stayMin: 60, scenic: 72, demoRecent: 72 }),
    P({ id: "gn-sacheon-cafe", name: "사천진리 방파제 오션뷰 카페", region: "강릉", corridor: 73.4, category: "CAFE", subCategory: "바다조망", lat: 37.8300, lng: 128.8900, wpKey: "cafeOceanIndoor", stayMin: 60, scenic: 78, demoRecent: 66, parking: pk("normal", false) }),

    /* ---------------- 양양 ---------------- */
    P({ id: "yy-namae", name: "남애항", region: "양양", corridor: 77.5, category: "PHOTO_SPOT", subCategory: "항구 포토존", lat: 37.9830, lng: 128.8470, wpKey: "coastExposed", stayMin: 40, scenic: 74, demoRecent: 58 }),
    P({ id: "yy-coastdrive", name: "양양 죽도~하조대 해안도로", region: "양양", corridor: 78.2, category: "DRIVE", subCategory: "해안드라이브", lat: 38.0500, lng: 128.6600, wpKey: "coastalDrive", stayMin: 25, scenic: 84, driveValue: 84, demoRecent: 62 }),
    P({ id: "yy-hajodae", name: "하조대·하조대해변", region: "양양", corridor: 78.4, category: "OBSERVATORY", subCategory: "정자·등대 전망", lat: 38.0680, lng: 128.6600, wpKey: "observatoryExposed", stayMin: 60, scenic: 82, demoRecent: 72, parking: pk("easy", false) }),
    P({ id: "yy-surfyeong", name: "죽도해변 (서핑)", region: "양양", corridor: 78.6, category: "BEACH", subCategory: "서핑해변", lat: 38.0450, lng: 128.6570, wpKey: "beach", stayMin: 60, scenic: 66, demoRecent: 74 }),
    P({ id: "yy-market", name: "양양전통시장", region: "양양", corridor: 79.0, category: "MARKET", subCategory: "전통시장", lat: 38.0750, lng: 128.6190, wpKey: "marketArcade", stayMin: 50, scenic: 28, demoRecent: 54, partialIndoor: true }),
    P({ id: "yy-osan-museum", name: "오산리 선사유적박물관", region: "양양", corridor: 79.4, category: "MUSEUM", subCategory: "선사유적", lat: 38.1000, lng: 128.6100, wpKey: "indoorStrong", stayMin: 55, scenic: 45, demoRecent: 42, indoor: true, openingHours: "09:00-18:00", closedDays: [1], parking: pk("easy", false) }),
    P({ id: "yy-seopi", name: "서피비치", region: "양양", corridor: 79.8, category: "BEACH", subCategory: "라운지 해변", lat: 38.0870, lng: 128.6460, wpKey: "beach", stayMin: 70, scenic: 74, demoRecent: 76, partialIndoor: true, wpOverride: { lightRain: 58, rain: 34 } }),
    P({ id: "yy-naksansa", name: "낙산사", region: "양양", corridor: 80.0, category: "OUTDOOR_ATTRACTION", subCategory: "해안 사찰", lat: 38.1230, lng: 128.6280, wpKey: "outdoorAttraction", stayMin: 80, scenic: 82, demoRecent: 70, wpOverride: { strongWind: 12 }, note: "해안 절벽 구간 강풍 주의", parking: pk("normal", false) }),
    P({ id: "yy-naksan-beach", name: "낙산해수욕장", region: "양양", corridor: 80.2, category: "BEACH", subCategory: "해수욕장", lat: 38.1180, lng: 128.6320, wpKey: "beach", stayMin: 50, scenic: 64, demoRecent: 58 }),

    /* ---------------- 속초 ---------------- */
    P({ id: "sk-oeongchi", name: "외옹치 바다향기로", region: "속초", corridor: 89.8, category: "WALK", subCategory: "해안 보드워크", lat: 38.1760, lng: 128.6060, wpKey: "walkShort", stayMin: 50, scenic: 78, demoRecent: 64 }),
    P({ id: "sk-beach", name: "속초해수욕장", region: "속초", corridor: 90.0, category: "BEACH", subCategory: "해수욕장", lat: 38.1890, lng: 128.6000, wpKey: "beach", stayMin: 50, scenic: 66, demoRecent: 66 }),
    P({ id: "sk-cheongcho", name: "청초호수공원", region: "속초", corridor: 90.2, category: "WALK", subCategory: "호수 산책", lat: 38.1960, lng: 128.5860, wpKey: "walkShort", stayMin: 45, scenic: 60, demoRecent: 50, wpOverride: { rain: 42 } }),
    P({ id: "sk-market", name: "속초관광수산시장", region: "속초", corridor: 90.4, category: "MARKET", subCategory: "관광시장", lat: 38.2070, lng: 128.5910, wpKey: "marketArcade", stayMin: 70, scenic: 30, demoRecent: 88, partialIndoor: true, parking: pk("hard", true, "공영주차장 혼잡") }),
    P({ id: "sk-abai", name: "아바이마을 (갯배)", region: "속초", corridor: 90.5, category: "OUTDOOR_ATTRACTION", subCategory: "실향민 마을", lat: 38.2040, lng: 128.5960, wpKey: "walkShort", stayMin: 60, scenic: 58, demoRecent: 72, partialIndoor: true }),
    P({ id: "sk-cafe-yeongnang", name: "영랑호수윗길 인근 오션뷰 카페", region: "속초", corridor: 90.7, category: "CAFE", subCategory: "호수·바다조망", lat: 38.2020, lng: 128.6000, wpKey: "cafeOceanIndoor", stayMin: 60, scenic: 72, demoRecent: 62, parking: pk("normal", false) }),
    P({ id: "sk-yeonggeumjeong", name: "영금정", region: "속초", corridor: 91.0, category: "PHOTO_SPOT", subCategory: "해안 정자", lat: 38.2150, lng: 128.6010, wpKey: "coastExposed", stayMin: 40, scenic: 74, demoRecent: 60 }),
    P({ id: "sk-lighthouse", name: "속초등대전망대", region: "속초", corridor: 91.1, category: "OBSERVATORY", subCategory: "등대 전망대", lat: 38.2160, lng: 128.6000, wpKey: "observatoryExposed", stayMin: 40, scenic: 76, demoRecent: 56 }),
    P({ id: "sk-seorak-cablecar", name: "설악산 소공원·권금성 케이블카", region: "속초", corridor: 88.0, category: "OBSERVATORY", subCategory: "산악 케이블카", lat: 38.1700, lng: 128.4940, wpKey: "observatoryIndoor", stayMin: 120, scenic: 84, demoRecent: 78, inland: true, partialIndoor: true, openingHours: "09:00-17:00", note: "강풍·결빙 시 운행 중단, 국립공원 구간", wpOverride: { strongWind: 24, heavyRain: 44 }, parking: pk("normal", false) }),

    /* ---------------- 고성 ---------------- */
    P({ id: "gs-cheongganjeong", name: "청간정", region: "고성", corridor: 96.0, category: "OBSERVATORY", subCategory: "관동팔경 정자", lat: 38.2830, lng: 128.5530, wpKey: "observatoryIndoor", stayMin: 35, scenic: 72, demoRecent: 48, partialIndoor: true, wpOverride: { rain: 60, heavyRain: 34 } }),
    P({ id: "gs-ayajin", name: "아야진해변", region: "고성", corridor: 96.5, category: "BEACH", subCategory: "기암 해변", lat: 38.3100, lng: 128.5550, wpKey: "beach", stayMin: 45, scenic: 74, demoRecent: 60 }),
    P({ id: "gs-coastdrive", name: "고성 화진포~대진 해안도로", region: "고성", corridor: 97.0, category: "DRIVE", subCategory: "해안드라이브", lat: 38.4500, lng: 128.4400, wpKey: "coastalDrive", stayMin: 25, scenic: 82, driveValue: 82, demoRecent: 54 }),
    P({ id: "gs-songjiho", name: "송지호해변·둘레길", region: "고성", corridor: 98.0, category: "WALK", subCategory: "해변·호수 산책", lat: 38.3630, lng: 128.5120, wpKey: "walkShort", stayMin: 60, scenic: 74, demoRecent: 52 }),
    P({ id: "gs-wanggol", name: "왕곡마을", region: "고성", corridor: 98.2, category: "OUTDOOR_ATTRACTION", subCategory: "전통 한옥마을", lat: 38.3520, lng: 128.4940, wpKey: "walkShort", stayMin: 60, scenic: 68, demoRecent: 56, inland: true, wpOverride: { rain: 40 } }),
    P({ id: "gs-hwajinpo-lake", name: "화진포 호수·해맞이교", region: "고성", corridor: 100.0, category: "WALK", subCategory: "석호 산책", lat: 38.4200, lng: 128.4400, wpKey: "walkShort", stayMin: 50, scenic: 72, demoRecent: 58 }),
    P({ id: "gs-hwajinpo-museum", name: "화진포의 성·역사안보전시관", region: "고성", corridor: 100.1, category: "EXHIBITION", subCategory: "역사안보 전시", lat: 38.4230, lng: 128.4430, wpKey: "indoorStrong", stayMin: 60, scenic: 55, demoRecent: 50, indoor: true, openingHours: "09:00-18:00", parking: pk("easy", false) }),
    P({ id: "gs-geojin", name: "거진항", region: "고성", corridor: 100.5, category: "FOOD", subCategory: "회·명태", lat: 38.4430, lng: 128.4620, wpKey: "foodIndoor", stayMin: 60, scenic: 35, demoRecent: 52, partialIndoor: true }),
    P({ id: "gs-dmz-museum", name: "DMZ박물관", region: "고성", corridor: 101.5, category: "MUSEUM", subCategory: "분단·평화 전시", lat: 38.5400, lng: 128.3650, wpKey: "indoorStrong", stayMin: 70, scenic: 50, demoRecent: 46, indoor: true, openingHours: "09:00-17:00", closedDays: [1], note: "통일전망대 출입신고소 인근", parking: pk("easy", false) }),
    P({ id: "gs-unification", name: "고성 통일전망대", region: "고성", corridor: 102.0, category: "OBSERVATORY", subCategory: "안보 전망대", lat: 38.5520, lng: 128.3600, wpKey: "observatoryIndoor", stayMin: 60, scenic: 78, demoRecent: 60, partialIndoor: true, note: "출입신고서 작성·신분증 필요, 지정 차량 이동 구간", wpOverride: { rain: 58, heavyRain: 36 }, parking: pk("normal", false) })
  ];

  /* ---------------- 보강 데이터 (지역별 실내/드라이브/맛집/카페 최소 1곳 보장, §50) ---------------- */
  [
    // 경주 - 실내
    P({ id: "gj-girimsa", name: "기림사 성보박물관", region: "경주", corridor: 12.5, category: "MUSEUM", subCategory: "사찰 성보박물관", lat: 35.7686, lng: 129.3186, wpKey: "indoorStrong", stayMin: 60, scenic: 55, demoRecent: 42, indoor: true, inland: true, openingHours: "09:00-18:00", parking: pk("normal", false) }),
    // 영덕 - 카페
    P({ id: "yd-cafe-haemaji", name: "영덕 해맞이공원 인근 오션뷰 카페", region: "영덕", corridor: 33.5, category: "CAFE", subCategory: "바다조망", lat: 36.4300, lng: 129.4480, wpKey: "cafeOceanIndoor", stayMin: 60, scenic: 76, demoRecent: 54, parking: pk("normal", false) }),
    // 울진 - 카페
    P({ id: "uj-cafe-jukbyeon", name: "죽변항 바다조망 카페", region: "울진", corridor: 46.3, category: "CAFE", subCategory: "바다조망", lat: 37.0560, lng: 129.4250, wpKey: "cafeOceanIndoor", stayMin: 60, scenic: 74, demoRecent: 52, parking: pk("normal", false) }),
    // 삼척 - 맛집 / 카페
    P({ id: "sc-food-jangho", name: "장호항 활어·물회", region: "삼척", corridor: 51.2, category: "FOOD", subCategory: "회·물회", lat: 37.3205, lng: 129.2848, wpKey: "foodIndoor", stayMin: 60, scenic: 40, demoRecent: 58, partialIndoor: true, parking: pk("normal", false) }),
    P({ id: "sc-cafe-samcheok", name: "삼척 새천년도로 오션뷰 카페", region: "삼척", corridor: 55.6, category: "CAFE", subCategory: "바다조망", lat: 37.4420, lng: 129.1815, wpKey: "cafeOceanIndoor", stayMin: 60, scenic: 78, demoRecent: 56, parking: pk("normal", false) }),
    // 동해 - 드라이브 / 맛집
    P({ id: "dh-coastdrive", name: "동해 묵호~망상 해안 드라이브", region: "동해", corridor: 61.0, category: "DRIVE", subCategory: "해안드라이브", lat: 37.5900, lng: 129.0950, wpKey: "coastalDrive", stayMin: 25, scenic: 80, driveValue: 80, demoRecent: 56 }),
    P({ id: "dh-food-eodal", name: "어달항 회·생선구이", region: "동해", corridor: 60.4, category: "FOOD", subCategory: "회·생선구이", lat: 37.5590, lng: 129.1150, wpKey: "foodIndoor", stayMin: 60, scenic: 38, demoRecent: 58, partialIndoor: true, parking: pk("normal", false) }),
    // 양양 - 맛집 / 카페
    P({ id: "yy-food-namae", name: "남애항 물회·회", region: "양양", corridor: 77.6, category: "FOOD", subCategory: "물회·회", lat: 37.9835, lng: 128.8465, wpKey: "foodIndoor", stayMin: 55, scenic: 40, demoRecent: 56, partialIndoor: true }),
    P({ id: "yy-cafe-hajodae", name: "하조대 오션뷰 카페", region: "양양", corridor: 78.5, category: "CAFE", subCategory: "바다조망", lat: 38.0670, lng: 128.6580, wpKey: "cafeOceanIndoor", stayMin: 60, scenic: 80, demoRecent: 64, parking: pk("easy", false) }),
    // 속초 - 드라이브 / 맛집
    P({ id: "sk-coastdrive", name: "속초 장사항~영금정 해안도로", region: "속초", corridor: 91.3, category: "DRIVE", subCategory: "해안드라이브", lat: 38.2120, lng: 128.6000, wpKey: "coastalDrive", stayMin: 25, scenic: 78, driveValue: 76, demoRecent: 52 }),
    P({ id: "sk-food-abai", name: "속초 아바이순대·물회", region: "속초", corridor: 90.6, category: "FOOD", subCategory: "향토음식", lat: 38.2045, lng: 128.5965, wpKey: "foodIndoor", stayMin: 55, scenic: 30, demoRecent: 74, partialIndoor: true, parking: pk("hard", false) }),
    // 고성 - 카페
    P({ id: "gs-cafe-ayajin", name: "아야진 바다조망 카페", region: "고성", corridor: 96.6, category: "CAFE", subCategory: "바다조망", lat: 38.3110, lng: 128.5560, wpKey: "cafeOceanIndoor", stayMin: 60, scenic: 76, demoRecent: 54, parking: pk("normal", false) })
  ].forEach(function (p) { PLACES.push(p); });

  /* leg 유사값: 회랑 정렬 확인용 정렬 키 */
  PLACES.forEach(function (p) { p.leg = p.corridor; });

  var CATEGORY_LABELS = {
    DRIVE: "드라이브", INDOOR_ATTRACTION: "실내 볼거리", OUTDOOR_ATTRACTION: "야외 관광",
    FOOD: "맛집", CAFE: "카페", MARKET: "시장", MUSEUM: "박물관", EXHIBITION: "전시관",
    AQUARIUM: "아쿠아리움", OBSERVATORY: "전망대", COAST: "해안 명소", BEACH: "해변",
    WALK: "산책", PHOTO_SPOT: "사진 포인트"
  };

  /* 우천 시 "실내 볼거리" 로 함께 묶는 카테고리 */
  var INDOOR_LIKE = ["INDOOR_ATTRACTION", "MUSEUM", "EXHIBITION", "AQUARIUM", "MARKET"];

  /* 지역별 숙박(모텔 중심) 추천 - DEMO. 특정 업소명이 아니라 모텔 밀집지역과
     검색 링크를 제공합니다. 실운영 시 숙박 API(야놀자·여기어때·부킹 등) 연동으로 교체. */
  var LODGING = {
    "경주": [
      { area: "보문관광단지·불국사 인근", note: "관광호텔과 모텔이 함께 밀집. 주차 넉넉" },
      { area: "경주역·성동시장 인근", note: "시내 모텔 밀집, 식당가 도보권" }
    ],
    "포항": [
      { area: "영일대해수욕장 북부 모텔촌", note: "해변 조망 모텔 다수, 야간 이동 짧음" },
      { area: "죽도시장·시외버스터미널 인근", note: "시내 중저가 모텔 밀집" }
    ],
    "영덕": [
      { area: "강구항 대게거리 인근", note: "항구 인근 모텔·민박, 저녁 식사 도보권" },
      { area: "영덕공용버스터미널 인근", note: "읍내 모텔, 주차 용이" }
    ],
    "울진": [
      { area: "후포항 인근", note: "남부 기점 숙박, 회센터 도보권" },
      { area: "울진읍·근남면(성류굴·엑스포공원) 인근", note: "중부 모텔, 실내 관광 연계" },
      { area: "죽변항 인근", note: "북부 기점, 스카이레일·하트해변 인접" }
    ],
    "삼척": [
      { area: "삼척해변·이사부로 모텔촌", note: "해안도로변 모텔 다수" },
      { area: "삼척종합버스터미널·정라동 인근", note: "시내 중저가 모텔" }
    ],
    "동해": [
      { area: "묵호항·논골담길 인근", note: "항구·언덕마을 인근 모텔" },
      { area: "동해종합버스터미널·천곡동 인근", note: "시내 모텔 밀집, 주차 용이" },
      { area: "망상해변 인근", note: "북부 기점, 오토캠핑·모텔" }
    ],
    "강릉": [
      { area: "경포해변 인근", note: "해변 조망 모텔·펜션 다수, 성수기 혼잡" },
      { area: "강릉역·교동 택지 모텔촌", note: "시내 모텔 밀집, 안목·중앙시장 차량 10분" },
      { area: "안목해변 커피거리 인근", note: "카페거리 도보권 모텔" }
    ],
    "양양": [
      { area: "낙산해변 인근 모텔", note: "낙산사·해변 도보권" },
      { area: "양양시외버스터미널·읍내 인근", note: "읍내 모텔, 주차 용이" },
      { area: "죽도해변(서핑) 인근", note: "서프 게스트하우스·모텔 혼재" }
    ],
    "속초": [
      { area: "속초해수욕장·조양동 모텔촌", note: "해변 인근 모텔 밀집" },
      { area: "청호동 아바이마을 인근", note: "속초항·수산시장 도보권" },
      { area: "속초시외버스터미널·중앙동 인근", note: "시내 중저가 모텔" }
    ],
    "고성": [
      { area: "거진항 인근", note: "북부 기점, 회·명태 식당가 인접" },
      { area: "아야진·청간정 인근", note: "해변 조망 모텔·펜션" },
      { area: "화진포 인근", note: "화진포·통일전망대 연계 숙박" }
    ]
  };

  var DATA = {
    WP: WP,
    PLACES: PLACES,
    ORIGINS: ORIGINS,
    REGION_META: REGION_META,
    CATEGORY_LABELS: CATEGORY_LABELS,
    INDOOR_LIKE: INDOOR_LIKE,
    LODGING: LODGING,

    place: function (id) { for (var i = 0; i < PLACES.length; i++) if (PLACES[i].id === id) return PLACES[i]; return null; },
    origin: function (id) { for (var i = 0; i < ORIGINS.length; i++) if (ORIGINS[i].id === id) return ORIGINS[i]; return null; },
    isIndoorLike: function (p) { return p.indoor || INDOOR_LIKE.indexOf(p.category) >= 0; },
    lodging: function (region) { return LODGING[region] || []; },

    /* 데이터 상태: 내장 데이터만 있으면 DEMO, TourAPI 병합 시 PARTIAL/LIVE 로 갱신 */
    status: "DEMO",

    /* TourAPI 등 외부 관광 데이터를 병합하는 어댑터 자리. 키가 없으면 아무 것도 하지 않습니다. */
    mergeVisitKoreaData: function (records) {
      if (!records || !records.length) return { merged: 0 };
      var merged = 0;
      records.forEach(function (r) {
        var ex = DATA.place(r.id);
        if (ex) { for (var k in r) if (r.hasOwnProperty(k) && k !== "id") ex[k] = r[k]; ex.demo = false; merged++; }
        else { r.demo = false; PLACES.push(P(r)); merged++; }
      });
      DATA.status = merged >= PLACES.length ? "LIVE" : "PARTIAL";
      return { merged: merged };
    }
  };

  /* 선택적 외부 JSON override: http 로 열렸을 때만 시도. 실패해도 무시. */
  DATA.tryLoadExternal = function () {
    if (location.protocol === "file:") return Promise.resolve(false);
    return fetch("data/places.json").then(function (r) {
      if (!r.ok) throw new Error("no file");
      return r.json();
    }).then(function (json) {
      // source 가 'live' 인 실데이터일 때만 병합. DEMO 내보내기 파일은 병합하지 않습니다.
      if (json && json.source === "live" && json.places && json.places.length) {
        DATA.mergeVisitKoreaData(json.places);
        return true;
      }
      return false;
    }).catch(function () { return false; });
  };

  global.DATA = DATA;
})(window);
