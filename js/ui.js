/* =============================================================
   ui.js - 화면 렌더링
   -------------------------------------------------------------
   renderWeather() renderRainNotice() renderSchedule() renderMap 연동
   글꼴: 맑은 고딕. 라이트 모드 전용. 문구는 표준 경어체.
   ============================================================= */
(function (global) {
  "use strict";

  var C = global.CONFIG, WS = global.WeatherStrategy;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function set(id, html) { var e = $(id); if (e) e.innerHTML = html; }

  var CAT_BADGE = {
    DRIVE: "🚗 드라이브", INDOOR_ATTRACTION: "☂ 실내", MUSEUM: "☂ 박물관", EXHIBITION: "☂ 전시관",
    AQUARIUM: "☂ 아쿠아리움", MARKET: "☂ 시장", FOOD: "🍽 맛집", CAFE: "☕ 카페",
    OBSERVATORY: "👁 전망대", BEACH: "🌊 해변", COAST: "🌊 해안", PHOTO_SPOT: "📷 포토",
    WALK: "🥾 산책", OUTDOOR_ATTRACTION: "🌤 야외"
  };
  function badge(cat) { return CAT_BADGE[cat] || cat; }
  function roadLabel(r) { return r === "expressway" ? "고속도로" : r === "national" ? "국도" : "해안도로"; }

  /* ---------------- 데이터 상태 ---------------- */
  function renderDataStatus(ds) {
    if (!ds) return;
    var label = ds.weather === "LIVE" && ds.places !== "DEMO" ? "PARTIAL LIVE DATA"
      : ds.weather === "LIVE" ? "PARTIAL LIVE DATA (날씨 실시간 · 관광 DEMO)"
      : ds.weather && ds.weather.indexOf("PARTIAL") === 0 ? "PARTIAL LIVE DATA"
      : "DEMO DATA";
    var wtime = ds.weatherUpdatedAt ? new Date(ds.weatherUpdatedAt).toLocaleString("ko-KR") : "연결 필요";
    set("dataStatus",
      '<span class="status-pill status-pill--' + (label.indexOf("LIVE") >= 0 ? "live" : "demo") + '">' + esc(label) + '</span>' +
      '<span class="status-meta">관광 기본정보 확인일 ' + esc(ds.tourInfoCheckedAt) +
      ' · 최근 후기 ' + esc(String(global.ReviewEngine.baseline)) +
      ' · 날씨 갱신 ' + esc(wtime) + '</span>');
  }

  /* ---------------- 날씨 카드 ---------------- */
  function providerLine(agg) {
    if (!agg || !agg.providers) return "";
    return agg.providers.map(function (p) {
      return esc(p.name) + " " + p.pop + "%" + (p.kind === "demo" ? "(데모)" : "");
    }).join(" · ");
  }

  function weatherCard(region, agg, dateLabel) {
    if (!agg) {
      return '<div class="wx-card wx-card--fail"><h4>' + esc(region) + '</h4><p>날씨 연결 실패. 새로고침 후 다시 시도하십시오.</p></div>';
    }
    var cls = WS.classifyWeather(agg);
    var wind = WS.isWindDanger(agg);
    return '<div class="wx-card wx-card--' + cls.toLowerCase() + '">' +
      '<h4>' + esc(region) + ' <span class="wx-chip">' + esc(dateLabel || "") + '</span></h4>' +
      '<p class="wx-main"><strong>' + esc(WS.CLASS_LABEL[cls]) + '</strong>' +
      (wind ? ' <span class="wx-warn">강풍 주의</span>' : '') + '</p>' +
      '<ul class="wx-list">' +
      '<li>강수확률 종합 ' + agg.pop + '%</li>' +
      '<li>예상 강수량 ' + agg.precipMm + 'mm</li>' +
      '<li>기온 ' + agg.tempMin + '° / ' + agg.tempMax + '°</li>' +
      '<li>풍속 ' + agg.windMs + ' m/s (돌풍 ' + agg.gustMs + ')</li>' +
      (agg.humidity != null ? '<li>습도 ' + agg.humidity + '%</li>' : '') +
      (agg.sunrise ? '<li>일출 ' + agg.sunrise + ' · 일몰 ' + agg.sunset + '</li>' : '') +
      '</ul>' +
      '<p class="wx-agg">' + providerLine(agg) + '</p>' +
      '<p class="wx-agg">예보 신뢰도 ' + esc(agg.confidence) +
      (agg.uncertain ? ' · <strong>예보 불확실성 높음</strong>' : '') +
      ' · 실시간 공급자 ' + (agg.liveProviderCount || 0) + '곳</p>' +
      '</div>';
  }

  function renderWeather(weatherData, trip) {
    if (!weatherData || !weatherData.byRegion) { set("weatherToday", ""); set("weatherTomorrow", ""); return; }
    var dates = weatherData.dates || [];
    var regions = trip ? uniqueRegions(trip) : C.REGION_ORDER;
    function block(dateIdx) {
      var dt = dates[dateIdx];
      var lbl = dateIdx === 0 ? "오늘" : "내일";
      var cards = regions.map(function (r) {
        var rg = weatherData.byRegion[r];
        var agg = rg ? (rg.byDate && rg.byDate[dt]) || (dateIdx === 0 ? rg.today : rg.tomorrow) : null;
        return weatherCard(r, agg, lbl + " " + (dt || ""));
      }).join("");
      return cards;
    }
    set("weatherToday", '<h3>오늘 지역별 날씨</h3><div class="wx-grid">' + block(0) + '</div>');
    set("weatherTomorrow", '<h3>내일 지역별 날씨</h3><div class="wx-grid">' + block(1) + '</div>');
  }

  function uniqueRegions(trip) {
    var s = {}, o = [];
    trip.days.forEach(function (d) { d.regions.forEach(function (r) { if (!s[r]) { s[r] = 1; o.push(r); } }); });
    return o.length ? o : C.REGION_ORDER;
  }

  /* ---------------- 우천 경고 / 전략 패널 ---------------- */
  function renderRainNotice(trip) {
    var rainyDays = trip.days.filter(function (d) { return d.weatherClass === "RAIN" || d.weatherClass === "HEAVY_RAIN"; });
    var windyDays = trip.days.filter(function (d) { return d.windDanger; });
    if (!rainyDays.length && !windyDays.length) {
      set("rainNotice", '<div class="notice notice--ok">여행 기간 중 뚜렷한 우천 예보는 없습니다. 야외 관광과 해안 드라이브를 균형 있게 배치했습니다.</div>');
      return;
    }
    var html = "";
    rainyDays.forEach(function (d) {
      var body = d.windDanger
        ? '강풍이 동반되어 해변·해안 노출 구간과 위험한 해안도로를 낮게 평가하고, 주요 도로 이동 + 실내 관광 중심으로 재구성했습니다.'
        : '해변·장시간 산책 일정을 줄이고 해안 드라이브 + 실내 관광 + 전망 카페 중심으로 조정했습니다.';
      html += '<div class="notice notice--rain">' +
        '<strong>☔ DAY ' + d.dayIndex + ' ' + esc(d.regions.join("·")) + ' ' +
        (d.weatherClass === "HEAVY_RAIN" ? "강한 비" + (d.windDanger ? "·강풍" : "") + " 예상" : "우천 가능성 높음") + '</strong>' +
        '<p>' + (d.weather && d.weather.agreement ? d.weather.agreement.mean + '% 강수확률(공급자 종합, 신뢰도 ' + esc(d.weather.confidence) + ')' +
          (d.weather.windMs != null ? ', 풍속 ' + d.weather.windMs + 'm/s' : '') + '. ' : '') + body + '</p>' +
        (d.rebuildNotes && d.rebuildNotes.length ? '<p class="notice__sub">' + esc(d.rebuildNotes.join(" ")) + '</p>' : '') +
        '</div>';
    });
    windyDays.forEach(function (d) {
      if (d.weatherClass === "RAIN" || d.weatherClass === "HEAVY_RAIN") return;
      html += '<div class="notice notice--wind"><strong>⚠ DAY ' + d.dayIndex + ' 강풍 동반 예보</strong>' +
        '<p>해안도로 노출 구간을 낮게 평가하고 주요 도로 이동 중심으로 재구성했습니다.</p></div>';
    });
    set("rainNotice", html);
  }

  function renderStrategyPanel(trip) {
    var rows = trip.days.map(function (d) {
      return '<tr>' +
        '<td>DAY ' + d.dayIndex + '</td>' +
        '<td>' + esc(d.regions.join("·")) + '</td>' +
        '<td>' + esc(d.weatherLabel) + (d.windDanger ? " · 강풍" : "") + '</td>' +
        '<td>' + (d.rainAdaptive ? "드라이브·실내 비중 확대" : "야외·드라이브 균형") + '</td>' +
        '<td>' + d.stats.drive + ' / ' + d.stats.indoor + ' / ' + d.stats.food + ' / ' + d.stats.cafe + '</td>' +
        '</tr>';
    }).join("");
    set("strategyPanel",
      '<h3>우천 전략 요약</h3>' +
      '<table class="strat-table"><thead><tr><th>DAY</th><th>지역</th><th>날씨</th><th>적용 전략</th><th>드라이브/실내/맛집/카페</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<p class="hint">우천 시 우선순위: 1) 차량 드라이브 2) 실내 볼거리 3) 주차 편한 맛집 4) 전망 좋은 실내 카페 5) 시장·박물관·전시관·아쿠아리움 6) 짧은 야외 포인트</p>');
  }

  /* ---------------- 요약 ---------------- */
  function renderSummary(trip) {
    var s = trip.summary;
    set("summary",
      '<h3>' + esc(s.title) + '</h3>' +
      '<p class="summary-line">' + esc(s.period) + ' · ' + esc(s.direction) + ' 동선 · 총 예상 주행 약 ' + s.totalKm + 'km · 예상 운전 ' + esc(s.totalDriveText) + '</p>' +
      '<ul class="summary-grid">' +
      '<li>야외 관광 <strong>' + s.counts.spot + '</strong></li>' +
      '<li>실내 볼거리 <strong>' + s.counts.indoor + '</strong></li>' +
      '<li>드라이브 구간 <strong>' + s.counts.drive + '</strong></li>' +
      '<li>맛집 <strong>' + s.counts.food + '</strong></li>' +
      '<li>카페 <strong>' + s.counts.cafe + '</strong></li>' +
      '</ul>' +
      (s.rainAdaptiveDays.length ? '<p class="summary-rain">☔ 우천 대응 일정: DAY ' + s.rainAdaptiveDays.join(", ") + '</p>' : ''));
  }

  /* ---------------- DAY / 장소 카드 ---------------- */
  function placeCard(it, dir) {
    var reasons = (it.reasons || []).slice(0, 4).map(function (r) { return '<li>' + esc(r) + '</li>'; }).join("");
    var pk = it.parking || {};
    var pkText = pk.available ? ({ easy: "쉬움", normal: "보통", hard: "혼잡" }[pk.difficulty] || "보통") + (pk.covered ? " · 실내" : "") : "정보 없음";
    var openText = it.openingHours === "상시" ? "상시" : it.openingHours;
    var weatherActionHtml = it.weatherAction
      ? '<p class="pc-weather">' + esc(it.weatherActionText) + '</p>' : "";
    var rainExplain = "";
    if (it.rainBonus >= 8 && it.indoorLike) {
      rainExplain = '<div class="pc-rain">☔ 우천 대체 추천 · 실내 관람 가능 · 주차 ' + esc(pkText) +
        ' · 현재 동선 추가 우회 약 ' + (it.detourMin || 0) + '분 · 예상 체류 ' + it.stayMin + '분</div>';
    } else if (it.rainBonus >= 6 && it.category === "DRIVE") {
      rainExplain = '<div class="pc-rain">☔ 우천 시에도 운전 안전 범위 · 차량 이동 중심 구간</div>';
    }
    return '<article class="place-card">' +
      '<header class="pc-head">' +
      '<span class="pc-num">' + it.leg + '</span>' +
      '<h4>' + esc(it.name) + '</h4>' +
      '<span class="badge badge--' + (it.indoorLike ? "indoor" : "outdoor") + '">' + esc(badge(it.category)) + '</span>' +
      '</header>' +
      '<p class="pc-sub">' + esc(it.region) + ' · ' + esc(it.categoryLabel) + ' · ' +
      esc(it.venueKind || (it.indoorLike ? "실내" : "야외")) +
      ' · 우천 적합도 ' + it.weatherFit + '/100 · 추천점수 ' + it.score + '</p>' +
      rainExplain +
      weatherActionHtml +
      '<ul class="pc-reasons">' + reasons + '</ul>' +
      '<dl class="pc-facts">' +
      '<div><dt>도착·출발</dt><dd>' + it.arrive + ' → ' + it.leave + '</dd></div>' +
      '<div><dt>체류시간</dt><dd>' + it.stayMin + '분</dd></div>' +
      '<div><dt>다음 목적지 이동</dt><dd>' + it.travelMin + '분 · ' + it.travelKm + 'km · ' + roadLabel(it.roadType) + '</dd></div>' +
      '<div><dt>추가 우회시간</dt><dd>약 ' + (it.detourMin || 0) + '분</dd></div>' +
      '<div><dt>주차</dt><dd>' + esc(pkText) + '</dd></div>' +
      '<div><dt>운영시간</dt><dd>' + esc(openText) + (it.open ? "" : " · 도착 시각 운영 여부 확인 필요") + '</dd></div>' +
      '</dl>' +
      (it.note ? '<p class="pc-note">' + esc(it.note) + '</p>' : '') +
      '<p class="pc-review">' + esc(it.summary) + '</p>' +
      '<p class="pc-review pc-review--demo">' + esc(it.reviewNote) + '</p>' +
      '<p class="pc-src"><a href="' + it.naverUrl + '" target="_blank" rel="noopener">네이버 지도에서 열기</a>' +
      (it.demo ? ' · 출처: 내장 DEMO 데이터(실운영 전 TourAPI 연동 필요)' : '') + '</p>' +
      '</article>';
  }

  function dayCard(d, dir, departure) {
    var wxLine = d.weather
      ? d.weatherLabel + " · 강수확률 " + d.weather.pop + "% · 풍속 " + d.weather.windMs + "m/s"
      : "날씨 정보 없음";
    var depHtml = "";
    if (d.dayIndex === 1 && departure) {
      depHtml = '<div class="day-departure">' +
        '<strong>' + esc(departure.originName) + ' 출발</strong> ' + departure.startTime +
        ' → ' + esc(departure.toName) + ' ' + departure.arriveTime + ' 도착' +
        ' · 약 ' + departure.km + 'km · ' + departure.min + '분 · ' + roadLabel(departure.roadType) + ' (예상)' +
        (departure.naverDirections ? ' · <a href="' + departure.naverDirections + '" target="_blank" rel="noopener">네이버 길찾기</a>' : '') +
        '</div>';
    }
    var items = d.items.map(function (it) { return placeCard(it, dir); }).join("");
    var excluded = (d.excluded || []).slice(0, 4).map(function (x) {
      return '<li><strong>' + esc(x.place.name) + '</strong> — ' + esc(x.reason) + '</li>';
    }).join("");
    return '<section class="day-card" data-day="' + d.dayIndex + '">' +
      '<header class="day-head">' +
      '<h3>DAY ' + d.dayIndex + ' · ' + esc(d.regions.join(" → ")) + '</h3>' +
      '<p class="day-meta">' + esc(d.date) + ' · ' + esc(wxLine) +
      (d.rainAdaptive ? ' · <span class="tag tag--rain">☔ 우천 대응</span>' : '') +
      (d.windDanger ? ' · <span class="tag tag--wind">⚠ 강풍</span>' : '') + '</p>' +
      '<p class="day-stats">예상 주행 ' + d.stats.km + 'km · 운전 ' + Math.floor(d.stats.driveMin / 60) + '시간 ' + (d.stats.driveMin % 60) + '분 · ' +
      '방문 ' + d.stats.places + '곳 (실내 ' + d.stats.indoor + ' · 드라이브 ' + d.stats.drive + ' · 맛집 ' + d.stats.food + ' · 카페 ' + d.stats.cafe + ') · ' +
      (d.lodging && d.lodging.isLastDay
        ? '여행 종료 ' + d.stats.endTime
        : '숙박 ' + esc(d.lodging ? d.lodging.region : d.lodgingRegion) + (d.lodging ? ' · 모텔 중심(아래 숙박 섹션 참고)' : '')) +
      ' · ' + d.stats.startTime + '–' + d.stats.endTime + '</p>' +
      '</header>' +
      depHtml +
      '<div class="day-items">' + items + '</div>' +
      (excluded ? '<details class="day-excluded"><summary>이번 DAY 제외 장소와 이유</summary><ul>' + excluded + '</ul></details>' : '') +
      '</section>';
  }

  function renderSchedule(trip, activeDay) {
    var days = trip.days.filter(function (d) { return !activeDay || activeDay === "all" || d.dayIndex === activeDay; });
    set("scheduleDays", days.map(function (d) { return dayCard(d, trip.dir, trip.departure); }).join(""));
  }

  function renderDayFilter(trip, activeDay, onChange) {
    var el = $("dayFilter");
    if (!el) return;
    var btns = ['<button type="button" class="chip' + (!activeDay || activeDay === "all" ? " chip--on" : "") + '" data-day="all">전체 일정</button>'];
    trip.days.forEach(function (d) {
      btns.push('<button type="button" class="chip' + (activeDay === d.dayIndex ? " chip--on" : "") + '" data-day="' + d.dayIndex + '">DAY ' + d.dayIndex + '</button>');
    });
    el.innerHTML = btns.join("");
    el.querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () {
        var v = b.getAttribute("data-day");
        onChange(v === "all" ? "all" : parseInt(v, 10));
      });
    });
  }

  /* ---------------- 카테고리 모음 (실내/맛집/카페) ---------------- */
  function collect(trip, pred) {
    var out = [];
    trip.days.forEach(function (d) {
      d.items.forEach(function (it) { if (pred(it)) out.push({ day: d.dayIndex, it: it }); });
    });
    return out;
  }
  function miniList(id, title, rows, emptyText) {
    if (!rows.length) { set(id, '<h3>' + esc(title) + '</h3><p class="hint">' + esc(emptyText) + '</p>'); return; }
    set(id, '<h3>' + esc(title) + ' (' + rows.length + ')</h3><ul class="mini-list">' +
      rows.map(function (r) {
        return '<li><span class="mini-day">DAY ' + r.day + '</span> <strong>' + esc(r.it.name) + '</strong> · ' +
          esc(r.it.region) + ' · ' + esc(badge(r.it.category)) + ' · 도착 ' + r.it.arrive + ' · 체류 ' + r.it.stayMin + '분' +
          ' · <a href="' + r.it.naverUrl + '" target="_blank" rel="noopener">지도</a></li>';
      }).join("") + '</ul>');
  }

  function renderCategoryLists(trip) {
    miniList("indoorList", "실내 볼거리", collect(trip, function (it) { return it.indoorLike; }), "이번 일정에는 실내 볼거리가 없습니다.");
    miniList("foodList", "맛집", collect(trip, function (it) { return it.category === "FOOD"; }), "배정된 맛집이 없습니다. 인근 식당을 이용하십시오.");
    miniList("cafeList", "카페", collect(trip, function (it) { return it.category === "CAFE"; }), "배정된 카페가 없습니다.");
  }

  /* ---------------- 숙박 (모텔 중심 · 지역 선택 가능) ---------------- */
  function lodgingOptionsFor(region) {
    return (global.DATA.lodging(region) || []).slice(0, 3).map(function (o) {
      return {
        area: o.area, note: o.note,
        naverUrl: "https://map.naver.com/p/search/" + encodeURIComponent(region + " " + o.area + " 모텔")
      };
    });
  }

  function renderLodging(trip, overrides, onChange) {
    overrides = overrides || {};
    var wrap = $("lodgingWrap");
    if (trip.dayTrip || !trip.lodging || !trip.lodging.length) {
      if (wrap) wrap.hidden = true;
      set("lodgingList", "");
      return;
    }
    if (wrap) wrap.hidden = false;
    var html = '<p class="hint">숙박 지역은 <strong>여행 경로·이동 계산과 무관</strong>합니다. 자동 판정값(그날 마지막 방문지가 속한 지역)을 기본으로 두되, 원하는 지역으로 바꿀 수 있습니다. 특정 업소명이 아니라 모텔 밀집 지역과 검색 링크를 제공합니다(현재 DEMO).</p>';
    html += '<div class="lodging-list">';
    trip.lodging.forEach(function (lo) {
      var chosen = overrides[lo.night] || lo.region;
      var isCustom = chosen !== lo.autoRegion;
      var opts = lodgingOptionsFor(chosen);
      var searchUrl = "https://map.naver.com/p/search/" + encodeURIComponent(chosen + " 모텔");
      html += '<article class="lodging-item" data-night="' + lo.night + '">' +
        '<h4>' + lo.night + '박째 숙박 · <span class="lodging-region">' + esc(chosen) + '</span>' +
        (isCustom ? ' <span class="tag">직접 선택</span>' : '') + '</h4>' +
        '<p class="lodging-meta">DAY ' + lo.dayIndex + ' 일정 종료(' + esc(lo.checkInFrom) + ' 무렵)' +
        (lo.nearStop ? ' · 마지막 방문지: ' + esc(lo.nearStop) : '') +
        ' · 자동 판정: ' + esc(lo.autoRegion) + '</p>' +
        '<label class="lodging-pick">숙박 희망 지역 ' +
        '<select data-night="' + lo.night + '">' +
        C.REGION_ORDER.map(function (r) {
          return '<option value="' + r + '"' + (r === chosen ? ' selected' : '') + '>' + esc(r) + (r === lo.autoRegion ? ' (자동)' : '') + '</option>';
        }).join("") +
        '</select></label>' +
        '<ul>' +
        opts.map(function (o) {
          return '<li><strong>' + esc(o.area) + '</strong> — ' + esc(o.note) +
            ' · <a href="' + o.naverUrl + '" target="_blank" rel="noopener">모텔 검색</a></li>';
        }).join("") +
        '</ul>' +
        '<p class="lodging-note"><a href="' + searchUrl + '" target="_blank" rel="noopener">' + esc(chosen) + ' 모텔 전체 검색</a> · 요금·주차·객실 상태는 예약 전 확인하십시오.</p>' +
        '</article>';
    });
    html += '</div>';
    set("lodgingList", html);

    var listEl = $("lodgingList");
    if (listEl && onChange) {
      listEl.querySelectorAll("select[data-night]").forEach(function (sel) {
        sel.addEventListener("change", function () {
          onChange(parseInt(sel.getAttribute("data-night"), 10), sel.value);
        });
      });
    }
  }

  /* ---------------- 경로 저장 / 불러오기 (로컬, 백엔드 없음) ---------------- */
  function renderRouteStore(routes, h) {
    var el = $("routeStoreBody");
    if (!el) return;
    var list = routes && routes.length
      ? '<ul class="saved-routes">' + routes.map(function (r) {
          return '<li><span class="saved-routes__name">' + esc(r.name) + '</span>' +
            '<span class="saved-routes__meta">' + esc(r.summary || "") + ' · ' + esc(new Date(r.savedAt).toLocaleString("ko-KR")) + '</span>' +
            '<span class="saved-routes__act">' +
            '<button type="button" class="btn btn--ghost" data-act="load" data-id="' + esc(r.id) + '">불러오기</button>' +
            '<button type="button" class="btn btn--ghost" data-act="del" data-id="' + esc(r.id) + '">삭제</button>' +
            '</span></li>';
        }).join("") + '</ul>'
      : '<p class="hint">저장된 경로가 없습니다. 코스를 만든 뒤 이름을 입력하고 저장하십시오.</p>';

    el.innerHTML =
      '<div class="route-store__save">' +
      '<input type="text" id="routeName" placeholder="경로 이름 (예: 울산 3박4일 강릉)" maxlength="40">' +
      '<button type="button" class="btn btn--primary" id="routeSaveBtn">이 경로 저장</button>' +
      '</div>' +
      list +
      '<div class="route-store__io">' +
      '<button type="button" class="btn btn--ghost" id="routeExportBtn">파일로 내보내기</button>' +
      '<label class="btn btn--ghost" for="routeImportInput">파일에서 불러오기</label>' +
      '<input type="file" id="routeImportInput" accept="application/json,.json" hidden>' +
      '<button type="button" class="btn btn--ghost" id="routeShareBtn">공유 링크 복사</button>' +
      '</div>' +
      '<p class="hint">저장·불러오기는 이 브라우저에만 보관됩니다(백엔드 없음). 다른 기기로 옮기려면 "파일로 내보내기" 또는 "공유 링크 복사"를 사용하십시오.</p>';

    var nameInput = $("routeName");
    $("routeSaveBtn").addEventListener("click", function () { h.onSave((nameInput.value || "").trim()); });
    nameInput.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); h.onSave((nameInput.value || "").trim()); } });
    $("routeExportBtn").addEventListener("click", h.onExport);
    $("routeShareBtn").addEventListener("click", h.onShare);
    $("routeImportInput").addEventListener("change", function () {
      if (this.files && this.files[0]) h.onImport(this.files[0]);
      this.value = "";
    });
    el.querySelectorAll("button[data-act]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-id");
        if (b.getAttribute("data-act") === "load") h.onLoad(id);
        else h.onDelete(id);
      });
    });
  }

  function renderRegionWeatherDetail(weatherData, trip) {
    if (!weatherData || !weatherData.byRegion) { set("regionWeather", ""); return; }
    var regions = trip ? uniqueRegions(trip) : C.REGION_ORDER;
    var rows = regions.map(function (r) {
      var rg = weatherData.byRegion[r];
      var agg = rg && rg.today;
      if (!agg) return '<tr><td>' + esc(r) + '</td><td colspan="5">연결 실패</td></tr>';
      return '<tr><td>' + esc(r) + '</td>' +
        '<td>' + esc(WS.CLASS_LABEL[WS.classifyWeather(agg)]) + '</td>' +
        '<td>' + agg.pop + '%</td>' +
        '<td>' + agg.precipMm + 'mm</td>' +
        '<td>' + agg.windMs + ' m/s</td>' +
        '<td>' + esc(agg.confidence) + (agg.uncertain ? " · 불확실" : "") + '</td></tr>';
    }).join("");
    set("regionWeather",
      '<h3>지역별 날씨 (오늘 종합)</h3>' +
      '<table class="wx-table"><thead><tr><th>지역</th><th>구분</th><th>강수확률</th><th>강수량</th><th>풍속</th><th>신뢰도</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>');
  }

  var UI = {
    $: $, esc: esc, badge: badge,
    renderDataStatus: renderDataStatus,
    renderWeather: renderWeather,
    renderRainNotice: renderRainNotice,
    renderStrategyPanel: renderStrategyPanel,
    renderSummary: renderSummary,
    renderSchedule: renderSchedule,
    renderDayFilter: renderDayFilter,
    renderCategoryLists: renderCategoryLists,
    renderLodging: renderLodging,
    renderRouteStore: renderRouteStore,
    renderRegionWeatherDetail: renderRegionWeatherDetail,
    toast: function (msg) {
      var t = $("toast"); if (!t) return;
      t.textContent = msg; t.classList.add("toast--on");
      clearTimeout(UI._tt); UI._tt = setTimeout(function () { t.classList.remove("toast--on"); }, 2600);
    }
  };
  global.UI = UI;
})(window);
