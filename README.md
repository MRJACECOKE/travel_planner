# 동해안 드라이브 여행 플래너

경상북도 동해안(경주)부터 강원도 고성까지, 자가용 이동 방향·주차·우회거리·운전 피로·기상 상황·영업시간·시간 효율을 종합해 여행 일정을 자동으로 만들고, 네이버 지도에서 확인할 수 있는 PC/모바일 반응형 웹 애플리케이션입니다.

단순 관광지 목록이 아니라 다음 네 시스템을 결합합니다.

1. 최신 관광/후기 데이터 검색 증강(어댑터 + fallback 구조)
2. 차량 이동 동선 최적화(회랑 모델, 역주행·우회 감점)
3. 다중 날씨 분석 및 우천 대응(공급자 종합 + 일치도 + 전략 엔진)
4. 네이버 지도 기반 코스 시각화(+ 목록형 fallback)

이 프로젝트에서 **우천 대응은 부가기능이 아니라 핵심 추천 원칙**입니다. 비가 예상되면 차량 이동 방향을 유지하면서 드라이브 비중과 실내 볼거리 비중을 적극적으로 높여 일정을 자동 재구성하고, 호우·강풍 시에는 해안 노출 구간을 감점하고 주요 도로 + 실내 관광 중심으로 전환합니다.

---

## 실행 방법

빌드 과정이 없는 정적 웹 앱입니다.

### 로컬에서 열기

정적 서버로 열어야 `data/*.json` 로드와 Open-Meteo 호출이 정상 동작합니다.

```bash
# 예시 1: Python
python -m http.server 4173

# 예시 2: Node (npx)
npx --yes serve -l 4173 .
```

브라우저에서 `http://localhost:4173/` 접속 후 `index.html` 이 열리는지 확인합니다.

`file://` 로 직접 열어도 화면은 뜨지만, 외부 JSON 로드가 막혀 내장 DEMO 데이터만 사용됩니다.

### 정적 검증

```bash
node tests/verify-planner-donghae.cjs
```

데이터 무결성, 다중 날씨/예보 일치도, 필수 테스트 A~F, 정적 파일(태그 균형·다크모드 미구현·글꼴) 검사를 수행합니다.

### 개발자 모드(강제 날씨 시나리오)

URL 쿼리로 날씨를 강제할 수 있습니다.

```
?weather=clear          맑음
?weather=light-rain     약한 비
?weather=rain           비
?weather=heavy-rain     강한 비(강풍 동반)
?weather=disagree       공급자 예보 큰 불일치(신뢰도 낮음 표시 확인용)
```

---

## 디렉터리 구조

```
index.html                 진입점 (반응형 레이아웃, 시맨틱 구조)
css/
  style.css                디자인 토큰, 컴포넌트 (라이트 모드 전용, 맑은 고딕)
  responsive.css           360 / 390 / 430 / 768 / 1025 / 1360 브레이크포인트
js/
  config.js                외부 API 키/전역 설정 (키는 주입 방식)
  data.js                  관광 데이터 모델 + 내장 DEMO 장소 100곳
  reviews.js               검색 증강(후기) 어댑터 + 광고성 감점 + 요약
  weather.js               다중 날씨 엔진 (Open-Meteo + 기상청/OpenWeather 어댑터)
  weatherStrategy.js       우천 전략 엔진 (분류·위험·적합도·전략·재구성)
  routeOptimizer.js        차량 동선 최적화 (회랑·역주행·우회·이동시간)
  recommendation.js        종합 추천 점수 엔진
  schedule.js              DAY 일정 생성 파이프라인
  map.js                   네이버 지도 v3 + 목록형 fallback
  ui.js                    화면 렌더링
  app.js                   파이프라인 오케스트레이션 + UI 배선
data/
  places.json              내장 데이터 내보내기 (source:"demo")
  reviews.json             후기 신호/요약 내보내기 (rawReviews 는 비어 있음)
  indoor-attractions.json  실내 볼거리 후보 추출본
scripts/
  export-data.cjs          data/*.json 재생성 스크립트
tests/
  verify-planner-donghae.cjs   정적/로직 검증
  verify-planner.cjs           기존 단일 파일(donghae-planner.html)용 검증
README.md
```

> 기존 산출물 `donghae-planner.html`(단일 파일 버전)과 `versions/` 는 그대로 보존했습니다. 이번 작업은 별도의 다중 파일 프로젝트입니다.

