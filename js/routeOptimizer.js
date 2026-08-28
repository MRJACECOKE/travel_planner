/* =============================================================
   routeOptimizer.js - 차량 동선 최적화 (자가용 기준)
   -------------------------------------------------------------
   - 지그재그(역주행) 방지가 핵심. 회랑(corridor) 단조 진행을 강제.
   - 이동시간은 실제 교통정보가 아닌 좌표·도로특성 기반 예상값.
     detectRouteDirection()  calculateDirectionalProgress()
     calculateBacktrackingPenalty()  calculateDetourPenalty()
     estimateTravelMinutes()  chooseRoadType()  optimizeDailyRoute()
   ============================================================= */
(function (global) {
  "use strict";

  var C = global.CONFIG;
  var D = C.DRIVE;

  function toRad(d) { return d * Math.PI / 180; }
  function haversineKm(a, b) {
    var R = 6371;
    var dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1]);
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }

  /* 두 지점 성격에 맞는 도로 유형 결정 */
  function chooseRoadType(fromP, toP, opts) {
    opts = opts || {};
    var km = haversineKm(ll(fromP), ll(toP));
    // 강한 비/강풍이면 해안도로 회피
    if (opts.avoidCoastal) {
      return km > 60 ? "expressway" : "national";
    }
    // 사용자가 해안도로 선호 + 짧은 구간이면 scenic
    if (opts.coastalPreference >= 0.6 && km <= 45 && !inland(fromP) && !inland(toP)) return "coastal";
    if (km > 70) return "expressway";
    if (km > 30) return "national";
    return "coastal";
  }

  function speedFor(roadType) {
    if (roadType === "expressway") return D.expressKmh;
    if (roadType === "national") return D.nationalKmh;
    return D.coastalKmh;
  }

  /* 이동시간(분) 예상값 */
  function estimateTravelMinutes(fromP, toP, opts) {
    opts = opts || {};
    var km = haversineKm(ll(fromP), ll(toP)) * D.curvature;
    var road = opts.roadType || chooseRoadType(fromP, toP, opts);
    var kmh = speedFor(road);
    var min = km / kmh * 60;

    if (inland(fromP) !== inland(toP)) min += D.inlandExtraMin;
    if (toP && toP.peninsula) min += D.peninsulaExtraMin;
    if (fromP && fromP.peninsula) min += D.peninsulaExtraMin;

    // 날씨
    if (opts.weatherClass === "RAIN") min *= (1 / D.rainSpeedFactor);
    else if (opts.weatherClass === "HEAVY_RAIN") min *= (1 / D.heavyRainSpeedFactor);

    // 진입 난이도
    if (toP && toP.parking && toP.parking.difficulty === "hard") min += 8;

    return { minutes: Math.round(min), km: +(km).toFixed(1), roadType: road };
  }

  /* 여행 방향 감지 */
  function detectRouteDirection(startRegionIdx, endRegionIdx) {
    if (endRegionIdx > startRegionIdx) return "north";
    if (endRegionIdx < startRegionIdx) return "south";
    return "single";
  }

  /* 방향 진행량 (+면 목표 방향으로 전진, -면 역주행) */
  function calculateDirectionalProgress(prevCorridor, nextCorridor, dir) {
    var delta = nextCorridor - prevCorridor;
    if (dir === "south") delta = -delta;
    if (dir === "single") return Math.abs(delta) < 3 ? 1 : -Math.abs(delta) * 0.2;
    return delta;
  }

  /* 역주행 감점 0..40 */
  function calculateBacktrackingPenalty(place, lastCorridor, dir, opts) {
    opts = opts || {};
    if (lastCorridor == null) return 0;
    if (place.peninsula) return 0; // 곶 진입-복귀는 별도 우회시간으로 처리
    var progress = calculateDirectionalProgress(lastCorridor, place.corridor, dir);
    if (progress >= 0) return 0;
    var back = -progress; // 후퇴한 회랑 거리
    var penalty = Math.min(40, back * 3.5);
    return Math.round(penalty);
  }

  /* 우회 감점 0..30 (내륙 진입 등) */
  function calculateDetourPenalty(place, opts) {
    opts = opts || {};
    var p = 0;
    if (place.inland) p += 12;
    if (place.peninsula) p += 8;
    if (place.parking && place.parking.difficulty === "hard") p += 5;
    // 강한 비/강풍이면 내륙 계곡·산악 추가 감점
    if ((opts.weatherClass === "HEAVY_RAIN") && place.inland && place.category === "WALK") p += 10;
    return Math.min(30, p);
  }

  /* 추가 우회시간(분) 추정: 회랑 경로에서 이 장소를 들르는 데 드는 추가 이동 */
  function extraDetourMinutes(place, prevP, nextP, opts) {
    if (!prevP) return 0;
    var direct = nextP ? estimateTravelMinutes(prevP, nextP, opts).minutes : 0;
    var via = estimateTravelMinutes(prevP, place, opts).minutes +
      (nextP ? estimateTravelMinutes(place, nextP, opts).minutes : 0);
    return Math.max(0, Math.round(via - direct - (place.stayMin ? 0 : 0)));
  }

  /* 하루 방문 후보를 회랑 순서로 정렬 + 이동/도착시간 계산 */
  function optimizeDailyRoute(startPoint, places, dir, opts) {
    opts = opts || {};
    var ordered = places.slice().sort(function (a, b) {
      return dir === "south" ? b.corridor - a.corridor : a.corridor - b.corridor;
    });
    var legs = [];
    var cursor = startPoint;
    ordered.forEach(function (p) {
      var t = estimateTravelMinutes(cursor, p, opts);
      legs.push({ from: cursor, to: p, travel: t });
      cursor = p;
    });
    return { ordered: ordered, legs: legs };
  }

  function ll(p) { return p.ll ? p.ll : [p.lat, p.lng]; }
  function inland(p) { return !!(p && p.inland); }

  global.RouteOptimizer = {
    haversineKm: haversineKm,
    chooseRoadType: chooseRoadType,
    estimateTravelMinutes: estimateTravelMinutes,
    detectRouteDirection: detectRouteDirection,
    detectTravelDirection: detectRouteDirection,
    calculateDirectionalProgress: calculateDirectionalProgress,
    calculateBacktrackingPenalty: calculateBacktrackingPenalty,
    calculateDetourPenalty: calculateDetourPenalty,
    extraDetourMinutes: extraDetourMinutes,
    optimizeDailyRoute: optimizeDailyRoute,
    _ll: ll
  };
})(window);
