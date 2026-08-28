/* =============================================================
   weather.js - 다중 날씨 엔진
   -------------------------------------------------------------
   - 하나의 공급자만 사용하지 않습니다.
   - Open-Meteo(키 불필요, 실호출) + 기상청 + OpenWeather 어댑터.
   - 키가 없는 공급자는 Open-Meteo 값을 결정적으로 변형한
     "데모(파생)" 뷰로 대체하고 화면에 그 사실을 표시합니다.
   - 강제 시나리오: ?weather=clear|light-rain|rain|heavy-rain|disagree
   ============================================================= */
(function (global) {
  "use strict";

  var C = global.CONFIG;

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function hash(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 16777619) >>> 0; } return h; }
  function det(str) { return (hash(str) % 1000) / 1000; } // 0..1 결정적

  function bandOf(hour) { return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"; }

  /* ---------- 정규화 스키마 ---------- */
  function emptyBands() {
    return { morning: { pop: 0, precipMm: 0 }, afternoon: { pop: 0, precipMm: 0 }, evening: { pop: 0, precipMm: 0 } };
  }

  function normalizeOpenMeteo(region, date, json) {
    var d = json.daily || {};
    var idx = (d.time || []).indexOf(date);
    if (idx < 0) idx = 0;
    var out = {
      region: region, date: date, provider: "Open-Meteo", providerKind: "ecmwf-ensemble",
      sourceKind: "live",
      pop: clamp(Math.round((d.precipitation_probability_max || [])[idx] || 0), 0, 100),
      precipMm: +(((d.precipitation_sum || [])[idx]) || 0).toFixed(1),
      windMs: +(((d.windspeed_10m_max || [])[idx] || 0) / 3.6).toFixed(1),
      gustMs: +(((d.windgusts_10m_max || [])[idx] || 0) / 3.6).toFixed(1),
      tempMax: Math.round((d.temperature_2m_max || [])[idx]),
      tempMin: Math.round((d.temperature_2m_min || [])[idx]),
      sunrise: ((d.sunrise || [])[idx] || "").slice(11, 16),
      sunset: ((d.sunset || [])[idx] || "").slice(11, 16),
      humidity: null,
      bands: emptyBands()
    };
    var h = json.hourly || {};
    var times = h.time || [];
    var acc = { morning: [], afternoon: [], evening: [] };
    var accMm = { morning: 0, afternoon: 0, evening: 0 };
    var hums = [];
    for (var i = 0; i < times.length; i++) {
      if (times[i].slice(0, 10) !== date) continue;
      var hr = parseInt(times[i].slice(11, 13), 10);
      var b = bandOf(hr);
      var pp = (h.precipitation_probability || [])[i];
      if (pp != null) acc[b].push(pp);
      var pm = (h.precipitation || [])[i];
      if (pm != null) accMm[b] += pm;
      var rh = (h.relative_humidity_2m || [])[i];
      if (rh != null) hums.push(rh);
    }
    ["morning", "afternoon", "evening"].forEach(function (b) {
      var arr = acc[b];
      out.bands[b].pop = arr.length ? Math.round(arr.reduce(function (s, v) { return s + v; }, 0) / arr.length) : out.pop;
      out.bands[b].precipMm = +accMm[b].toFixed(1);
    });
    if (hums.length) out.humidity = Math.round(hums.reduce(function (s, v) { return s + v; }, 0) / hums.length);
    return out;
  }

  /* 키 없는 공급자용: Open-Meteo 값을 결정적으로 변형한 데모 뷰 */
  function syntheticView(base, providerName, providerKind, seedKey) {
    var r = det(seedKey + providerName);
    var offset = Math.round((r - 0.5) * 26); // -13 .. +13
    var v = {
      region: base.region, date: base.date, provider: providerName, providerKind: providerKind,
      sourceKind: "demo",
      pop: clamp(base.pop + offset, 0, 100),
      precipMm: +Math.max(0, base.precipMm * (0.7 + r * 0.7)).toFixed(1),
      windMs: +Math.max(0, base.windMs + (r - 0.5) * 2).toFixed(1),
      gustMs: +Math.max(0, base.gustMs + (r - 0.5) * 3).toFixed(1),
      tempMax: base.tempMax != null ? base.tempMax + (r > 0.6 ? 1 : 0) : null,
      tempMin: base.tempMin != null ? base.tempMin - (r < 0.4 ? 1 : 0) : null,
      sunrise: base.sunrise, sunset: base.sunset, humidity: base.humidity,
      bands: {
        morning: { pop: clamp(base.bands.morning.pop + offset, 0, 100), precipMm: base.bands.morning.precipMm },
        afternoon: { pop: clamp(base.bands.afternoon.pop + offset, 0, 100), precipMm: base.bands.afternoon.precipMm },
        evening: { pop: clamp(base.bands.evening.pop + offset, 0, 100), precipMm: base.bands.evening.precipMm }
      }
    };
    return v;
  }

  /* ---------- 강제 시나리오 fixture ---------- */
  var SCENARIO_POP = { "clear": 8, "light-rain": 38, "rain": 72, "heavy-rain": 94 };
  function fixtureViews(scenario, region, date) {
    if (scenario === "disagree") {
      // §55: 공급자 간 큰 편차
      return [
        mkView("기상청", "kma", "demo", region, date, 20, 1.0, 4, 6),
        mkView("OpenWeather", "openweather", "demo", region, date, 75, 6.0, 6, 9),
        mkView("Open-Meteo", "ecmwf-ensemble", "demo", region, date, 50, 3.0, 5, 7)
      ];
    }
    var base = SCENARIO_POP[scenario];
    if (base == null) return null;
    var mm = scenario === "heavy-rain" ? 42 : scenario === "rain" ? 12 : scenario === "light-rain" ? 2 : 0;
    var wind = scenario === "heavy-rain" ? 12 : scenario === "rain" ? 7 : 4;
    var gust = wind + 5;
    return [
      mkView("기상청", "kma", "demo", region, date, base + 4, mm * 1.1, wind, gust),
      mkView("OpenWeather", "openweather", "demo", region, date, base - 5, mm * 0.9, wind - 1, gust - 1),
      mkView("Open-Meteo", "ecmwf-ensemble", "demo", region, date, base, mm, wind, gust)
    ];
  }
  function mkView(name, kind, src, region, date, pop, mm, wind, gust) {
    pop = clamp(Math.round(pop), 0, 100);
    return {
      region: region, date: date, provider: name, providerKind: kind, sourceKind: src,
      pop: pop, precipMm: +Math.max(0, mm).toFixed(1), windMs: +wind.toFixed(1), gustMs: +gust.toFixed(1),
      tempMax: 24, tempMin: 18, sunrise: "05:45", sunset: "19:10", humidity: 70,
      bands: {
        morning: { pop: pop, precipMm: +(mm * 0.5).toFixed(1) },
        afternoon: { pop: clamp(pop - 6, 0, 100), precipMm: +(mm * 0.3).toFixed(1) },
        evening: { pop: clamp(pop - 12, 0, 100), precipMm: +(mm * 0.2).toFixed(1) }
      }
    };
  }

  /* ---------- 종합 & 신뢰도 ---------- */
  function aggregateWeather(views) {
    var w = views.map(function (v) { return v.sourceKind === "live" ? 1 : 0.6; });
    var wsum = w.reduce(function (s, v) { return s + v; }, 0) || 1;
    function wm(fn) { var s = 0; views.forEach(function (v, i) { var x = fn(v); if (x != null) s += x * w[i]; }); return s / wsum; }
    var agg = {
      region: views[0].region, date: views[0].date,
      pop: Math.round(wm(function (v) { return v.pop; })),
      precipMm: +wm(function (v) { return v.precipMm; }).toFixed(1),
      windMs: +wm(function (v) { return v.windMs; }).toFixed(1),
      gustMs: +wm(function (v) { return v.gustMs; }).toFixed(1),
      tempMax: Math.round(wm(function (v) { return v.tempMax; })),
      tempMin: Math.round(wm(function (v) { return v.tempMin; })),
      humidity: Math.round(wm(function (v) { return v.humidity != null ? v.humidity : 0; })) || null,
      sunrise: views[0].sunrise, sunset: views[0].sunset,
      bands: {
        morning: { pop: Math.round(wm(function (v) { return v.bands.morning.pop; })), precipMm: +wm(function (v) { return v.bands.morning.precipMm; }).toFixed(1) },
        afternoon: { pop: Math.round(wm(function (v) { return v.bands.afternoon.pop; })), precipMm: +wm(function (v) { return v.bands.afternoon.precipMm; }).toFixed(1) },
        evening: { pop: Math.round(wm(function (v) { return v.bands.evening.pop; })), precipMm: +wm(function (v) { return v.bands.evening.precipMm; }).toFixed(1) }
      },
      providers: views.map(function (v) { return { name: v.provider, pop: v.pop, kind: v.sourceKind }; })
    };
    var agr = calculateForecastAgreement(views);
    agg.agreement = agr;
    agg.confidence = agr.confidence;
    agg.uncertain = agr.uncertain;
    agg.liveProviderCount = views.filter(function (v) { return v.sourceKind === "live"; }).length;
    return agg;
  }

  function calculateForecastAgreement(views) {
    var pops = views.map(function (v) { return v.pop; });
    var mean = pops.reduce(function (s, v) { return s + v; }, 0) / pops.length;
    var variance = pops.reduce(function (s, v) { return s + (v - mean) * (v - mean); }, 0) / pops.length;
    var sd = Math.sqrt(variance);
    var spread = Math.max.apply(null, pops) - Math.min.apply(null, pops);
    var confidence = spread <= 15 ? "높음" : spread <= 30 ? "보통" : "낮음";
    return { stdev: +sd.toFixed(1), spread: spread, mean: Math.round(mean), confidence: confidence, uncertain: spread > 35 };
  }
  var calculateWeatherConfidence = calculateForecastAgreement;

  /* ---------- 공급자 호출 ---------- */
  function fetchOpenMeteo(region, center, date, nextDate) {
    var url = C.OPEN_METEO_BASE +
      "?latitude=" + center[0] + "&longitude=" + center[1] +
      "&daily=precipitation_probability_max,precipitation_sum,windspeed_10m_max,windgusts_10m_max,temperature_2m_max,temperature_2m_min,sunrise,sunset" +
      "&hourly=precipitation_probability,precipitation,relative_humidity_2m" +
      "&timezone=Asia%2FSeoul&forecast_days=7";
    return fetch(url).then(function (r) { if (!r.ok) throw new Error("open-meteo " + r.status); return r.json(); })
      .then(function (json) {
        return {
          json: json,
          today: normalizeOpenMeteo(region, date, json),
          tomorrow: normalizeOpenMeteo(region, nextDate, json)
        };
      });
  }

  /* 기상청 어댑터 (키 필요, CORS 제약 -> 실운영은 서버 프록시). 미구현 시 null */
  function fetchKMA(region, center, date) {
    if (!C.KMA_API_KEY) return Promise.resolve(null);
    // 실제 연동 지점: 단기예보 조회 API. 여기서는 인터페이스만 유지.
    return Promise.resolve(null);
  }
  function fetchOpenWeather(region, center, date) {
    if (!C.OPENWEATHER_API_KEY) return Promise.resolve(null);
    return Promise.resolve(null);
  }

  var Weather = {
    aggregateWeather: aggregateWeather,
    calculateForecastAgreement: calculateForecastAgreement,
    calculateWeatherConfidence: calculateWeatherConfidence,
    normalizeOpenMeteo: normalizeOpenMeteo,

    /* regions: [{name, center:[lat,lng]}], dates: ['YYYY-MM-DD', ...] (여행 전체 날짜)
       return: Promise<{ status, updatedAt, byRegion: { region: { byDate:{date:agg}, today, tomorrow } } }> */
    fetchAll: function (regions, dates, forcedScenario) {
      if (typeof dates === "string") dates = [dates, addDay(dates, 1)];
      if (!dates.length) dates = [new Date().toISOString().slice(0, 10)];
      var displayDates = dates.slice();
      // 오늘/내일 카드용으로 최소 2일 확보
      if (displayDates.length === 1) displayDates.push(addDay(displayDates[0], 1));

      var results = {};
      var anyLive = false, anyFail = false;

      function buildFromViewsPerDate(makeViews) {
        var byDate = {};
        displayDates.forEach(function (dt) { byDate[dt] = aggregateWeather(makeViews(dt)); });
        return byDate;
      }

      var jobs = regions.map(function (rg) {
        if (forcedScenario && fixtureViews(forcedScenario, rg.name, displayDates[0])) {
          var byDate = buildFromViewsPerDate(function (dt) { return fixtureViews(forcedScenario, rg.name, dt); });
          results[rg.name] = { byDate: byDate, today: byDate[displayDates[0]], tomorrow: byDate[displayDates[1]], scenario: forcedScenario };
          return Promise.resolve();
        }
        var first = displayDates[0];
        return fetchOpenMeteo(rg.name, rg.center, first, addDay(first, 1)).then(function (om) {
          anyLive = true;
          return Promise.all([fetchKMA(rg.name, rg.center, first), fetchOpenWeather(rg.name, rg.center, first)])
            .then(function (extra) {
              var byDate = {};
              displayDates.forEach(function (dt) {
                var omDay = normalizeOpenMeteo(rg.name, dt, om.json);
                var views = [omDay];
                extra.forEach(function (e, i) {
                  var pname = i === 0 ? "기상청" : "OpenWeather";
                  var pkind = i === 0 ? "kma" : "openweather";
                  if (e && e.json) {
                    /* 실 어댑터 연동 시 normalize 후 push */
                  } else if (C.ALLOW_SYNTHETIC_PROVIDERS) {
                    views.push(syntheticView(omDay, pname, pkind, rg.name + dt));
                  }
                });
                byDate[dt] = aggregateWeather(views);
              });
              results[rg.name] = { byDate: byDate, today: byDate[displayDates[0]], tomorrow: byDate[displayDates[1]] };
            });
        }).catch(function () {
          anyFail = true;
          results[rg.name] = null;
        });
      });

      return Promise.all(jobs).then(function () {
        var status = forcedScenario ? "DEMO(강제 시나리오)"
          : (anyLive && !anyFail) ? "LIVE"
          : (anyLive && anyFail) ? "PARTIAL LIVE"
          : "DEMO";
        C.DATA_BASELINE.weatherUpdatedAt = new Date().toISOString();
        return { status: status, updatedAt: C.DATA_BASELINE.weatherUpdatedAt, byRegion: results, dates: displayDates };
      });
    }
  };

  function addDay(d, n) { var t = new Date(d + "T12:00:00"); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); }

  global.Weather = Weather;
})(window);