---

## 추천 알고리즘

각 장소에 0~100 척도의 세부 점수를 계산하고 가중합에서 페널티를 감산합니다.

```
score = recent        * 0.15   // 최근 관심도 (DEMO 대체지표)
      + reviewQuality  * 0.14   // 후기 품질 신호 (주차·접근성·구체성)
      + routeFit       * 0.17   // 목표 지역 근접 + 방향 진행량
      + driveValue     * 0.11   // 드라이브/경관 가치
      + parking        * 0.08   // 주차 편의
      + scenic         * 0.08   // 경관
      + timeEfficiency * 0.09   // 체류·우회 대비 가치
      + weatherFit     * 0.12   // 장소 x 날씨 적합도
      + userPreference * 0.06   // 취향 슬라이더 일치
      + rainStrategyBonus       // 우천 전략 가감 (-25 ~ +20)
      - commercialPenalty       // 광고성 감점 (0~40)
      - detourPenalty           // 내륙 진입·곶 우회 (0~30)
      - backtrackingPenalty     // 역주행 (0~40)
      - weatherRiskPenalty;     // 호우·강풍 안전 감점 (0~40)
```

`routeFitScore`, `weatherFitScore`, `backtrackingPenalty`, `weatherRiskPenalty` 는 항상 계산됩니다. 가중치는 `config.js`의 `WEIGHTS` 에서 조정할 수 있습니다.

하루 선택은 우천 시 §3 우선순위(드라이브 → 실내 → 맛집 → 실내 카페 → 시장·박물관·전시관·아쿠아리움 → 짧은 야외)를 반영해, 식사·드라이브·실내·카페를 먼저 확보한 뒤 상위 점수로 채웁니다. 우천일수록 채우기 최소 점수 기준을 높여 저품질 야외를 배제합니다.

---

## 차량 동선 알고리즘

- 모든 장소에 회랑값 `corridor` 를 부여합니다(남 → 북 단조 증가). 위도 대신 회랑값을 쓰는 이유는 호미곶 같은 곶에서 위도 정렬이 잘못된 판정을 내리기 때문입니다.
- `detectRouteDirection()` 으로 북상/남하/권역 집중을 판정합니다.
- `calculateDirectionalProgress()` 가 음수면(역주행) `calculateBacktrackingPenalty()` 로 감점하고, 하루 선택 단계에서 큰 역주행(감점 20 이상)은 아예 제외합니다.
- 우천 재구성은 도시 순서(회랑 단조성)를 깨지 않습니다. 활동 순서(드라이브·실내를 앞쪽)만 완만히 조정하며, 회랑이 6 이상 후퇴하면 회랑순으로 되돌립니다.
- 이동시간은 좌표 거리 × 도로 굴곡 계수 ÷ 도로유형별 평균속도로 추정하며 내륙 진입·곶 진입·2시간 주행 휴식·우천 감속·주차 난이도를 반영합니다. **실시간 교통정보가 아니라 예상값**입니다.
- `chooseRoadType()` 은 거리와 사용자 해안도로 선호도로 고속도로/국도/해안도로를 선택하고, 호우·강풍이면 해안도로를 회피하고 주요 도로를 우선합니다.
- 출발지(부산·울산 등)는 해안 회랑상의 지점이 아니므로 DAY 1 은 역주행 제약 없이 시작지역을 우선합니다.

---

## 우천 대응 알고리즘

`weatherStrategy.js`

- `classifyWeather()` : 종합 강수확률·강수량·풍속으로 `CLEAR / LIGHT_RAIN / RAIN / HEAVY_RAIN` 분류. 풍속 12 m/s 또는 돌풍 16 m/s 이상은 강한 비로 승격.
- `calculateRainRisk(agg, band)` : 오전/오후/저녁 시간대별 강수 위험 0~1.
- `calculateWeatherFitScore(place, cls, agg)` : 장소 `weatherProfile` 에서 해당 날씨 등급 값을 가져오고, 강풍 시 `strongWind` 프로파일과 혼합.
- `applyRainStrategy()` : 실내 볼거리 가점, 안전 범위 내 드라이브 가점(비 +15), 카페·맛집 가점, 해변·노출 해안·전망대·긴 산책 감점.
- `applyHeavyRainSafetyPenalty()` : 호우·강풍 시 해안 노출 구간, 노출 전망대, 위험 해안도로 감점. 강풍이면 방파제·전망 포인트 제외 권장.
- `rebuildScheduleForWeather()` : 도시 순서 유지, 노출 야외 체류시간 축소, 실내 체류시간 유지/확대, 우천 조치 태그 부여.

