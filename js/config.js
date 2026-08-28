/* =============================================================
   config.js - 외부 API 키와 전역 설정
   - 실제 키는 이 파일에 직접 넣지 않습니다. 배포 환경변수 또는
     window.__DONGHAE_ENV__ 주입으로 교체합니다. (README 참고)
   - 키가 비어 있어도 앱은 fallback / DEMO DATA 로 정상 동작합니다.
   ============================================================= */
(function (global) {
  "use strict";

  var injected = global.__DONGHAE_ENV__ || {};

  var CONFIG = {
    /* NAVER Maps JavaScript API v3 클라이언트 ID. 비어 있으면 지도는 목록형 fallback 으로 표시됩니다. */
    NAVER_MAP_CLIENT_ID: injected.NAVER_MAP_CLIENT_ID || "d0xw6yk1re",

    /* 한국관광공사 TourAPI 키. 비어 있으면 내장 DEMO 관광 데이터를 사용합니다.
       주의: TourAPI 키는 클라이언트 노출이 부적절하므로 실운영에서는 서버 프록시가 필요합니다. */
    TOUR_API_KEY: injected.TOUR_API_KEY || "",

    /* 기상청 동네예보 키. 비어 있으면 Open-Meteo 기반 파생 추정(데모)으로 대체합니다.
       기상청 API 도 클라이언트 노출이 부적절하므로 실운영에서는 서버 프록시가 필요합니다. */
    KMA_API_KEY: injected.KMA_API_KEY || "",

    /* OpenWeather 키. 비어 있으면 Open-Meteo 기반 파생 추정(데모)으로 대체합니다. */
    OPENWEATHER_API_KEY: injected.OPENWEATHER_API_KEY || "",

    /* Open-Meteo 는 키가 필요 없는 공개 예보입니다. 브라우저에서 직접 호출합니다. */
    OPEN_METEO_BASE: "https://api.open-meteo.com/v1/forecast",

    /* 실 공급자 키가 없을 때, 예보 종합/일치도 UI 시연을 위해
       Open-Meteo 값을 결정적으로 변형한 "데모 편차" 공급자 뷰를 만들지 여부.
       만들어진 값은 화면에서 항상 "데모(파생)" 로 표시합니다. */
    ALLOW_SYNTHETIC_PROVIDERS: true,

    /* 이동시간 추정 파라미터 (실제 교통정보가 아닌 예상값) */
    DRIVE: {
      coastalKmh: 46,      // 해안도로 평균속도
      nationalKmh: 58,     // 국도 평균속도
      expressKmh: 82,      // 고속도로 평균속도
      curvature: 1.22,     // 직선거리 대비 도로 굴곡 계수
      inlandExtraMin: 12,  // 내륙 진입 1회 추가 이동시간
      peninsulaExtraMin: 18, // 곶(반도) 진입-복귀 추가 이동시간
      rainSpeedFactor: 0.86, // 비
      heavyRainSpeedFactor: 0.72, // 강한 비/강풍
      restPer2hMin: 15     // 2시간 주행마다 휴식 가산
    },

    /* 하루 기본 상한 (사용자 입력으로 덮어쓸 수 있음) */
    LIMITS: {
      maxDriveMinutesPerDay: 300,
      maxPlacesPerDay: 6,
      maxCafePerDay: 2,
      lunchWindow: ["11:30", "13:30"],
      dinnerWindow: ["17:30", "19:30"]
    },

    /* 추천 점수 가중치 (합계 1.0, 페널티는 별도 감산) */
    WEIGHTS: {
      recent: 0.15,
      reviewQuality: 0.14,
      routeFit: 0.17,
      driveValue: 0.11,
      parking: 0.08,
      scenic: 0.08,
      timeEfficiency: 0.09,
      weatherFit: 0.12,
      userPreference: 0.06
    },

    /* 데이터 기준일 (허위 날짜 금지 - 내장 DEMO 데이터 정리 시점) */
    DATA_BASELINE: {
      tourInfoCheckedAt: "2026-08-29",
      reviewBaseline: "연결 필요 (내장 데이터는 DEMO)",
      weatherUpdatedAt: null // 런타임에 채워집니다
    }
  };

  /* 여행 추천 대상 지역 (남 -> 북). 부산/울산은 관광 추천에서 제외합니다. */
  CONFIG.REGION_ORDER = ["경주", "포항", "영덕", "울진", "삼척", "동해", "강릉", "양양", "속초", "고성"];

  /* 출발지로만 허용되는 지역 (관광 후보에서는 제외) */
  CONFIG.ORIGIN_ONLY_REGIONS = ["부산", "울산"];

  CONFIG.regionIndex = function (name) {
    return CONFIG.REGION_ORDER.indexOf(name);
  };

  global.CONFIG = CONFIG;
})(window);
