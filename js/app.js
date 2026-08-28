/* =============================================================
   app.js - 오케스트레이션 (§48 파이프라인 구동 + UI 배선)
   ============================================================= */
(function (global) {
  "use strict";

  var C = global.CONFIG;
  var STORE_KEY = "donghae-drive:v1";

  var appState = {
    trip: null,
    weatherData: null,
    activeDay: "all",
    forcedScenario: getParam("weather") || null, // clear|light-rain|rain|heavy-rain|disagree
    autoWeather: true,
    prefs: {}
  };

  function getParam(k) {
    var m = new RegExp("[?&]" + k + "=([^&]+)").exec(location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function $(id) { return document.getElementById(id); }

  /* ---------------- 입력 ---------------- */
  function readForm() {
    function v(id) { var e = $(id); return e ? e.value : ""; }
    function n(id, d) { var x = parseFloat(v(id)); return isNaN(x) ? d : x; }
    var prefs = {
      drivePref: n("prefDrive", 0.5),
      intensity: v("prefIntensity") || "balanced",
      foodInterest: n("prefFood", 0.6),
      cafeInterest: n("prefCafe", 0.5),
      photoInterest: n("prefPhoto", 0.5),
      natureInterest: n("prefNature", 0.6),
      indoorInterest: n("prefIndoor", 0.5),
      marketInterest: n("prefMarket", 0.4),
      coastalRoadPref: n("prefCoastal", 0.6),
      maxDriveHours: n("prefMaxDrive", 5),
      maxPlacesPerDay: Math.round(n("prefMaxPlaces", 6)),
      companions: v("prefCompanions") || "커플"
    };
    appState.prefs = Object.assign({}, prefs, appState.prefs.__overrides || {});
    appState.prefs.__overrides = appState.prefs.__overrides || {};
    return {
      originId: v("origin"),
      startRegion: v("startRegion"),
      endRegion: v("endRegion"),
      startDate: v("startDate"),
      days: Math.max(1, Math.round(n("days", 3))),
      startTime: v("startTime") || "08:30",
      endTime: v("endTime") || "18:00",
      prefs: appState.prefs
    };
  }

  function saveForm(input) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ input: stripPrefs(input), ts: Date.now() })); } catch (e) {}
  }
  function stripPrefs(input) {
    var c = Object.assign({}, input);
    c.prefs = Object.assign({}, input.prefs); delete c.prefs.__overrides;
    return c;
  }
  function restoreForm() {
    var raw;
    try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { raw = null; }
    var i = raw && raw.input;
    var today = new Date(); today.setDate(today.getDate() + 1);
    var defDate = today.toISOString().slice(0, 10);
    setVal("origin", i && i.originId || "ulsan");
    setVal("startRegion", i && i.startRegion || "포항");
    setVal("endRegion", i && i.endRegion || "강릉");
    setVal("startDate", i && i.startDate || defDate);
    setVal("days", i && i.days || 3);
    setVal("startTime", i && i.startTime || "08:30");
    setVal("endTime", i && i.endTime || "18:00");
    if (i && i.prefs) {
      var p = i.prefs;
      setVal("prefDrive", p.drivePref); setVal("prefIntensity", p.intensity);
      setVal("prefFood", p.foodInterest); setVal("prefCafe", p.cafeInterest);
      setVal("prefPhoto", p.photoInterest); setVal("prefNature", p.natureInterest);
      setVal("prefIndoor", p.indoorInterest); setVal("prefMarket", p.marketInterest);
      setVal("prefCoastal", p.coastalRoadPref); setVal("prefMaxDrive", p.maxDriveHours);
      setVal("prefMaxPlaces", p.maxPlacesPerDay); setVal("prefCompanions", p.companions);
    }
  }
  function setVal(id, val) { var e = $(id); if (e != null && val != null && val !== "") e.value = val; }

  /* ---------------- 지역/날씨 ---------------- */
  function regionsForWeather(input) {
    var si = C.regionIndex(input.startRegion), ei = C.regionIndex(input.endRegion);
    var lo = Math.min(si, ei), hi = Math.max(si, ei);
    var out = [];
    for (var k = lo; k <= hi; k++) {
      var name = C.REGION_ORDER[k];
      out.push({ name: name, center: DATA.REGION_META[name].center });
    }
    return out;
  }
  function tripDates(input) {
    var arr = [];
    for (var d = 0; d < input.days; d++) {
      var t = new Date(input.startDate + "T12:00:00"); t.setDate(t.getDate() + d);
      arr.push(t.toISOString().slice(0, 10));
    }
    return arr;
  }

  /* ---------------- 메인 실행 ---------------- */
  function run() {
    var input = readForm();
    var errs = global.Schedule.validateInput(input);
    if (errs.length) { global.UI.toast(errs[0]); return; }
    saveForm(input);

    updateScenarioBadge();
    var btn = $("buildBtn");
    if (btn) { btn.disabled = true; btn.textContent = "코스를 만드는 중..."; }
    setStatusText("최신 날씨를 불러오고 동선을 계산하고 있습니다.");

    var regions = regionsForWeather(input);
    var dates = tripDates(input);

    global.Weather.fetchAll(regions, dates, appState.forcedScenario)
      .then(function (wd) {
        appState.weatherData = wd;
        C.DATA_BASELINE.weatherUpdatedAt = wd.updatedAt;
        var names = Object.keys(wd.byRegion || {});
        var live = names.filter(function (n) { return wd.byRegion[n]; });
        if (!appState.forcedScenario && names.length && live.length === 0) {
          global.UI.toast("날씨 공급자 연결에 실패했습니다. 날씨 없이 동선만 계산합니다.");
        }
      })
      .catch(function () {
        appState.weatherData = { status: "DEMO", updatedAt: null, byRegion: {}, dates: dates };
        global.UI.toast("날씨 연결에 실패하여 날씨 없이 동선만 계산합니다.");
      })
      .then(function () {
        var wdForTrip = appState.autoWeather ? appState.weatherData : null;
        var trip = global.Schedule.buildTrip(input, wdForTrip);
        if (!trip.ok) { global.UI.toast(trip.errors[0]); return; }
        appState.trip = trip;
        appState.activeDay = "all";
        renderAll();
        setStatusText("");
        var target = $("resultTop");
        if (target && target.scrollIntoView) target.scrollIntoView({ behavior: "smooth", block: "start" });
      })
      .catch(function (e) {
        setStatusText("");
        global.UI.toast("동선 계산 중 문제가 발생했습니다. 입력을 확인하고 다시 시도하십시오.");
        if (global.console) console.error(e);
      })
      .then(function () {
        if (btn) { btn.disabled = false; btn.textContent = "동해안 코스 만들기"; }
      });
  }

  function renderAll() {
    var trip = appState.trip, wd = appState.weatherData;
    if (!trip) return;
    global.UI.renderDataStatus(trip.dataStatus);
    global.UI.renderWeather(wd, trip);
    global.UI.renderRegionWeatherDetail(wd, trip);
    global.UI.renderRainNotice(trip);
    global.UI.renderStrategyPanel(trip);
    global.UI.renderSummary(trip);
    global.UI.renderCategoryLists(trip);
    global.UI.renderLodging(trip);
    var resultWrap = $("result");
    if (resultWrap) resultWrap.hidden = false;
    renderFilterAndSchedule();
    try { global.MapView.renderOverview("overviewMap", "overviewLinks", trip); } catch (e) { if (global.console) console.warn(e); }
    if (!appState.autoWeather) {
      var n = $("rainNotice");
      if (n) n.insertAdjacentHTML("afterbegin", '<div class="notice notice--info">자동 날씨 최적화가 꺼져 있습니다. 날씨는 표시만 하고 일정에는 반영하지 않았습니다.</div>');
    }
  }

  function renderFilterAndSchedule() {
    var trip = appState.trip;
    if (!trip) return;
    global.UI.renderDayFilter(trip, appState.activeDay, function (day) {
      appState.activeDay = day;
      renderFilterAndSchedule();
    });
    global.UI.renderSchedule(trip, appState.activeDay);
    global.MapView.render("map", trip, { activeDay: appState.activeDay }).then(updateMapMode);
  }

  function updateMapMode(mode) {
    var el = $("mapMode");
    if (!el) return;
    var st = global.MapView && global.MapView.state || {};
    if (mode === "naver" && !st.authFailed) el.textContent = "네이버 지도 표시 중";
    else if (st.fileProtocol) el.textContent = "file:// 접속 - 네이버 지도 불가, 목록으로 표시";
    else if (st.authFailed) el.textContent = "네이버 지도 인증 실패 - 목록으로 표시(지도 아래 안내 확인)";
    else el.textContent = "지도 목록 표시(네이버 지도 미연결)";
  }

  function setStatusText(t) {
    var e = $("runStatus");
    if (e) { e.textContent = t || ""; e.hidden = !t; }
  }

  function updateScenarioBadge() {
    var b = $("scenarioBadge");
    if (!b) return;
    if (appState.forcedScenario) { b.hidden = false; b.textContent = "강제 날씨 시나리오: " + appState.forcedScenario; }
    else { b.hidden = true; b.textContent = ""; }
  }

  /* ---------------- 빠른 재구성 ---------------- */
  function applyQuick(kind) {
    if (!appState.trip) { global.UI.toast("먼저 코스를 만들어 주십시오."); return; }
    var ov = appState.prefs.__overrides = appState.prefs.__overrides || {};
    if (kind === "rain") { appState.forcedScenario = "rain"; global.UI.toast("우천 시나리오로 다시 계산합니다."); }
    else if (kind === "drive") {
      ov.drivePref = clamp((ov.drivePref != null ? ov.drivePref : appState.prefs.drivePref) + 0.25);
      ov.coastalRoadPref = clamp((ov.coastalRoadPref != null ? ov.coastalRoadPref : appState.prefs.coastalRoadPref) + 0.2);
      global.UI.toast("드라이브 비중을 높여 다시 계산합니다.");
    } else if (kind === "indoor") {
      ov.indoorInterest = clamp((ov.indoorInterest != null ? ov.indoorInterest : appState.prefs.indoorInterest) + 0.3);
      ov.marketInterest = clamp((ov.marketInterest != null ? ov.marketInterest : appState.prefs.marketInterest) + 0.2);
      global.UI.toast("실내 볼거리 비중을 높여 다시 계산합니다.");
    } else if (kind === "less-outdoor") {
      ov.natureInterest = clamp((ov.natureInterest != null ? ov.natureInterest : appState.prefs.natureInterest) - 0.3);
      ov.photoInterest = clamp((ov.photoInterest != null ? ov.photoInterest : appState.prefs.photoInterest) - 0.2);
      global.UI.toast("야외 일정을 줄여 다시 계산합니다.");
    }
    run();
  }
  function clamp(n) { return Math.max(0, Math.min(1, n)); }

  /* ---------------- 초기화 ---------------- */
  function fillSelects() {
    var origin = $("origin");
    if (origin && !origin.options.length) {
      DATA.ORIGINS.forEach(function (o) {
        origin.add(new Option(o.name + (["부산", "울산"].indexOf(o.name) >= 0 ? " (출발지 전용)" : ""), o.id));
      });
    }
    ["startRegion", "endRegion"].forEach(function (id) {
      var s = $(id);
      if (s && !s.options.length) C.REGION_ORDER.forEach(function (r) { s.add(new Option(r, r)); });
    });
  }

  function bind() {
    var b = $("buildBtn");
    if (b) b.addEventListener("click", run);
    var f = $("planForm");
    if (f) f.addEventListener("submit", function (e) { e.preventDefault(); run(); });
    var auto = $("autoWeather");
    if (auto) {
      auto.checked = appState.autoWeather;
      auto.addEventListener("change", function () { appState.autoWeather = auto.checked; if (appState.trip) run(); });
    }
    document.querySelectorAll("[data-quick]").forEach(function (btn) {
      btn.addEventListener("click", function () { applyQuick(btn.getAttribute("data-quick")); });
    });
    var reset = $("resetScenario");
    if (reset) reset.addEventListener("click", function () {
      appState.forcedScenario = null;
      appState.prefs.__overrides = {};
      global.UI.toast("실시간 날씨 기준으로 되돌립니다.");
      if (appState.trip) run();
    });
  }

  function init() {
    fillSelects();
    restoreForm();
    bind();
    DATA.tryLoadExternal().then(function () {});
    updateScenarioBadge();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  global.DonghaeApp = { run: run, state: appState, applyQuick: applyQuick };
})(window);