호우 + 강풍(severe)일 때는 해안 드라이브 자체를 우선 확보하지 않고 실내로 대체합니다.

---

## 실내 관광 분류 방식

- `INDOOR_ATTRACTION` 을 독립 카테고리로 두고, 우천 대응에서는 `MUSEUM / EXHIBITION / AQUARIUM / MARKET` 와 `indoor:true` 장소를 "실내 볼거리" 로 함께 묶습니다(`DATA.isIndoorLike`).
- 각 장소에 `indoor / partialIndoor / inland / peninsula` 플래그와 `weatherProfile { clear, lightRain, rain, heavyRain, strongWind }` 를 둡니다.
- 맛집·카페는 착석 시설로 보아 화면 표기상 "실내"로 처리하되, "실내 볼거리" 분류에는 넣지 않습니다.
- 지역별로 실내 볼거리·드라이브·맛집·카페가 최소 1곳씩 존재하도록 데이터를 구성했습니다.

---

## 다중 날씨 종합 방식

- 하나의 공급자만 사용하지 않습니다. 실호출은 키가 필요 없는 **Open-Meteo(ECMWF 계열)** 를 사용합니다.
- **기상청·OpenWeather** 는 키가 있으면 어댑터로 연동하고(현재는 인터페이스만), 키가 없으면 Open-Meteo 값을 결정적으로 변형한 "데모(파생)" 뷰로 대체하며 화면에 항상 그 사실을 표시합니다.
- `aggregateWeather()` : 실시간 공급자 가중치 1.0, 데모 파생 0.6 으로 가중 평균.
- `calculateForecastAgreement()` : 공급자 강수확률 편차(spread)로 신뢰도 `높음/보통/낮음` 을 산출하고, 편차 35%p 초과면 "예보 불확실성 높음" 을 표시합니다.
- 여행 전체 날짜에 대해 지역별 예보를 조회하고, 지역 대표 좌표(`REGION_META`)만 사용합니다. 실제 여행 범위(경주~고성) 안의 지역만 조회합니다.
- 일부 공급자·지역 호출이 실패해도 나머지로 계속 진행하고 데이터 상태를 `LIVE / PARTIAL LIVE / DEMO` 로 표시합니다.

---

## 검색 증강 구조

`reviews.js`

```
검색 → 출처 저장 → 내용 정제 → 광고성 감점 → 중복 제거
→ 후기 요약 → 장소별 특징 → 추천 데이터
```

- `ReviewEngine.fetchReviews(place)` 는 기본적으로 빈 결과를 반환합니다. 실제 연동 시 대한민국 구석구석·네이버/다음 검색 결과를 `[{text, url, source, publishedAt}]` 로 반환하도록 이 함수만 교체하면 됩니다.
- `refine()` 은 중복 제거 후 광고성 키워드(광고·협찬·체험단·원고료·제공받아·소정의·업체로부터·지원받아 등)로 `commercialPenalty` 를 높이고, 신뢰 신호(주차·대기시간·도로 접근성·방문시간·동선·혼잡·재방문·구체적 평가)로 가점합니다. 키워드가 있다고 무조건 제거하지 않습니다.
- **실제 후기를 확보하지 못한 상태에서 "2026년 최근 후기에서 인기" 같은 문장을 임의로 만들지 않습니다.** 화면의 후기 자리에는 "실제 방문자 후기 데이터 연결 필요 (현재 DEMO)" 를 명시하고, `demoRecent` 는 "실측 방문자 수가 아닌 DEMO 관심도 지표" 임을 표기합니다.

---

## 데모 데이터 설명

- `js/data.js` 에 10개 지역(경주·포항·영덕·울진·삼척·동해·강릉·양양·속초·고성) × 지역별 8~11곳, 총 100곳이 내장되어 있습니다.
- 좌표/유형/운영시간은 공개된 일반 정보를 참고한 대표값이며, **모두 DEMO** 입니다. 각 장소 카드와 데이터 상태 배지에 DEMO 임을 표시합니다.
- 강제 날씨 시나리오(맑음/약한 비/비/강한 비/예보 불일치)로 우천 로직 전체를 테스트할 수 있습니다.
- `data/*.json` 은 이 내장 데이터를 그대로 내보낸 파일입니다(`scripts/export-data.cjs` 로 재생성).

