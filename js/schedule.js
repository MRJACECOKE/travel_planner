/* =============================================================
   schedule.js - DAY 일정 생성 파이프라인
   -------------------------------------------------------------
   buildDailySchedule() / buildTrip()
   §48 파이프라인 단계를 구현합니다. 회랑 단조 진행(북상/남하) 유지,
   우천 시 드라이브·실내 비중 확대, 영업시간·체류시간·이동시간 반영.
   ============================================================= */
(function (global) {
  "use strict";

  var C = global.CONFIG, L = C.LIMITS;
  var RO = global.RouteOptimizer, WS = global.WeatherStrategy, REC = global.Recommendation;

  function toMin(hhmm) { var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ""); return m ? (+m[1]) * 60 + (+m[2]) : 8 * 60; }
  function toHHMM(min) { min = Math.round(min); var h = Math.floor(min / 60) % 24; var m = min % 60; return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m; }
  function addDate(d, n) { var t = new Date(d + "T12:00:00"); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); }
  function weekday(d) { return new Date(d + "T12:00:00").getDay(); }

  function isOpenAt(place, date, arriveMin, stayMin) {
    if (place.category === "DRIVE") return true;
    if (place.closedDays && place.closedDays.indexOf(weekday(date)) >= 0) return false;
    var oh = place.openingHours || "상시";
    if (oh === "상시" || oh === "24시간") return true;
    var m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(oh);
    if (!m) return true;
    var open = (+m[1]) * 60 + (+m[2]), close = (+m[3]) * 60 + (+m[4]);
    return arriveMin >= open - 10 && arriveMin <= close - Math.min(stayMin, 30);
  }

  function getRegionWeather(weatherData, region, date) {
    var rg = weatherData && weatherData.byRegion && weatherData.byRegion[region];
    if (!rg) return null;
    if (rg.byDate && rg.byDate[date]) return rg.byDate[date];
    return rg.today || null;
  }

  /* 하루 후보 선택: 식사/카페/실내/드라이브 우선 확보 후 상위 점수로 채움 */
  function selectDayPlaces(scored, opts) {
    var chosen = [], ids = {}, foodCount = 0, cafeCount = 0;
    var maxPlaces = opts.maxPlaces, maxCafe = opts.maxCafe;

    function canAdd(rc) {
      if (chosen.length >= maxPlaces) return false;
      if (ids[rc.place.id]) return false;
      if (rc.place.category === "CAFE" && cafeCount >= maxCafe) return false;
      if (rc.place.category === "FOOD" && foodCount >= 2) return false;
      if (rc.penalties.backtracking >= 20) return false; // 큰 역주행 차단
      return true;
    }
    function add(rc) {
      if (!rc || !canAdd(rc)) return false;
      chosen.push(rc); ids[rc.place.id] = 1;
      if (rc.place.category === "FOOD") foodCount++;
      if (rc.place.category === "CAFE") cafeCount++;
      return true;
    }
    function pick(pred) {
      for (var i = 0; i < scored.length; i++) {
        var rc = scored[i];
        if (ids[rc.place.id]) continue;
        if (rc.score < -40) continue;
        if (pred(rc)) return rc;
      }
      return null;
    }

    // §3 우천 시 우선순위: 1) 드라이브 2) 실내 볼거리 3) 맛집 4) 실내 카페 ...
    // 단, 호우+강풍(severe)이면 해안도로 자체를 우선 확보하지 않고 실내로 대체 (§6)
    // 1) 점심
    add(pick(function (rc) { return rc.place.category === "FOOD"; }));
    // 2) 드라이브 #1 (우천/해안도로 선호 시 최우선 확보, severe 제외)
    if (!opts.severe && (opts.rainy || opts.coastalPref >= 0.5)) {
      add(pick(function (rc) { return rc.place.category === "DRIVE"; }));
    }
    // 3) 우천 시 실내 볼거리 #1
    if (opts.rainy) {
      add(pick(function (rc) { return DATA.isIndoorLike(rc.place); }));
    }
    // 4) 우천 시 드라이브 #2 (실내 2곳째보다 우선, severe 제외)
    if (opts.rainy && !opts.severe) {
      add(pick(function (rc) { return rc.place.category === "DRIVE"; }));
    }
    // 5) severe: 실내 볼거리를 한 곳 더 우선 확보
    if (opts.severe) add(pick(function (rc) { return DATA.isIndoorLike(rc.place); }));
    // 6) 저녁
    if (opts.wantDinner) add(pick(function (rc) { return rc.place.category === "FOOD"; }));
    // 7) 카페
    add(pick(function (rc) { return rc.place.category === "CAFE"; }));
    // 8) 우천 시 실내 볼거리 #2
    if (opts.rainy) add(pick(function (rc) { return DATA.isIndoorLike(rc.place); }));
    // 9) 상위 점수로 채우기 (우천/호우일수록 최소 점수 기준을 높여 저품질 야외 배제)
    var fillMin = opts.severe ? 45 : opts.rainy ? 22 : 0;
    for (var i = 0; i < scored.length && chosen.length < maxPlaces; i++) {
      if (scored[i].score >= fillMin) add(scored[i]);
    }
    return chosen;
  }

  /* 타임라인 계산 */
  function buildTimeline(startPoint, orderedItems, ctx) {
    var clock = ctx.startMin;
    var cursor = startPoint;
    var legs = [], totalDriveMin = 0, totalKm = 0;
    var driveOpts = {
      weatherClass: ctx.weatherClass,
      coastalPreference: ctx.coastalPref,
      avoidCoastal: (ctx.weatherClass === "HEAVY_RAIN") || (ctx.weatherClass === "RAIN" && ctx.windDanger)
    };

    orderedItems.forEach(function (it, idx) {
      var t = RO.estimateTravelMinutes(cursor, it.place, driveOpts);
      clock += t.minutes;
      totalDriveMin += t.minutes; totalKm += t.km;
      // 2시간 주행마다 휴식 가산
      if (totalDriveMin > 0 && totalDriveMin % 120 < t.minutes) clock += C.DRIVE.restPer2hMin;

      var stay = it.adjustedStayMin || it.place.stayMin;
      it.leg = idx + 1;
      it.arriveMin = clock;
      it.arrive = toHHMM(clock);
      it.travelMin = t.minutes;
      it.travelKm = t.km;
      it.roadType = t.roadType;
      it.stayMin = stay;
      it.open = isOpenAt(it.place, ctx.date, clock, stay);
      clock += stay;
      it.leaveMin = clock;
      it.leave = toHHMM(clock);
      legs.push({ fromId: cursor.id || "start", toId: it.place.id, min: t.minutes, km: t.km, roadType: t.roadType });
      cursor = it.place;
    });

    // 추가 우회시간: 이 장소를 들르느라 늘어난 이동시간 (앞뒤 지점 직선 경로 대비)
    orderedItems.forEach(function (it, idx) {
      var prev = idx === 0 ? startPoint : orderedItems[idx - 1].place;
      var next = idx === orderedItems.length - 1 ? null : orderedItems[idx + 1].place;
      if (!next) {
        it.detourMin = it.place.inland ? C.DRIVE.inlandExtraMin : (it.place.peninsula ? C.DRIVE.peninsulaExtraMin : 0);
        return;
      }
      var direct = RO.estimateTravelMinutes(prev, next, driveOpts).minutes;
      var via = it.travelMin + RO.estimateTravelMinutes(it.place, next, driveOpts).minutes;
      it.detourMin = Math.max(0, Math.round(via - direct));
    });

    return { items: orderedItems, legs: legs, endMin: clock, driveMin: totalDriveMin, km: +totalKm.toFixed(1) };
  }

  /* 하루 일정 */
  function buildDailySchedule(params) {
    var dir = params.dir, prefs = params.prefs || {};
    var weather = params.weather; // agg for the day's main region
    var cls = weather ? WS.classifyWeather(weather) : "CLEAR";
    var windDanger = weather ? WS.isWindDanger(weather) : false;
    var rainy = (cls === "RAIN" || cls === "HEAVY_RAIN");

    var band = params.corridorBand; // [lo, hi]
    var targetRegionIdx = params.targetRegionIdx;

    // 후보: 미사용 + 회랑 밴드 내 + 방향상 과도한 역주행 제외
    var pool = params.candidates.filter(function (p) {
      if (params.usedIds[p.id]) return false;
      if (p.corridor < band[0] - 3 || p.corridor > band[1] + 4) return false;
      return true;
    });

    var ctx = {
      dir: dir, lastCorridor: params.lastCorridor, targetRegionIdx: targetRegionIdx,
      weatherClass: cls, agg: weather || {}, prefs: prefs
    };
    var scored = REC.scoreCandidates(pool, ctx);

    var maxPlaces = prefs.maxPlacesPerDay || L.maxPlacesPerDay;
    if (rainy) maxPlaces = Math.min(8, maxPlaces + 1); // 우천일은 드라이브+실내 조합으로 조밀해질 수 있음
    var maxCafe = prefs.maxCafePerDay || L.maxCafePerDay;
    var driveBudget = (prefs.maxDriveHours ? prefs.maxDriveHours * 60 : L.maxDriveMinutesPerDay);

    var severe = (cls === "HEAVY_RAIN") && windDanger;
    var wantDinner = params.plannedEndMin >= toMin(L.dinnerWindow[0]);
    var selected = selectDayPlaces(scored, {
      maxPlaces: maxPlaces, maxCafe: maxCafe, rainy: rainy, severe: severe,
      coastalPref: prefs.coastalRoadPref != null ? prefs.coastalRoadPref : 0.5,
      wantDinner: wantDinner
    });

    // 회랑 순 정렬
    var ordered = selected.slice().sort(function (a, b) {
      return dir === "south" ? b.place.corridor - a.place.corridor : a.place.corridor - b.place.corridor;
    }).map(function (rc) { return { place: rc.place, rc: rc }; });

    // 우천 재구성 (도시 순서 유지, 활동 순서/체류시간 조정)
    var rebuilt = WS.rebuildScheduleForWeather(ordered, cls, weather || {});
    ordered = rebuilt.items;

    var timelineCtx = {
      startMin: params.startMin, date: params.date, weatherClass: cls,
      coastalPref: prefs.coastalRoadPref != null ? prefs.coastalRoadPref : 0.5, windDanger: windDanger
    };
    var tl = buildTimeline(params.startPoint, ordered, timelineCtx);

    // 영업시간 검사: 도착 시각에 문을 닫는 실내 시설은 제외하고 재계산 (§48-18)
    var closedRemoved = [];
    var ohGuard = 0;
    while (ohGuard < 3) {
      ohGuard++;
      var closedIdx = -1;
      for (var oi = 0; oi < ordered.length; oi++) {
        var oit = ordered[oi];
        var fixedHours = oit.place.category === "DRIVE" || oit.place.openingHours === "상시" || oit.place.openingHours === "24시간";
        if (!fixedHours && !oit.open) { closedIdx = oi; break; }
      }
      if (closedIdx < 0) break;
      closedRemoved.push(ordered[closedIdx]);
      ordered.splice(closedIdx, 1);
      tl = buildTimeline(params.startPoint, ordered, timelineCtx);
    }

    // 예산 초과 시 하위 항목 제거하며 재계산
    var guard = 0;
    while ((tl.driveMin > driveBudget * 1.15 || tl.endMin > params.plannedEndMin + 60) && ordered.length > 2 && guard < 6) {
      guard++;
      // 식사 아닌 항목 중 최저 점수 제거
      var worstIdx = -1, worst = Infinity;
      ordered.forEach(function (it, i) {
        if (it.place.category === "FOOD") return;
        if (it.rc.score < worst) { worst = it.rc.score; worstIdx = i; }
      });
      if (worstIdx < 0) break;
      ordered.splice(worstIdx, 1);
      tl = buildTimeline(params.startPoint, ordered, timelineCtx);
    }

    // 제외 목록 + 사유
    var chosenIds = {};
    ordered.forEach(function (it) { chosenIds[it.place.id] = 1; });
    var excluded = closedRemoved.map(function (it) {
      return { place: it.place, score: it.rc.score, reason: "예상 도착 시각에 운영시간(" + it.place.openingHours + ")이 종료되어 제외" };
    });
    excluded = excluded.concat(scored.filter(function (rc) { return !chosenIds[rc.place.id]; }).slice(0, 8).map(function (rc) {
      var reason;
      if (rc.penalties.backtracking >= 8) reason = "현재 " + (dir === "south" ? "남하" : "북상") + " 동선에서 약 " + Math.round(rc.penalties.backtracking / 3.5 * 2) + "분 역주행 발생";
      else if (rc.penalties.weatherRisk >= 12) reason = rainy ? "우천 시 야외 체류 비중이 높아 대체 실내 관광지를 우선" : "기상 위험으로 낮게 평가";
      else if (rc.penalties.detour >= 12) reason = rc.place.inland ? "내륙 진입 우회가 커서 이번 일정에서 제외" : "우회 이동 부담으로 제외";
      else reason = "시간·장소 상한으로 이번 일정에서 제외";
      return { place: rc.place, score: rc.score, reason: reason };
    }));

    var meals = ordered.filter(function (it) { return it.place.category === "FOOD"; });
    var cafes = ordered.filter(function (it) { return it.place.category === "CAFE"; });
    var drives = ordered.filter(function (it) { return it.place.category === "DRIVE"; });
    var indoors = ordered.filter(function (it) { return DATA.isIndoorLike(it.place); });

    return {
      dir: dir, date: params.date, dayIndex: params.dayIndex,
      region: DATA.PLACES[0] && "", // placeholder
      mainRegion: C.REGION_ORDER[targetRegionIdx],
      regions: unique(ordered.map(function (it) { return it.place.region; })),
      weather: weather || null,
      weatherClass: cls, weatherLabel: WS.CLASS_LABEL[cls],
      windDanger: windDanger,
      rainAdaptive: rainy || (cls === "LIGHT_RAIN"),
      rebuildNotes: rebuilt.notes,
      items: ordered.map(function (it) { return decorateItem(it, cls); }),
      excluded: excluded,
      stats: {
        driveMin: tl.driveMin, km: tl.km,
        places: ordered.length, indoor: indoors.length, drive: drives.length,
        food: meals.length, cafe: cafes.length,
        startTime: toHHMM(params.startMin), endTime: toHHMM(tl.endMin)
      },
      lodgingRegion: ordered.length ? ordered[ordered.length - 1].place.region : C.REGION_ORDER[targetRegionIdx],
      lastCorridor: ordered.length ? ordered[ordered.length - 1].place.corridor : params.lastCorridor,
      lastPoint: ordered.length ? ordered[ordered.length - 1].place : params.startPoint,
      endMin: tl.endMin,
      // 그날의 시작 이동: DAY1 은 출발지에서, DAY2+ 는 전날 마지막 방문지(=숙박지 인근)에서 첫 장소까지.
      // 일차 간 이동이 "순간이동" 이 아님을 명시하기 위한 구간입니다.
      dayStart: ordered.length ? {
        dayIndex: params.dayIndex,
        isOrigin: params.dayIndex === 1,
        fromName: params.startPoint.name || (params.dayIndex === 1 ? "출발지" : "전날 마지막 방문지"),
        fromRegion: params.startPoint.region || null,
        fromLat: params.startPoint.lat, fromLng: params.startPoint.lng,
        toName: ordered[0].place.name, toRegion: ordered[0].place.region,
        toLat: ordered[0].place.lat, toLng: ordered[0].place.lng,
        departAt: toHHMM(params.startMin),
        arriveAt: ordered[0].arrive,
        min: ordered[0].travelMin, km: ordered[0].travelKm, roadType: ordered[0].roadType,
        crossRegion: params.startPoint.region ? params.startPoint.region !== ordered[0].place.region : false
      } : null
    };
  }

  function decorateItem(it, cls) {
    var p = it.place, rc = it.rc;
    var summary = global.ReviewEngine.summarize(p);
    var venueKind = p.indoor ? "실내" : p.partialIndoor ? "부분 실내"
      : (p.category === "CAFE" || p.category === "FOOD") ? "실내" : "야외";
    return {
      id: p.id, name: p.name, region: p.region, category: p.category,
      categoryLabel: DATA.CATEGORY_LABELS[p.category],
      indoor: p.indoor, partialIndoor: p.partialIndoor, venueKind: venueKind,
      indoorLike: DATA.isIndoorLike(p),
      lat: p.lat, lng: p.lng, corridor: p.corridor,
      leg: it.leg, arrive: it.arrive, leave: it.leave,
      stayMin: it.stayMin, travelMin: it.travelMin, travelKm: it.travelKm, roadType: it.roadType,
      detourMin: it.detourMin || 0,
      open: it.open, openingHours: p.openingHours, closedDays: p.closedDays,
      parking: p.parking, note: p.note,
      weatherFit: rc.sub.weatherFit,
      weatherAction: it.weatherAction || null, weatherActionText: it.weatherActionText || "",
      score: rc.score, reasons: rc.reasons, penaltyReasons: rc.penaltyReasons,
      rainBonus: rc.rainBonus, penalties: rc.penalties,
      summary: summary.text, reviewNote: summary.reviewNote,
      naverUrl: naverSearchUrl(p),
      demo: p.demo
    };
  }

  function naverSearchUrl(p) {
    return "https://map.naver.com/p/search/" + encodeURIComponent(p.region + " " + p.name);
  }

  function unique(a) { var s = {}, o = []; a.forEach(function (x) { if (!s[x]) { s[x] = 1; o.push(x); } }); return o; }

  /* 네이버 지도 길찾기 딥링크: 출발지 -> 주요 경유지(일자별 첫 장소) -> 마지막 장소.
     네이버는 경유지 포함 최대 5지점을 지원하므로 초과 시 균등 샘플링합니다. */
  function naverDirectionsUrl(origin, dayResults) {
    var pts = [{ lng: origin.lng, lat: origin.lat, name: origin.name }];
    var stops = [];
    dayResults.forEach(function (d) { d.items.forEach(function (it) { stops.push(it); }); });
    if (!stops.length) return "";
    var pick = [];
    if (stops.length <= 4) pick = stops;
    else {
      // 첫/마지막 + 균등 3개
      var idxs = [0];
      for (var k = 1; k <= 2; k++) idxs.push(Math.round(k * (stops.length - 1) / 3));
      idxs.push(stops.length - 1);
      idxs = unique(idxs.map(String)).map(Number).sort(function (a, b) { return a - b; });
      pick = idxs.map(function (i) { return stops[i]; });
    }
    pick.forEach(function (s) { pts.push({ lng: s.lng, lat: s.lat, name: s.name }); });
    var seg = pts.map(function (p) {
      return p.lng + "," + p.lat + "," + encodeURIComponent(p.name);
    });
    return "https://map.naver.com/p/directions/" + seg.join("/") + "/-/car";
  }

  /* ---------------- 전체 여행 ---------------- */
  function validateInput(input) {
    var errs = [];
    if (!input.originId) errs.push("출발지를 선택하십시오.");
    if (!input.startRegion) errs.push("여행 시작지역을 선택하십시오.");
    if (!input.endRegion) errs.push("최종 여행지역을 선택하십시오.");
    if (!input.startDate) errs.push("출발 날짜를 입력하십시오.");
    if (!input.days || input.days < 1) errs.push("여행 일수를 확인하십시오.");
    if (C.regionIndex(input.startRegion) < 0) errs.push("여행 시작지역이 추천 범위를 벗어났습니다.");
    if (C.regionIndex(input.endRegion) < 0) errs.push("최종 여행지역이 추천 범위를 벗어났습니다.");
    return errs;
  }

  function buildTrip(input, weatherData) {
    var errs = validateInput(input);
    if (errs.length) return { ok: false, errors: errs };

    var si = C.regionIndex(input.startRegion), ei = C.regionIndex(input.endRegion);
    var dir = RO.detectRouteDirection(si, ei);
    var lo = Math.min(si, ei), hi = Math.max(si, ei);
    var regionCount = hi - lo + 1;
    var days = input.days;

    var candidates = REC.filterPlacesByTravelRange(input.startRegion, input.endRegion);
    var origin = DATA.origin(input.originId) || { id: input.originId, name: input.originId, lat: 35.54, lng: 129.31, corridor: 0 };
    origin.corridor = origin.corridorRef != null ? origin.corridorRef : 0;

    // DAY 별 목표 지역 인덱스 (단조 진행). DAY1 은 시작지역, 마지막 DAY 는 최종지역.
    var dayTargetIdx = [];
    for (var d = 1; d <= days; d++) {
      var frac = days === 1 ? 1 : (d - 1) / (days - 1);
      var idx = dir === "south"
        ? hi - Math.round((regionCount - 1) * frac)
        : lo + Math.round((regionCount - 1) * frac);
      dayTargetIdx.push(idx);
    }
    // 마지막 날은 최종 지역 고정, 단조성 보정
    dayTargetIdx[days - 1] = ei;
    for (var k = 1; k < days; k++) {
      if (dir === "north" && dayTargetIdx[k] < dayTargetIdx[k - 1]) dayTargetIdx[k] = dayTargetIdx[k - 1];
      if (dir === "south" && dayTargetIdx[k] > dayTargetIdx[k - 1]) dayTargetIdx[k] = dayTargetIdx[k - 1];
    }

    var usedIds = {};
    var lastCorridor = null; // 출발지는 해안 회랑상의 지점이 아니므로 DAY1 은 역주행 제약 없음
    var startPoint = origin;
    var dayResults = [];
    var prevTargetIdx = (dir === "south") ? hi : lo;

    for (var di = 0; di < days; di++) {
      var tIdx = dayTargetIdx[di];
      var date = addDate(input.startDate, di);
      var mainRegion = C.REGION_ORDER[tIdx];
      var weather = getRegionWeather(weatherData, mainRegion, date);

      // 회랑 밴드
      var prevRegionCorr = corridorOfRegion(prevTargetIdx);
      var targetRegionCorr = corridorOfRegion(tIdx);
      var bandLo = Math.min(prevRegionCorr, targetRegionCorr) - 2;
      var bandHi = Math.max(prevRegionCorr, targetRegionCorr) + 6;
      if (dir === "single") { bandLo = corridorOfRegion(lo) - 2; bandHi = corridorOfRegion(hi) + 6; }

      var startMin = di === 0 ? toMin(input.startTime || "08:30") : toMin("08:30");
      var plannedEndMin = di === days - 1 ? toMin(input.endTime || "18:00") : toMin("19:00");

      var day = buildDailySchedule({
        dayIndex: di + 1, date: date, dir: dir,
        candidates: candidates, usedIds: usedIds,
        corridorBand: [bandLo, bandHi],
        targetRegionIdx: tIdx,
        lastCorridor: lastCorridor,
        startPoint: startPoint, startMin: startMin, plannedEndMin: plannedEndMin,
        weather: weather, prefs: input.prefs || {}
      });

      day.items.forEach(function (it) { usedIds[it.id] = 1; });
      lastCorridor = day.lastCorridor;
      startPoint = day.lastPoint;
      prevTargetIdx = tIdx;
      dayResults.push(day);
    }

    // 숙박: 당일치기(1일)가 아니면 각 밤의 숙박 지역과 모텔 중심 추천을 계산
    var lodging = [];
    if (dayResults.length >= 2) {
      for (var li = 0; li < dayResults.length - 1; li++) {
        var d = dayResults[li];
        var region = d.lodgingRegion || C.REGION_ORDER[dayTargetIdx[li]];
        var opts = DATA.lodging(region).slice(0, 3).map(function (o) {
          return {
            area: o.area, note: o.note,
            naverUrl: "https://map.naver.com/p/search/" + encodeURIComponent(region + " " + o.area + " 모텔")
          };
        });
        var lastStop = d.items.length ? d.items[d.items.length - 1] : null;
        lodging.push({
          night: li + 1,
          dayIndex: d.dayIndex,
          date: d.date,
          region: region,
          autoRegion: region,
          checkInFrom: lastStop ? lastStop.leave : d.stats.endTime,
          nearStop: lastStop ? lastStop.name : null,
          lodgingType: "모텔 중심",
          options: opts,
          searchUrl: "https://map.naver.com/p/search/" + encodeURIComponent(region + " 모텔")
        });
        d.lodging = lodging[lodging.length - 1];
      }
    }
    var lastDay = dayResults[dayResults.length - 1];
    if (lastDay) lastDay.lodging = { isLastDay: true, region: null };

    // 출발지 -> 첫 목적지 경로 (울산 등 출발지에서 이어지는 이동)
    var firstStop = dayResults[0] && dayResults[0].items[0];
    var lastStopOverall = null;
    for (var dd = dayResults.length - 1; dd >= 0 && !lastStopOverall; dd--) {
      if (dayResults[dd].items.length) lastStopOverall = dayResults[dd].items[dayResults[dd].items.length - 1];
    }
    var departure = firstStop ? {
      originId: origin.id, originName: origin.name, originLat: origin.lat, originLng: origin.lng,
      toId: firstStop.id, toName: firstStop.name, toLat: firstStop.lat, toLng: firstStop.lng,
      toRegion: firstStop.region,
      startTime: dayResults[0].stats.startTime, arriveTime: firstStop.arrive,
      min: firstStop.travelMin, km: firstStop.travelKm, roadType: firstStop.roadType,
      naverDirections: naverDirectionsUrl(origin, dayResults)
    } : null;

    var summary = summarize(input, origin, dir, dayResults);
    return {
      ok: true, dir: dir, origin: origin, input: input,
      days: dayResults, summary: summary,
      departure: departure,
      lastStop: lastStopOverall ? { name: lastStopOverall.name, region: lastStopOverall.region, lat: lastStopOverall.lat, lng: lastStopOverall.lng } : null,
      lodging: lodging,
      dayTrip: dayResults.length === 1,
      dataStatus: {
        places: DATA.status,
        weather: weatherData ? weatherData.status : "DEMO",
        weatherUpdatedAt: weatherData ? weatherData.updatedAt : null,
        reviews: global.ReviewEngine.status,
        tourInfoCheckedAt: C.DATA_BASELINE.tourInfoCheckedAt
      }
    };
  }

  function corridorOfRegion(idx) {
    var name = C.REGION_ORDER[idx];
    var meta = DATA.REGION_META[name];
    // 지역 대표 회랑값: 해당 지역 장소 회랑 평균
    var vals = DATA.PLACES.filter(function (p) { return p.region === name; }).map(function (p) { return p.corridor; });
    if (!vals.length) return idx * 10 + 10;
    return vals.reduce(function (s, v) { return s + v; }, 0) / vals.length;
  }

  function summarize(input, origin, dir, days) {
    var totalKm = 0, totalDrive = 0, spot = 0, indoor = 0, drive = 0, food = 0, cafe = 0;
    var rainDays = [];
    days.forEach(function (d, i) {
      totalKm += d.stats.km; totalDrive += d.stats.driveMin;
      d.items.forEach(function (it) {
        if (it.category === "CAFE") cafe++;
        else if (it.category === "FOOD") food++;
        else if (it.category === "DRIVE") drive++;
        else if (it.indoorLike) indoor++;
        else spot++;
      });
      if (d.rainAdaptive) rainDays.push(d.dayIndex);
    });
    var nights = Math.max(0, days.length - 1);
    return {
      title: origin.name + " → " + C.REGION_ORDER[C.regionIndex(input.endRegion)],
      period: nights + "박 " + days.length + "일",
      direction: dir === "north" ? "북상" : dir === "south" ? "남하" : "권역 집중",
      totalKm: Math.round(totalKm),
      totalDriveText: Math.floor(totalDrive / 60) + "시간 " + (totalDrive % 60) + "분",
      counts: { spot: spot, indoor: indoor, drive: drive, food: food, cafe: cafe },
      rainAdaptiveDays: rainDays
    };
  }

  global.Schedule = {
    buildTrip: buildTrip,
    buildDailySchedule: buildDailySchedule,
    validateInput: validateInput,
    isOpenAt: isOpenAt,
    _toMin: toMin, _toHHMM: toHHMM
  };
})(window);
