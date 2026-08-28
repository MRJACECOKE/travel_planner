/* =============================================================
   map.js - 네이버 지도 (NAVER Maps JavaScript API v3) + fallback
   -------------------------------------------------------------
   - 키가 없거나 로딩 실패 시 목록형 fallback 으로 자동 전환.
   - 일정 카드 번호와 지도 마커 번호를 일치시킵니다.
   - 색상만으로 의미를 전달하지 않도록 텍스트/기호 배지를 함께 표시.
   ============================================================= */
(function (global) {
  "use strict";

  var C = global.CONFIG;

  var DAY_COLORS = ["#1f6feb", "#c9510c", "#1a7f37", "#8250df", "#9a6700", "#0b7285"];
  var CAT_BADGE = {
    DRIVE: "🚗 드라이브", INDOOR_ATTRACTION: "☂ 실내", MUSEUM: "☂ 박물관", EXHIBITION: "☂ 전시관",
    AQUARIUM: "☂ 아쿠아리움", MARKET: "☂ 시장", FOOD: "🍽 맛집", CAFE: "☕ 카페",
    OBSERVATORY: "👁 전망대", BEACH: "🌊 해변", COAST: "🌊 해안", PHOTO_SPOT: "📷 포토", WALK: "🥾 산책",
    OUTDOOR_ATTRACTION: "🌤 야외"
  };

  var state = { map: null, overlays: [], loaded: false, loading: false, failed: false, mode: "fallback" };

  function badge(cat) { return CAT_BADGE[cat] || cat; }

  /* NAVER 는 상품 개편으로 스크립트 주소·파라미터가 갈립니다.
     신규 Maps: oapi.map.naver.com + ncpKeyId
     구형 NCP:  openapi.map.naver.com + ncpClientId
     발급받은 키 종류를 몰라도 되도록 후보를 순차 시도합니다. */
  function candidateUrls() {
    var k = encodeURIComponent(C.NAVER_MAP_CLIENT_ID);
    return [
      "https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=" + k,
      "https://openapi.map.naver.com/openapi/v3/maps.js?ncpClientId=" + k,
      "https://oapi.map.naver.com/openapi/v3/maps.js?ncpClientId=" + k
    ];
  }

  // NAVER 인증 실패 시 스크립트는 200 으로 로드되고 이 콜백이 호출됩니다.
  // (타일 요청 단계에서 뒤늦게 호출되는 경우도 있어 별도 감시가 필요합니다.)
  var authFailed = false;
  global.navermap_authFailure = function () {
    authFailed = true;
    state.authFailed = true;
    state.failed = true;
    state.loaded = false;
    if (MapView && MapView._last) {
      MapView.fallbackOnly(MapView._last.containerId, MapView._last.trip, MapView._last.opts);
      updateModeLabel("fallback");
    }
  };

  function updateModeLabel(mode) {
    var el = document.getElementById("mapMode");
    if (!el) return;
    el.textContent = mode === "naver" ? "네이버 지도 표시 중"
      : state.authFailed ? "네이버 지도 인증 실패 - 목록으로 표시(아래 안내 확인)"
      : "지도 목록 표시(네이버 지도 미연결)";
  }

  function tryOne(url) {
    return new Promise(function (resolve) {
      authFailed = false;
      var s = document.createElement("script");
      s.src = url; s.async = true;
      var done = false;
      var timer = setTimeout(function () { finish(false); }, 4500);
      function finish(ok) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (!ok && s.parentNode) s.parentNode.removeChild(s);
        resolve(ok);
      }
      s.onload = function () {
        setTimeout(function () {
          finish(!authFailed && !!(global.naver && global.naver.maps));
        }, 60);
      };
      s.onerror = function () { finish(false); };
      document.head.appendChild(s);
    });
  }

  function loadScript() {
    if (state.loaded) return Promise.resolve(true);
    if (state.failed) return Promise.resolve(false);
    if (!C.NAVER_MAP_CLIENT_ID) { state.failed = true; return Promise.resolve(false); }
    // file:// 에서는 NAVER 지도 인증이 원천적으로 불가능합니다.
    if (location.protocol === "file:") { state.failed = true; state.fileProtocol = true; return Promise.resolve(false); }
    if (state.loading) return state.loading;

    var urls = candidateUrls();
    state.loading = (function next(i) {
      if (i >= urls.length) { state.failed = true; return Promise.resolve(false); }
      return tryOne(urls[i]).then(function (ok) {
        if (ok) { state.loaded = true; state.scriptUrl = urls[i]; return true; }
        return next(i + 1);
      });
    })(0);
    return state.loading;
  }

  function clearOverlays() {
    state.overlays.forEach(function (o) { try { o.setMap(null); } catch (e) {} });
    state.overlays = [];
  }

  function allItems(trip, activeDay) {
    var list = [];
    trip.days.forEach(function (d) {
      if (activeDay && activeDay !== "all" && d.dayIndex !== activeDay) return;
      d.items.forEach(function (it) { list.push({ day: d.dayIndex, it: it }); });
    });
    return list;
  }

  function renderNaver(containerId, trip, opts) {
    var el = document.getElementById(containerId);
    if (!el) return;
    var maps = global.naver.maps;
    if (!state.map) {
      state.map = new maps.Map(el, { center: new maps.LatLng(37.2, 129.2), zoom: 8, mapDataControl: false });
    }
    clearOverlays();
    var items = allItems(trip, opts.activeDay);
    if (!items.length) return;
    var bounds = new maps.LatLngBounds();
    var pathByDay = {};

    items.forEach(function (row) {
      var it = row.it;
      var pos = new maps.LatLng(it.lat, it.lng);
      bounds.extend(pos);
      (pathByDay[row.day] = pathByDay[row.day] || []).push(pos);
      var color = DAY_COLORS[(row.day - 1) % DAY_COLORS.length];
      var marker = new maps.Marker({
        position: pos, map: state.map,
        title: "DAY" + row.day + " " + it.leg + ". " + it.name,
        icon: {
          content: '<div style="transform:translate(-50%,-100%);background:' + color +
            ';color:#fff;border-radius:14px;padding:3px 8px;font:600 12px/1.2 \'Malgun Gothic\',sans-serif;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.35)">' +
            'D' + row.day + '-' + it.leg + ' · ' + escapeHtml(badge(it.category)) + '</div>',
          anchor: new maps.Point(0, 0)
        }
      });
      var info = new maps.InfoWindow({
        content: '<div style="padding:10px 12px;max-width:240px;font:14px/1.5 \'Malgun Gothic\',sans-serif">' +
          '<strong>' + escapeHtml(it.name) + '</strong><br>' +
          escapeHtml(it.region + " · " + it.categoryLabel + " · " + (it.venueKind || (it.indoorLike ? "실내" : "야외"))) + '<br>' +
          '도착 ' + it.arrive + ' · 체류 ' + it.stayMin + '분<br>' +
          '<a href="' + it.naverUrl + '" target="_blank" rel="noopener">네이버 지도에서 열기</a></div>'
      });
      maps.Event.addListener(marker, "click", function () { info.open(state.map, marker); });
      state.overlays.push(marker);
    });

    Object.keys(pathByDay).forEach(function (day) {
      if (pathByDay[day].length < 2) return;
      var line = new global.naver.maps.Polyline({
        map: state.map, path: pathByDay[day],
        strokeColor: DAY_COLORS[(day - 1) % DAY_COLORS.length],
        strokeWeight: 3, strokeOpacity: 0.7
      });
      state.overlays.push(line);
    });

    state.map.fitBounds(bounds);
    state.mode = "naver";
  }

  function renderFallback(containerId, trip, opts) {
    var el = document.getElementById(containerId);
    if (!el) return;
    state.mode = "fallback";
    var reason;
    if (state.fileProtocol) {
      reason = 'file:// 로 열면 네이버 지도 인증이 되지 않습니다. 로컬 서버 주소(예: http://localhost:4173)로 여십시오.';
    } else if (state.authFailed) {
      reason = '네이버 지도 인증에 실패했습니다("Open API 인증이 실패했습니다"). ' +
        '현재 접속 주소 <code>' + escapeHtml(location.origin) + '</code> 를 NAVER Cloud Platform 콘솔 → Maps → 해당 Application → Web 서비스 URL 에 ' +
        '똑같이(프로토콜·호스트·포트, 끝에 / 없이) 등록하고 몇 분 뒤 새로고침하십시오. Dynamic Map API 활성화 여부도 확인하십시오.';
    } else if (!C.NAVER_MAP_CLIENT_ID) {
      reason = 'NAVER 지도 클라이언트 ID 가 설정되지 않았습니다.';
    } else {
      reason = '지도 서비스 연결에 실패하여 목록으로 표시합니다.';
    }
    var html = '<div class="map-fallback" role="group" aria-label="코스 지도 목록">';
    html += '<p class="map-fallback__note">' + reason + ' 각 장소는 네이버 지도에서 바로 열 수 있습니다.</p>';
    trip.days.forEach(function (d) {
      if (opts.activeDay && opts.activeDay !== "all" && d.dayIndex !== opts.activeDay) return;
      html += '<div class="map-fallback__day">';
      html += '<h4>DAY ' + d.dayIndex + ' · ' + escapeHtml(d.regions.join(" → ")) +
        ' <span class="wx-chip">' + escapeHtml(d.weatherLabel) + (d.rainAdaptive ? " · 우천 대응" : "") + '</span></h4>';
      html += '<ol class="map-fallback__list">';
      d.items.forEach(function (it) {
        html += '<li>' +
          '<span class="map-fallback__num">' + it.leg + '</span> ' +
          '<span class="map-fallback__name">' + escapeHtml(it.name) + '</span> ' +
          '<span class="badge badge--' + (it.indoorLike ? "indoor" : "outdoor") + '">' + escapeHtml(badge(it.category)) + '</span> ' +
          '<span class="map-fallback__meta">도착 ' + it.arrive + ' · 체류 ' + it.stayMin + '분 · 다음 이동 ' + it.travelMin + '분</span> ' +
          '<a href="' + it.naverUrl + '" target="_blank" rel="noopener">지도</a>' +
          '</li>';
      });
      html += '</ol></div>';
    });
    html += '</div>';
    el.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* 전체 코스를 한 장에 나타낸 개요 지도(SVG). 네이버 지도 로딩과 무관하게 항상 생성. */
  function renderOverview(canvasId, linksId, trip) {
    var el = document.getElementById(canvasId);
    if (!el) return;
    var rows = allItems(trip, "all");
    if (!rows.length) { el.innerHTML = ""; return; }

    var W = 720, H = 940, padX = 96, padY = 44;
    var lats = rows.map(function (r) { return r.it.lat; });
    var lngs = rows.map(function (r) { return r.it.lng; });
    var minLat = Math.min.apply(null, lats), maxLat = Math.max.apply(null, lats);
    var minLng = Math.min.apply(null, lngs), maxLng = Math.max.apply(null, lngs);
    var spanLat = (maxLat - minLat) || 0.01, spanLng = (maxLng - minLng) || 0.01;

    function px(lng) { return padX + (lng - minLng) / spanLng * (W - padX * 2); }
    function py(lat) { return padY + (maxLat - lat) / spanLat * (H - padY * 2); } // 북쪽이 위

    var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" font-family="Malgun Gothic, sans-serif">'];
    svg.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#eef2f6"/>');
    // 바다/육지 느낌의 옅은 구분 (좌: 육지, 우: 바다)
    svg.push('<rect x="0" y="0" width="' + (W * 0.5) + '" height="' + H + '" fill="#f3f6f4"/>');
    svg.push('<rect x="' + (W * 0.5) + '" y="0" width="' + (W * 0.5) + '" height="' + H + '" fill="#e8f0f6"/>');
    svg.push('<text x="' + (W - 12) + '" y="22" text-anchor="end" font-size="11" fill="#7a8a99">동해</text>');

    // 지역 라벨 (해당 지역 방문지 평균 위도에 표시)
    var byRegion = {};
    rows.forEach(function (r) { (byRegion[r.it.region] = byRegion[r.it.region] || []).push(r.it.lat); });
    Object.keys(byRegion).forEach(function (rg) {
      var avg = byRegion[rg].reduce(function (s, v) { return s + v; }, 0) / byRegion[rg].length;
      var y = py(avg);
      svg.push('<line x1="8" y1="' + y.toFixed(1) + '" x2="' + (W - 8) + '" y2="' + y.toFixed(1) + '" stroke="#d6dee6" stroke-dasharray="3 4"/>');
      svg.push('<text x="10" y="' + (y - 4).toFixed(1) + '" font-size="12" fill="#566270">' + escapeHtml(rg) + '</text>');
    });

    // DAY 별 이동선
    var pathByDay = {};
    rows.forEach(function (r) { (pathByDay[r.day] = pathByDay[r.day] || []).push(r); });
    Object.keys(pathByDay).forEach(function (day) {
      var pts = pathByDay[day].map(function (r) { return px(r.it.lng).toFixed(1) + "," + py(r.it.lat).toFixed(1); });
      if (pts.length > 1) {
        svg.push('<polyline points="' + pts.join(" ") + '" fill="none" stroke="' +
          DAY_COLORS[(day - 1) % DAY_COLORS.length] + '" stroke-width="2.5" stroke-opacity="0.75"/>');
      }
    });

    // 마커
    rows.forEach(function (r) {
      var x = px(r.it.lng), y = py(r.it.lat);
      var color = DAY_COLORS[(r.day - 1) % DAY_COLORS.length];
      svg.push('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="10" fill="' + color + '" stroke="#fff" stroke-width="1.5"/>');
      svg.push('<text x="' + x.toFixed(1) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="middle" font-size="10" fill="#fff" font-weight="700">' + r.it.leg + '</text>');
      svg.push('<text x="' + (x + 13).toFixed(1) + '" y="' + (y + 3.5).toFixed(1) + '" font-size="10.5" fill="#1c2530">' + escapeHtml(shorten(r.it.name)) + '</text>');
    });

    // 범례
    var lx = 12, ly = H - 14 - (trip.days.length) * 16;
    svg.push('<rect x="' + (lx - 6) + '" y="' + (ly - 14) + '" width="150" height="' + (trip.days.length * 16 + 12) + '" fill="#ffffff" stroke="#d6dee6" rx="6"/>');
    trip.days.forEach(function (d, i) {
      var yy = ly + i * 16;
      svg.push('<circle cx="' + (lx + 4) + '" cy="' + (yy - 3) + '" r="5" fill="' + DAY_COLORS[i % DAY_COLORS.length] + '"/>');
      svg.push('<text x="' + (lx + 16) + '" y="' + yy + '" font-size="10.5" fill="#1c2530">DAY ' + d.dayIndex + ' · ' + escapeHtml(d.regions.join("·")) + '</text>');
    });

    svg.push('</svg>');
    el.innerHTML = svg.join("");

    var linksEl = document.getElementById(linksId);
    if (linksEl) {
      var startRegion = trip.days[0].regions[0];
      var endRegion = trip.days[trip.days.length - 1].regions.slice(-1)[0];
      var naverAll = "https://map.naver.com/p/search/" + encodeURIComponent(startRegion + " " + endRegion + " 동해안");
      var svgData = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(el.querySelector("svg").outerHTML);
      linksEl.innerHTML =
        '<a href="' + naverAll + '" target="_blank" rel="noopener">네이버 지도에서 전체 코스 열기</a>' +
        ' · <a href="' + svgData + '" download="donghae-course-map.svg">개요 지도 이미지 저장(SVG)</a>' +
        (C.NAVER_MAP_CLIENT_ID ? ' · 위 지도에서 전체 코스가 자동 축척으로 표시됩니다.' : ' · 네이버 지도 키가 없어 상단은 목록으로 표시됩니다.');
    }
  }

  function shorten(s) { s = String(s); return s.length > 12 ? s.slice(0, 11) + "…" : s; }

  var MapView = {
    DAY_COLORS: DAY_COLORS,
    state: state,
    _last: null,
    render: function (containerId, trip, opts) {
      opts = opts || {};
      if (!trip || !trip.days || !trip.days.length) return Promise.resolve("empty");
      MapView._last = { containerId: containerId, trip: trip, opts: opts };
      return loadScript().then(function (ok) {
        if (ok && !state.authFailed && global.naver && global.naver.maps) {
          try {
            renderNaver(containerId, trip, opts);
            // 타일 단계에서 뒤늦게 인증 실패가 오는 경우를 대비한 감시
            setTimeout(function () {
              if (state.authFailed) { renderFallback(containerId, trip, opts); updateModeLabel("fallback"); }
            }, 1800);
            return "naver";
          } catch (e) { renderFallback(containerId, trip, opts); return "fallback"; }
        }
        renderFallback(containerId, trip, opts);
        return "fallback";
      });
    },
    fallbackOnly: function (containerId, trip, opts) { renderFallback(containerId, trip, opts || {}); },
    renderOverview: renderOverview
  };

  global.MapView = MapView;
})(window);
