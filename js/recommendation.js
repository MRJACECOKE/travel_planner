/* =============================================================
   recommendation.js - 종합 추천 엔진 (룰 단순 나열 아님)
   -------------------------------------------------------------
   score = recent*0.15 + reviewQuality*0.14 + routeFit*0.17 + driveValue*0.11
         + parking*0.08 + scenic*0.08 + timeEfficiency*0.09 + weatherFit*0.12
         + userPreference*0.06
         + rainStrategyBonus
         - commercialPenalty - detourPenalty - backtrackingPenalty - weatherRiskPenalty
   ============================================================= */
(function (global) {
  "use strict";

  var C = global.CONFIG, W = C.WEIGHTS;
  var RO = global.RouteOptimizer, WS = global.WeatherStrategy, RE = global.ReviewEngine;

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  /* 여행 범위로 후보 필터 (부산/울산 관광 제외는 데이터에 이미 없음, 방어적으로 재확인) */
  function filterPlacesByTravelRange(startRegion, endRegion) {
    var si = C.regionIndex(startRegion), ei = C.regionIndex(endRegion);
    var lo = Math.min(si, ei), hi = Math.max(si, ei);
    return DATA.PLACES.filter(function (p) {
      if (C.ORIGIN_ONLY_REGIONS.indexOf(p.region) >= 0) return false;
      var ri = C.regionIndex(p.region);
      return ri >= lo && ri <= hi;
    });
  }

  function getCandidatePlaces(ctx) {
    return filterPlacesByTravelRange(ctx.startRegion, ctx.endRegion);
  }

  /* 사용자 선호 점수 0..100 */
  function userPreferenceScore(place, prefs) {
    prefs = prefs || {};
    var map = {
      DRIVE: prefs.drivePref, CAFE: prefs.cafeInterest, FOOD: prefs.foodInterest,
      MARKET: prefs.marketInterest, PHOTO_SPOT: prefs.photoInterest,
      BEACH: prefs.natureInterest, COAST: prefs.natureInterest, WALK: prefs.natureInterest,
      INDOOR_ATTRACTION: prefs.indoorInterest, MUSEUM: prefs.indoorInterest,
      EXHIBITION: prefs.indoorInterest, AQUARIUM: prefs.indoorInterest,
      OBSERVATORY: prefs.photoInterest
    };
    var v = map[place.category];
    if (v == null) v = 0.5;
    var s = v * 100;
    if (place.category === "DRIVE" && prefs.coastalRoadPref != null) s = (s + prefs.coastalRoadPref * 100) / 2;
    if (place.driveValue >= 70 && prefs.coastalRoadPref != null) s = clamp(s + prefs.coastalRoadPref * 15, 0, 100);
    return clamp(Math.round(s), 0, 100);
  }

  function routeFitScore(place, ctx) {
    var targetIdx = ctx.targetRegionIdx;
    var ri = C.regionIndex(place.region);
    var regionScore = 100 - Math.abs(ri - targetIdx) * 20;
    var progress = ctx.lastCorridor != null
      ? RO.calculateDirectionalProgress(ctx.lastCorridor, place.corridor, ctx.dir)
      : 2;
    var progressScore = progress >= 0 ? clamp(60 + progress * 4, 0, 100) : clamp(40 + progress * 6, 0, 100);
    return clamp(Math.round(regionScore * 0.6 + progressScore * 0.4), 0, 100);
  }

  function timeEfficiencyScore(place, ctx) {
    var value = (place.scenic + place.demoRecent) / 2;
    var cost = (place.stayMin - 45) / 3 + (ctx.extraDetourMin || 0) * 1.2 + (place.inland ? 10 : 0);
    return clamp(Math.round(value - cost + 20), 0, 100);
  }

  function driveValueScore(place) {
    if (place.category === "DRIVE") return clamp(place.driveValue, 0, 100);
    return clamp(Math.round(place.driveValue * 0.5 + place.scenic * 0.3), 0, 100);
  }

  function calculatePlaceScore(place, ctx) {
    ctx = ctx || {};
    var cls = ctx.weatherClass || "CLEAR";
    var agg = ctx.agg || {};

    var sub = {
      recent: RE.calculateRecentScore(place),
      reviewQuality: RE.calculateReviewQuality(place),
      routeFit: routeFitScore(place, ctx),
      driveValue: driveValueScore(place),
      parking: RE.signals(place).parkingClarity,
      scenic: clamp(place.scenic, 0, 100),
      timeEfficiency: timeEfficiencyScore(place, ctx),
      weatherFit: WS.calculateWeatherFitScore(place, cls, agg),
      userPreference: userPreferenceScore(place, ctx.prefs)
    };

    var weighted =
      sub.recent * W.recent + sub.reviewQuality * W.reviewQuality + sub.routeFit * W.routeFit +
      sub.driveValue * W.driveValue + sub.parking * W.parking + sub.scenic * W.scenic +
      sub.timeEfficiency * W.timeEfficiency + sub.weatherFit * W.weatherFit +
      sub.userPreference * W.userPreference;

    var commercialPenalty = RE.calculateCommercialPenalty(place);
    var detourPenalty = RO.calculateDetourPenalty(place, { weatherClass: cls });
    var backtrackingPenalty = RO.calculateBacktrackingPenalty(place, ctx.lastCorridor, ctx.dir);
    var wr = WS.calculateWeatherRiskPenalty(place, cls, agg);
    var weatherRiskPenalty = wr.penalty;

    var rain = WS.applyRainStrategy(place, cls, agg);

    var score = weighted + rain.bonus - commercialPenalty - detourPenalty - backtrackingPenalty - weatherRiskPenalty;

    // 사람이 읽는 사유: 가중 기여 상위 + 우천 전략 사유
    var contrib = [
      ["최근 관심도(DEMO)", sub.recent * W.recent],
      ["후기 품질 신호", sub.reviewQuality * W.reviewQuality],
      ["동선 적합", sub.routeFit * W.routeFit],
      ["드라이브 가치", sub.driveValue * W.driveValue],
      ["주차 편의", sub.parking * W.parking],
      ["경관", sub.scenic * W.scenic],
      ["시간 효율", sub.timeEfficiency * W.timeEfficiency],
      ["날씨 적합", sub.weatherFit * W.weatherFit],
      ["선호 일치", sub.userPreference * W.userPreference]
    ].sort(function (a, b) { return b[1] - a[1]; });

    var reasons = [];
    reasons.push(contrib[0][0] + " 우수");
    if (contrib[1][1] > 4) reasons.push(contrib[1][0] + " 양호");
    rain.reasons.forEach(function (r) { if (reasons.indexOf(r) < 0) reasons.push(r); });
    wr.reasons.forEach(function (r) { if (reasons.indexOf(r) < 0) reasons.push(r); });

    var penaltyReasons = [];
    if (backtrackingPenalty >= 8) penaltyReasons.push("현재 " + (ctx.dir === "south" ? "남하" : "북상") + " 동선에서 역주행 발생");
    if (detourPenalty >= 12) penaltyReasons.push(place.inland ? "내륙 진입 우회" : "우회 이동 부담");
    if (weatherRiskPenalty >= 12) penaltyReasons.push("기상 위험 구간");

    return {
      place: place, score: Math.round(score),
      sub: sub, weighted: Math.round(weighted),
      penalties: {
        commercial: commercialPenalty, detour: detourPenalty,
        backtracking: backtrackingPenalty, weatherRisk: weatherRiskPenalty
      },
      rainBonus: Math.round(rain.bonus),
      reasons: reasons,
      penaltyReasons: penaltyReasons
    };
  }

  /* 후보 전체 점수화 후 정렬 */
  function scoreCandidates(places, ctx) {
    return places.map(function (p) { return calculatePlaceScore(p, ctx); })
      .sort(function (a, b) { return b.score - a.score; });
  }

  global.Recommendation = {
    filterPlacesByTravelRange: filterPlacesByTravelRange,
    getCandidatePlaces: getCandidatePlaces,
    calculatePlaceScore: calculatePlaceScore,
    scoreCandidates: scoreCandidates,
    userPreferenceScore: userPreferenceScore,
    routeFitScore: routeFitScore
  };
})(window);