---

## 실데이터 연결 방법

1. **관광 데이터(대한민국 구석구석 / 한국관광공사 TourAPI)**
   - `data/places.json` 을 TourAPI(지역기반관광정보·소개정보·반복정보) 결과로 채우고 최상위 `"source"` 를 `"live"` 로 바꿉니다.
   - 앱은 로드 시 `DATA.tryLoadExternal()` 로 이 파일을 읽어 `mergeVisitKoreaData()` 로 병합하고 데이터 상태를 `PARTIAL / LIVE` 로 올립니다.
   - 관광지 유형을 분석해 `실내 / 실외 / 부분 실내 / 우천 적합 / 우천 부적합` 태그(= `category` + `weatherProfile`)를 채우십시오.
2. **후기 데이터**
   - `ReviewEngine.fetchReviews(place)` 를 실제 검색 결과 반환 구현으로 교체하고, `data/reviews.json` 의 `rawReviews` 를 채웁니다.
3. **날씨**
   - `config.js` 에 `KMA_API_KEY`, `OPENWEATHER_API_KEY` 를 주입하면 `weather.js` 의 `fetchKMA` / `fetchOpenWeather` 어댑터를 구현해 실제 3중 공급자 종합이 가능합니다.

`config.js` 는 값을 직접 넣지 않고 `window.__DONGHAE_ENV__` 주입 또는 배포 환경변수로 채웁니다.

```html
<script>window.__DONGHAE_ENV__ = { NAVER_MAP_CLIENT_ID: "발급값" };</script>
```

---

## NAVER 지도 설정

- `map.js` 는 NAVER Maps JavaScript API **v3** 를 사용합니다(`ncpKeyId` / `ncpClientId` 파라미터 병행).
- `config.js` 의 `NAVER_MAP_CLIENT_ID` 가 있으면 지도에 번호 마커·DAY 색상·경로 폴리라인·정보창·DAY 필터를 표시하고, 일정 카드 번호와 마커 번호를 일치시킵니다.
- 마커에는 색상뿐 아니라 `D{일}-{번호} · 기호+텍스트 배지`(☂ 실내 / 🚗 드라이브 / 🍽 맛집 / ☕ 카페 / 🌊 해안 등)를 함께 표시합니다.
- 키가 없거나 스크립트 로딩이 6초 안에 끝나지 않으면 **목록형 fallback** 으로 자동 전환되며, 여행 조건·추천 코스·DAY 일정·날씨·장소 카드는 그대로 동작합니다.
- 지도 서비스 도메인 등록: NAVER Cloud Platform 콘솔의 Maps 애플리케이션에 배포 도메인을 Web 서비스 URL 로 등록해야 합니다.
- **전체 코스 지도 이미지**: 지도 영역 하단의 "전체 코스 지도 이미지" 에 전체 일정을 한 장으로 나타낸 개요 지도(SVG)를 항상 생성합니다. 방문지 좌표를 축척한 위치에 방문 순서를 표시하고 DAY별 색으로 이동선을 잇습니다. "개요 지도 이미지 저장(SVG)" 로 내려받거나 "네이버 지도에서 전체 코스 열기" 링크를 사용할 수 있습니다.

## 숙박 (모텔 중심)

- 당일치기(1일)가 아니면 각 밤의 숙박 지역을 자동 판정합니다(그날 마지막 방문지가 속한 지역).
- 특정 업소명이 아니라 지역별 **모텔 밀집 지역**과 네이버 "모텔 검색" 링크를 제공합니다(`data.js` 의 `LODGING`, 현재 DEMO). 실운영 시 숙박 예약 API(야놀자·여기어때·부킹 등) 연동으로 교체하십시오.
- DAY 카드에는 숙박 지역이, "숙박 지역 · 모텔 중심 추천" 섹션에는 밤별 상세(체크인 예상 시각·마지막 방문지·모텔 밀집 지역)가 표시됩니다. 마지막 날은 "여행 종료" 로 표시됩니다.

## TourAPI 설정

