/* =============================================================
   reviews.js - 검색 증강(Review Augmentation) 어댑터
   -------------------------------------------------------------
   중요: 실제 후기를 확보하지 못한 상태에서 "2026년 최근 후기에서 인기"
   같은 문장을 임의로 만들지 않습니다.
   - fetchReviews() 는 기본적으로 빈 결과를 돌려주며, 외부 연결이
     구성되면 같은 인터페이스로 실제 데이터를 반환하도록 교체합니다.
   - 아래 signal 값은 후기 문장이 아니라, 장소 유형/주차/접근성에서
     파생한 구조적 지표이며 화면에서 "DEMO" 로 표시됩니다.
   - 파이프라인: 검색 → 출처 저장 → 정제 → 광고성 감점 → 중복 제거
     → 요약 → 장소별 특징 → 추천 데이터
   ============================================================= */
(function (global) {
  "use strict";

  var AD_KEYWORDS = ["광고", "협찬", "체험단", "원고료", "제공받아", "소정의", "업체로부터", "지원받아", "무상제공", "쿠폰제공"];

  var TRUST_BONUS_KEYWORDS = ["주차", "대기시간", "웨이팅", "진입", "도로", "방문시간", "동선", "혼잡", "재방문", "직접"];

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  /* 장소 특성에서 파생한 구조적 신호 (DEMO). 실제 후기 표본이 아님. */
  function derivedSignals(place) {
    var pkDiff = place.parking && place.parking.difficulty || "normal";
    var parkingClarity = pkDiff === "easy" ? 88 : pkDiff === "normal" ? 66 : 40;
    if (place.parking && place.parking.covered) parkingClarity = clamp(parkingClarity + 8, 0, 100);

    var roadAccess = place.inland ? 55 : place.peninsula ? 60 : 78;
    if (place.category === "DRIVE") roadAccess = 82;

    var interest = place.demoRecent; // DEMO 관심도 지표
    var congestion = interest >= 78 ? "high" : interest >= 58 ? "mid" : "low";

    var commercialRisk = 0;
    if (["FOOD", "CAFE", "MARKET"].indexOf(place.category) >= 0) commercialRisk = 22;
    if (place.demoRecent >= 80) commercialRisk += 10;

    return {
      status: "DEMO",
      recentInterest: interest,
      recentInterestLabel: "DEMO 관심도(검색·저장 등 대체지표 가정, 실측 방문자 수 아님)",
      parkingClarity: parkingClarity,
      roadAccess: roadAccess,
      congestion: congestion,
      commercialRisk: clamp(commercialRisk, 0, 100),
      sampleCount: 0
    };
  }

  var ReviewEngine = {
    AD_KEYWORDS: AD_KEYWORDS,
    TRUST_BONUS_KEYWORDS: TRUST_BONUS_KEYWORDS,
    status: "DEMO",
    baseline: "연결 필요 (내장 값은 DEMO)",

    /* 외부 후기 검색 어댑터. 기본 구현은 빈 배열.
       실제 연동 시: 대한민국 구석구석 / 네이버·다음 검색 결과를
       [{ text, url, source, publishedAt }] 형태로 반환하도록 교체. */
    fetchReviews: function (place) {
      return Promise.resolve([]);
    },

    /* 검색 결과 정제: 중복 제거 + 광고성 표시 + 신뢰 신호 추출 */
    refine: function (rawList) {
      var seen = {}, out = [];
      (rawList || []).forEach(function (r) {
        var key = (r.text || "").replace(/\s+/g, "").slice(0, 40);
        if (!key || seen[key]) return;
        seen[key] = 1;
        var text = r.text || "";
        var commercialPenalty = 0;
        AD_KEYWORDS.forEach(function (k) { if (text.indexOf(k) >= 0) commercialPenalty += 12; });
        var trust = 0;
        TRUST_BONUS_KEYWORDS.forEach(function (k) { if (text.indexOf(k) >= 0) trust += 6; });
        out.push({
          text: text, url: r.url || "", source: r.source || "", publishedAt: r.publishedAt || null,
          commercialPenalty: Math.min(commercialPenalty, 40), trustSignal: Math.min(trust, 40)
        });
      });
      return out;
    },

    signals: function (place) {
      if (!place.__signals) place.__signals = derivedSignals(place);
      return place.__signals;
    },

    /* 후기 품질 점수 0-100 (실제 표본이 없으면 구조적 신호 기반, DEMO) */
    calculateReviewQuality: function (place) {
      var s = ReviewEngine.signals(place);
      var q = 0.45 * s.roadAccess + 0.35 * s.parkingClarity + 0.20 * clamp(s.recentInterest, 0, 100);
      if (place.note) q -= 4;
      return clamp(Math.round(q), 0, 100);
    },

    /* 광고성 감점 0-40 */
    calculateCommercialPenalty: function (place) {
      var s = ReviewEngine.signals(place);
      return clamp(Math.round(s.commercialRisk * 0.4), 0, 40);
    },

    /* 최근성 점수 0-100 (DEMO 관심도 지표) */
    calculateRecentScore: function (place) {
      var s = ReviewEngine.signals(place);
      return clamp(Math.round(s.recentInterest), 0, 100);
    },

    /* 장소 요약: 후기 문장을 만들어내지 않고, 확인 가능한 속성만 서술 */
    summarize: function (place) {
      var parts = [];
      parts.push(DATA.CATEGORY_LABELS[place.category] + (place.subCategory ? " · " + place.subCategory : ""));
      parts.push(place.indoor ? "실내 위주" : place.partialIndoor ? "부분 실내" : "야외 위주");
      var pk = place.parking || {};
      parts.push("주차 " + (pk.available ? ({ easy: "쉬움", normal: "보통", hard: "혼잡" }[pk.difficulty] || "보통") : "정보 없음") + (pk.covered ? "(실내)" : ""));
      parts.push("권장 체류 약 " + place.stayMin + "분");
      if (place.note) parts.push(place.note);
      return {
        text: parts.join(" · "),
        reviewNote: "실제 방문자 후기 데이터 연결 필요 (현재 DEMO)",
        positives: [],
        negatives: [],
        sources: []
      };
    }
  };

  global.ReviewEngine = ReviewEngine;
})(window);
