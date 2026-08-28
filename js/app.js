/* =============================================================
   app.js - 오케스트레이션 (§48 파이프라인 구동 + UI 배선)
   ============================================================= */
(function (global) {
  "use strict";

  var C = global.CONFIG;
  var STORE_KEY = "donghae-drive:v1";
  var ROUTES_KEY = "donghae-drive:routes:v1";

  var appState = {
    trip: null,
    weatherData: null,
    activeDay: "all",
    forcedScenario: getParam("weather") || null, // clear|light-rain|rain|heavy-rain|disagree
    autoWeather: true,
    prefs: {},
    lodgingOverrides: {} // { night(number): regionName } - 경로와 무관한 숙박 희망 지역
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
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        input: stripPrefs(input), lodgingOverrides: appState.lodgingOverrides, ts: Date.now()
      }));
    } catch (e) {}
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
    if (raw && raw.lodgingOverrides) appState.lodgingOverrides = raw.lodgingOverrides;
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
    appState.lastInput = input;
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
    global.UI.renderLodging(trip, appState.lodgingOverrides, onLodgingChange);
    renderRouteStorePanel();
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

  /* ---------------- 숙박 희망 지역 (경로와 무관) ---------------- */
  function onLodgingChange(night, region) {
    if (region) appState.lodgingOverrides[night] = region;
    else delete appState.lodgingOverrides[night];
    if (appState.trip) {
      global.UI.renderLodging(appState.trip, appState.lodgingOverrides, onLodgingChange);
      global.UI.toast(night + "박째 숙박 희망 지역을 " + region + "(으)로 변경했습니다.");
    }
    if (appState.lastInput) saveForm(appState.lastInput);
  }

  /* ---------------- 경로 저장/불러오기 (로컬 전용) ---------------- */
  function listRoutes() {
    try {
      var o = JSON.parse(localStorage.getItem(ROUTES_KEY) || "{}");
      return Object.keys(o).map(function (k) { return o[k]; })
        .sort(function (a, b) { return b.savedAt - a.savedAt; });
    } catch (e) { return []; }
  }
  function writeRoutes(map) {
    try { localStorage.setItem(ROUTES_KEY, JSON.stringify(map)); return true; }
    catch (e) { global.UI.toast("이 브라우저에 저장할 수 없습니다(용량 또는 시크릿 모드)."); return false; }
  }
  function currentPayload() {
    var input = appState.lastInput || readForm();
    return {
      v: 1,
      input: stripPrefs(input),
      lodgingOverrides: appState.lodgingOverrides,
      forcedScenario: appState.forcedScenario || null,
      autoWeather: appState.autoWeather
    };
  }
  function routeSummaryText() {
    var t = appState.trip;
    if (!t) return "";
    return (t.origin ? t.origin.name + " 출발 · " : "") + t.summary.title + " · " + t.summary.period;
  }
  function saveRoute(name) {
    if (!appState.trip) { global.UI.toast("먼저 코스를 만들어 주십시오."); return; }
    name = (name || "").trim() || (routeSummaryText() || ("경로 " + new Date().toLocaleDateString("ko-KR")));
    var map;
    try { map = JSON.parse(localStorage.getItem(ROUTES_KEY) || "{}"); } catch (e) { map = {}; }
    var id = "r" + Date.now().toString(36);
    map[id] = { id: id, name: name, savedAt: Date.now(), summary: routeSummaryText(), payload: currentPayload() };
    if (writeRoutes(map)) { global.UI.toast('"' + name + '" 저장 완료'); renderRouteStorePanel(); }
  }
  function deleteRoute(id) {
    var map;
    try { map = JSON.parse(localStorage.getItem(ROUTES_KEY) || "{}"); } catch (e) { map = {}; }
    delete map[id];
    if (writeRoutes(map)) { global.UI.toast("삭제했습니다."); renderRouteStorePanel(); }
  }
  function applyPayload(p) {
    if (!p || !p.input) return false;
    var i = p.input;
    setVal("origin", i.originId); setVal("startRegion", i.startRegion); setVal("endRegion", i.endRegion);
    setVal("startDate", i.startDate); setVal("days", i.days);
    setVal("startTime", i.startTime); setVal("endTime", i.endTime);
    if (i.prefs) {
      var pr = i.prefs;
      setVal("prefDrive", pr.drivePref); setVal("prefIntensity", pr.intensity);
      setVal("prefFood", pr.foodInterest); setVal("prefCafe", pr.cafeInterest);
      setVal("prefPhoto", pr.photoInterest); setVal("prefNature", pr.natureInterest);
      setVal("prefIndoor", pr.indoorInterest); setVal("prefMarket", pr.marketInterest);
      setVal("prefCoastal", pr.coastalRoadPref); setVal("prefMaxDrive", pr.maxDriveHours);
      setVal("prefMaxPlaces", pr.maxPlacesPerDay); setVal("prefCompanions", pr.companions);
    }
    appState.prefs = { __overrides: {} };
    appState.lodgingOverrides = p.lodgingOverrides || {};
    appState.forcedScenario = p.forcedScenario || null;
    appState.autoWeather = p.autoWeather !== false;
    var auto = $("autoWeather"); if (auto) auto.checked = appState.autoWeather;
    return true;
  }
  function loadRoute(id) {
    var map;
    try { map = JSON.parse(localStorage.getItem(ROUTES_KEY) || "{}"); } catch (e) { map = {}; }
    var r = map[id];
    if (!r) { global.UI.toast("저장된 경로를 찾을 수 없습니다."); return; }
    if (applyPayload(r.payload)) { global.UI.toast('"' + r.name + '" 불러오는 중...'); run(); }
  }
  function exportRoute() {
    if (!appState.trip) { global.UI.toast("먼저 코스를 만들어 주십시오."); return; }
    var data = { kind: "donghae-drive-route", exportedAt: new Date().toISOString(), summary: routeSummaryText(), payload: currentPayload() };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "donghae-route-" + (routeSummaryText().replace(/[^가-힣\w]+/g, "-").slice(0, 40) || "route") + ".json";
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    global.UI.toast("경로 파일을 내려받았습니다.");
  }
  function importRoute(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        var payload = data.payload || data;
        if (applyPayload(payload)) { global.UI.toast("파일에서 경로를 불러옵니다."); run(); }
        else global.UI.toast("경로 파일 형식이 올바르지 않습니다.");
      } catch (e) { global.UI.toast("파일을 읽을 수 없습니다."); }
    };
    reader.readAsText(file);
  }
  function encodePayload(p) {
    try { return encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(p))))); }
    catch (e) { return ""; }
  }
  function decodePayload(s) {
    try { return JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(s))))); }
    catch (e) { return null; }
  }
  function shareLink() {
    if (!appState.trip) { global.UI.toast("먼저 코스를 만들어 주십시오."); return; }
    var enc = encodePayload(currentPayload());
    if (!enc) { global.UI.toast("링크를 만들 수 없습니다."); return; }
    var url = location.origin + location.pathname + "#r=" + enc;
    if (url.length > 6000) { global.UI.toast("경로가 너무 커서 링크로 만들 수 없습니다. 파일 내보내기를 사용하십시오."); return; }
    function done() { global.UI.toast("공유 링크를 클립보드에 복사했습니다."); }
    if (global.navigator && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { promptCopy(url); });
    } else { promptCopy(url); }
  }
  function promptCopy(url) {
    try { global.prompt("아래 링크를 복사하십시오 (다른 기기에서 열면 이 경로가 불러와집니다):", url); }
    catch (e) { global.UI.toast("복사에 실패했습니다."); }
  }
  function renderRouteStorePanel() {
    var wrap = $("routeStoreWrap");
    if (wrap) wrap.hidden = false;
    global.UI.renderRouteStore(listRoutes(), {
      onSave: saveRoute, onLoad: loadRoute, onDelete: deleteRoute,
      onExport: exportRoute, onImport: importRoute, onShare: shareLink
    });
  }
  function checkHashRoute() {
    var m = /[#&]r=([^&]+)/.exec(location.hash || "");
    if (!m) return;
    var p = decodePayload(m[1]);
    // 해시 제거 (뒤로가기 시 재실행 방지)
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    if (p && applyPayload(p)) {
      global.UI.toast("공유 링크의 경로를 불러옵니다.");
      run();
    }
  }

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
    renderRouteStorePanel();
    updateScenarioBadge();
    DATA.tryLoadExternal().then(function (loaded) {
      if (loaded && $("dataStatus")) {
        global.UI.toast("관광 실데이터(TourAPI)를 불러왔습니다. 총 " + DATA.PLACES.length + "곳.");
      }
      checkHashRoute();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  global.DonghaeApp = { run: run, state: appState, applyQuick: applyQuick };
})(window);