- 한국관광공사 TourAPI 4.0 키를 발급받아 `TOUR_API_KEY` 로 주입합니다.
- **TourAPI 키는 브라우저에 노출하기에 부적절합니다.** 실운영에서는 서버 프록시(예: `/api/tour`)를 두고 프런트는 프록시만 호출하도록 구성하십시오. 현재 저장소의 `api/` 폴더가 그 자리입니다.

## 기상청 설정

- 기상청 단기예보 조회서비스 키를 `KMA_API_KEY` 로 주입합니다.
- 기상청 API 도 클라이언트 노출·CORS 제약이 있어 **서버 프록시가 필요**합니다. `weather.js` 의 `fetchKMA()` 에 프록시 호출을 구현하고 `normalizeWeatherData` 형태로 정규화하십시오.

## OpenWeather 설정

- OpenWeather One Call/Forecast 키를 `OPENWEATHER_API_KEY` 로 주입하고 `fetchOpenWeather()` 를 구현합니다.
- 무료 플랜 호출 한도와 CORS 정책을 확인하고 필요 시 프록시를 둡니다.

## Open-Meteo 설정

- 키가 필요 없으며 브라우저에서 직접 호출합니다. 엔드포인트는 `config.js` 의 `OPEN_METEO_BASE` 입니다.
- 과도한 호출 시 429(요청 제한)가 반환될 수 있으며, 이 경우 앱은 실패한 지역을 제외하고 계속 진행하며 상태를 `PARTIAL LIVE` 로 표시합니다.

---

## API 오류 fallback

| 실패 대상 | 동작 |
|---|---|
| NAVER Maps 키 없음/로딩 실패 | 목록형 지도 fallback, 나머지 기능 정상 |
| Open-Meteo 실패/429 | 해당 지역 날씨 카드에 "연결 실패" 표시, 나머지 지역·일정 정상, 상태 `PARTIAL LIVE` |
| 전체 날씨 실패 | 날씨 없이 동선만 계산, 상태 `DEMO`, 안내 토스트 |
| 기상청/OpenWeather 미연동 | Open-Meteo 기반 "데모(파생)" 뷰로 대체, 화면에 표시 |
| TourAPI 미연동 | 내장 DEMO 장소 100곳 사용, 상태 `DEMO` |
| 후기 API 미연동 | 후기 자리에 "연결 필요" 명시, 구조적 신호로 점수만 산출 |

하나가 실패해도 앱 전체가 멈추지 않습니다.

---

## 배포 방법

정적 호스팅(예: Vercel, Netlify, GitHub Pages, S3 등)에 이 폴더를 그대로 올립니다.

- 빌드 명령 없음. 루트 경로가 `index.html` 로 연결되는지 확인합니다.
- `vercel.json` 이 루트 재작성과 보안 헤더(CSP 포함)를 제공합니다. 기존 단일 파일 버전은 `/legacy` 로 접근할 수 있습니다.
- HTTPS 로 배포해야 지도 연결과 외부 API 호출이 안정적으로 동작합니다.
- NAVER/기상청/OpenWeather/TourAPI 키를 쓰는 경우 배포 환경변수 또는 `__DONGHAE_ENV__` 주입으로 넣고, 서버 프록시가 필요한 키는 절대 브라우저 번들에 포함하지 않습니다.

---

## 보안 주의사항

- 비밀 키(TourAPI·기상청·OpenWeather 시크릿)를 브라우저 코드에 넣지 않습니다. 서버 프록시에서 환경변수로만 사용합니다.
- `NAVER_MAP_CLIENT_ID` 는 클라이언트 공개용이지만, 콘솔에서 허용 도메인을 반드시 제한합니다.
- 개인정보를 URL 파라미터·쿼리스트링에 넣지 않습니다. 이 앱은 위치 권한을 요청하지 않으며, 입력값과 선택 결과는 브라우저 `localStorage` 에만 저장합니다.
- 무단 크롤링으로 법적/기술적 제한을 우회하지 않습니다. 검색 증강은 공개 API·정상 접근 범위에서만 구성합니다.
- 엄격한 CSP 를 적용하려면 인라인 스크립트/스타일을 외부 파일로 분리하고 nonce 또는 해시 정책을 적용하십시오.

---

## 데이터 최신성 표기

화면 상단 데이터 상태에 "관광 기본정보 확인일 / 최근 후기 기준 / 날씨 갱신 시각" 을 표시하며, 확인되지 않은 값에는 허위 날짜를 넣지 않고 "연결 필요" 로 표기합니다.
