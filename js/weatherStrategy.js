/* =============================================================
   weatherStrategy.js - 우천 전략 엔진 (이 프로젝트의 핵심)
   -------------------------------------------------------------
   날씨를 "표시"만 하지 않고 추천 점수/카테고리/순서/체류시간에
   실제로 반영합니다.
     classifyWeather()  calculateRainRisk()  calculateWeatherConfidence()
     calculateWeatherFitScore()  applyRainStrategy()
     applyHeavyRainSafetyPenalty()  rebuildScheduleForWeather()
   ============================================================= */
(function (global) {
  "use strict";

  var CLASSES = ["CLEAR", "LIGHT_RAIN", "RAIN", "HEAVY_RAIN"];
  var CLASS_LABEL = { CLEAR: "맑음", LIGHT_RAIN: "약한 비", RAIN: "비", HEAVY_RAIN: "강한 비" };
  var CLASS_KEY = { CLEAR: "clear", LIGHT_RAIN: "lightRain", RAIN: "rain", HEAVY_RAIN: "heavyRain" };

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function isWindDanger(agg) {
    return (agg.windMs != null && agg.windMs >= 9) || (agg.gustMs != null && agg.gustMs >= 13);
  }
  function isSevereWind(agg) {
    return (agg.windMs != null && agg.windMs >= 12) || (agg.gustMs != null && agg.gustMs >= 16);
  }

  /* 종합 예보 -> 4단계 분류 */
  function classifyWeather(agg) {
    if (!agg) return "CLEAR";
    var pop = agg.pop || 0, mm = agg.precipMm || 0;
    if (mm >= 25 || (pop >= 80 && (mm >= 12 || isWindDanger(agg))) || isSevereWind(agg)) return "HEAVY_RAIN";
    if (pop >= 60 || mm >= 6) return "RAIN";
    if (pop >= 35 || mm >= 1) return "LIGHT_RAIN";
    return "CLEAR";
  }

  /* 시간대별 강수 위험 0..1 */
  function calculateRainRisk(agg, band) {
    if (!agg) return 0;
    var b = band && agg.bands && agg.bands[band] ? agg.bands[band] : { pop: agg.pop || 0, precipMm: agg.precipMm || 0 };
    var risk = (b.pop / 100) * 0.7 + clamp(b.precipMm / 20, 0, 1) * 0.3;
    if (isWindDanger(agg)) risk = clamp(risk + 0.12, 0, 1);
    return +risk.toFixed(2);
  }

  function calculateWeatherConfidence(agg) {
    return agg && agg.agreement ? agg.agreement.confidence : "보통";
  }

  /* 장소 x 날씨 적합도 0..100 */
  function calculateWeatherFitScore(place, cls, agg) {
    var key = CLASS_KEY[cls] || "clear";
    var base = place.weatherProfile[key];
    if (isWindDanger(agg)) {
      var windFit = place.weatherProfile.strongWind;
      base = Math.round(base * 0.45 + windFit * 0.55);
    }
    return clamp(base, 0, 100);
  }

  /* 우천 전략: 점수 가감 + 사유. recommendation 에서 최종 점수에 더해집니다. */
  function applyRainStrategy(place, cls, agg) {
    var reasons = [], bonus = 0;
    var indoorLike = DATA.isIndoorLike(place);
    var wind = isWindDanger(agg);

    if (cls === "CLEAR") {
      if (place.category === "DRIVE") { bonus += 2; }
      return { bonus: bonus, reasons: reasons };
    }

    if (cls === "LIGHT_RAIN") {
      if (indoorLike) { bonus += 6; reasons.push("약한 비 - 실내 관람 가능"); }
      if (place.category === "DRIVE" && !wind) { bonus += 8; reasons.push("약한 비 - 안전한 해안 드라이브 가능"); }
      if (place.category === "CAFE") { bonus += 4; reasons.push("약한 비 - 실내 휴식 적합"); }
      if (["BEACH", "COAST", "PHOTO_SPOT"].indexOf(place.category) >= 0) { bonus -= 5; reasons.push("약한 비 - 야외 체류 축소"); }
      if (place.category === "WALK" && place.weatherProfile.rain < 45) { bonus -= 6; reasons.push("약한 비 - 긴 산책 감점"); }
      return { bonus: bonus, reasons: reasons };
    }

    // RAIN / HEAVY_RAIN
    if (indoorLike) {
      bonus += (cls === "HEAVY_RAIN" ? 16 : 13);
      reasons.push((CLASS_LABEL[cls]) + " - 실내 볼거리 우선 추천");
    }
    if (place.category === "DRIVE") {
      if (cls === "RAIN" && !wind) { bonus += 15; reasons.push("비 - 차량 이동(드라이브) 비중 확대"); }
      else if (cls === "RAIN" && wind) { bonus -= 4; reasons.push("비·강풍 - 해안 드라이브 신중"); }
      else if (cls === "HEAVY_RAIN") {
        if (place.weatherProfile.strongWind >= 50) { bonus += 4; reasons.push("강한 비 - 주요 도로 위주 이동"); }
        else { bonus -= 10; reasons.push("강한 비·노출 구간 - 해안도로 감점"); }
      }
    }
    if (place.category === "CAFE") {
      bonus += (cls === "HEAVY_RAIN" ? 8 : 7);
      if (place.scenic >= 70) reasons.push("비 - 바다 조망 실내 카페 가치 상승");
    }
    if (place.category === "FOOD") {
      bonus += 4;
      if (place.parking && place.parking.difficulty === "easy") { bonus += 2; reasons.push("비 - 주차 편한 식당 우선"); }
    }
    if (["BEACH"].indexOf(place.category) >= 0) { bonus -= (cls === "HEAVY_RAIN" ? 22 : 14); reasons.push(CLASS_LABEL[cls] + " - 해변 감점"); }
    if (["COAST", "PHOTO_SPOT"].indexOf(place.category) >= 0) { bonus -= (cls === "HEAVY_RAIN" ? 16 : 9); reasons.push(CLASS_LABEL[cls] + " - 노출 해안 포인트 감점"); }
    if (place.category === "OBSERVATORY" && !place.partialIndoor) { bonus -= (cls === "HEAVY_RAIN" ? 18 : 10); reasons.push(CLASS_LABEL[cls] + " - 노출 전망대 감점"); }
    if (place.category === "WALK") { bonus -= (cls === "HEAVY_RAIN" ? 18 : 10); reasons.push(CLASS_LABEL[cls] + " - 장시간 산책 감점"); }

    return { bonus: bonus, reasons: reasons };
  }

  /* 호우·강풍 안전 감점 0..40 (+사유) */
  function applyHeavyRainSafetyPenalty(place, cls, agg) {
    var penalty = 0, reasons = [];
    var wind = isWindDanger(agg), severe = isSevereWind(agg);
    if (cls !== "HEAVY_RAIN" && !wind) return { penalty: 0, reasons: reasons };

    var exposedCats = ["BEACH", "COAST", "PHOTO_SPOT", "WALK"];
    var exposedObs = place.category === "OBSERVATORY" && !place.partialIndoor;

    if (exposedCats.indexOf(place.category) >= 0 || exposedObs) {
      penalty += cls === "HEAVY_RAIN" ? 22 : 12;
      reasons.push("호우 시 해안 노출 구간 - 안전 감점");
      if (severe) { penalty += 8; reasons.push("강풍 - 방파제·전망 포인트 제외 권장"); }
    }
    if (place.category === "DRIVE" && place.weatherProfile.strongWind < 45) {
      penalty += cls === "HEAVY_RAIN" ? 16 : 8;
      reasons.push("호우·강풍 - 위험 해안도로 감점, 주요 도로 우선");
    }
    if (place.parking && place.parking.difficulty === "hard") {
      penalty += 4; reasons.push("우천 시 주차 어려움 추가 감점");
    }
    return { penalty: clamp(penalty, 0, 40), reasons: reasons };
  }

  /* 종합 기상 위험 감점 0..40 */
  function calculateWeatherRiskPenalty(place, cls, agg) {
    var safe = applyHeavyRainSafetyPenalty(place, cls, agg);
    var p = safe.penalty;
    if ((cls === "RAIN") && place.weatherProfile[CLASS_KEY[cls]] < 30 && !DATA.isIndoorLike(place)) {
      p += 8;
    }
    return { penalty: clamp(p, 0, 40), reasons: safe.reasons };
  }

  /* 생성된 하루 일정을 날씨에 맞춰 재구성.
     - 도시 순서(북상/남하)는 유지. 회랑 단조성을 깨지 않습니다.
     - 안전 우선: 드라이브/실내를 앞쪽, 노출 야외를 뒤쪽으로 완만히 정렬.
     - 노출 야외는 체류시간 축소, 실내는 유지/소폭 확대.
     - 큰 역주행(회랑 6 이상 후퇴)이 생기면 회랑순으로 되돌립니다. */
  function rebuildScheduleForWeather(items, cls, agg) {
    if (!items || !items.length) return { items: items, changed: false, notes: [] };
    var notes = [];
    var rainy = (cls === "RAIN" || cls === "HEAVY_RAIN");
    var lightly = (cls === "LIGHT_RAIN");
    if (!rainy && !lightly) return { items: items.slice(), changed: false, notes: [] };

    function bucket(it) {
      var p = it.place;
      if (p.category === "DRIVE") return 0;
      if (DATA.isIndoorLike(p)) return 1;
      if (p.category === "FOOD") return 2;
      if (p.category === "CAFE") return 3;
      return 5; // 노출 야외
    }

    var indexed = items.map(function (it, i) { return { it: it, i: i, b: bucket(it), c: it.place.corridor }; });
    var reordered = indexed.slice().sort(function (a, b) {
      if (rainy && a.b !== b.b) return a.b - b.b;
      return a.c - b.c || a.i - b.i;
    }).map(function (x) { return x.it; });

    // 회랑 후퇴 검사
    var maxBack = 0;
    for (var k = 1; k < reordered.length; k++) {
      var back = reordered[k - 1].place.corridor - reordered[k].place.corridor;
      if (back > maxBack) maxBack = back;
    }
    var finalItems;
    if (maxBack > 6) {
      finalItems = items.slice().sort(function (a, b) { return a.place.corridor - b.place.corridor; });
      notes.push("역주행 방지를 위해 도시 순서를 유지했습니다.");
    } else {
      finalItems = reordered;
      if (rainy) notes.push("드라이브·실내 일정을 앞쪽으로, 노출 야외를 뒤쪽으로 조정했습니다.");
    }

    // 체류시간 조정 + 액션 태그
    finalItems.forEach(function (it) {
      var p = it.place;
      var exposed = ["BEACH", "COAST", "PHOTO_SPOT", "WALK"].indexOf(p.category) >= 0 || (p.category === "OBSERVATORY" && !p.partialIndoor);
      if (rainy && exposed) {
        it.adjustedStayMin = Math.max(20, Math.round(p.stayMin * (cls === "HEAVY_RAIN" ? 0.4 : 0.6)));
        it.weatherAction = "shortened";
        it.weatherActionText = "우천으로 체류시간을 " + it.adjustedStayMin + "분으로 축소";
      } else if (rainy && DATA.isIndoorLike(p)) {
        it.adjustedStayMin = Math.round(p.stayMin * 1.1);
        it.weatherAction = "extended";
        it.weatherActionText = "실내 관람 - 체류시간 유지/확대";
      } else if (lightly && exposed && p.category === "WALK") {
        it.adjustedStayMin = Math.max(25, Math.round(p.stayMin * 0.75));
        it.weatherAction = "shortened";
        it.weatherActionText = "약한 비 - 산책 시간 축소";
      } else {
        it.adjustedStayMin = p.stayMin;
        it.weatherAction = null;
      }
    });

    return { items: finalItems, changed: true, notes: notes };
  }

  global.WeatherStrategy = {
    CLASSES: CLASSES, CLASS_LABEL: CLASS_LABEL, CLASS_KEY: CLASS_KEY,
    isWindDanger: isWindDanger, isSevereWind: isSevereWind,
    classifyWeather: classifyWeather,
    calculateRainRisk: calculateRainRisk,
    calculateWeatherConfidence: calculateWeatherConfidence,
    calculateWeatherFitScore: calculateWeatherFitScore,
    applyRainStrategy: applyRainStrategy,
    applyHeavyRainSafetyPenalty: applyHeavyRainSafetyPenalty,
    calculateWeatherRiskPenalty: calculateWeatherRiskPenalty,
    rebuildScheduleForWeather: rebuildScheduleForWeather
  };
})(window);
