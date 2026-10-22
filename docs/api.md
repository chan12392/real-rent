# 연결 규약

## 구현됨: GET /api/health

인증·DB·외부 API가 없어도 실행되는 서버 연결 확인용 API다.

```http
GET /api/health
```

성공 응답 `200`:

```json
{"status": "ok", "service": "real-rent-api"}
```

실행한 서버의 `/docs`와 `/openapi.json`에서 실제 스키마를 확인한다.
응답 모델은 `backend/app/schemas/health.py`, HTTP 처리는 `backend/app/api/health.py`에 있다.
`frontend/src/lib/api.ts`의 응답 타입·검증과 함께 유지한다.

## 역할 간 연결

| 전달 | 담당과 경계 |
| --- | --- |
| 화면 → 서버 | 개발 1이 입력·오류 표시, 개발 2가 HTTP API와 입력 검증 |
| 자연어 → 구조화 조건 | 개발 3이 추출·추가 질문, 개발 2가 API로 연결 |
| 주소·교통 조회 → 경로 요약 | 개발 2가 외부 호출·응답 검증·캐시·오류 처리, 개발 3이 전달받은 경로 응답 정리 |
| 조건·후보 → 비용·순서 | 분석 담당자가 `app/domain/` 함수 구현, 개발 2·3이 호출 |
| 근거 → 추천 이유 | 분석 담당자가 출처 문서 준비, 개발 3이 RAG·LangGraph와 설명 구현 |

새 기능은 먼저 요청·성공·실패·미확인 값 예시를 이 문서에 합의한다.
개발 2가 `app/schemas/`에 모델을 추가하고, 소비하는 화면·AI·계산 코드와 함께 맞춘다.

## 구현됨: GET /api/demo/catalog

`200`: `{synthetic: true, note: string, offices: Office[], listings: Listing[]}`.
가상 회사 2곳과 합성 매물 4개를 조회한다. 모든 값은 시연용이며 실제 주소 검색이 아니다.
`Office`는 `id`, `label`, `Listing`은 아래 필드를 가진다. 원본의 경로 배열은 이 API에 노출하지 않는다.

| 매물 필드 | 형식 |
| --- | --- |
| `id`, `label`, `area` | 문자열 식별자·이름·시연 지역 |
| `available_from` | 입주 가능일 `YYYY-MM-DD` |
| `deposit_krw`, `monthly_rent_krw` | 0 이상 원 단위 정수 |
| `monthly_management_krw` | 0 이상 정수 또는 `null` (미확인) |
| `management_includes` | 관리비 포함 항목 문자열 배열 |

## 구현됨: POST /api/compare

모든 입력 필드는 필수이며 추가 필드는 거부한다. 숫자 문자열·소수·불리언을 정수로 변환하지 않는다.
금액·시간·횟수는 0 이상 안전 정수, 날짜는 ISO 날짜다. 출근일은 월 0~31일이다.
회사 ID는 catalog에 존재해야 한다.

```json
{
  "office_id": "seoul-station",
  "move_in_date": "2026-11-01",
  "deposit_limit_krw": 10000000,
  "monthly_limit_krw": 800000,
  "workdays": 20,
  "max_commute_minutes": 60,
  "max_transfers": 2,
  "priority": "cost"
}
```

`priority`는 `cost` 또는 `time`이다. `200` 응답:

| 필드 | 의미 |
| --- | --- |
| `synthetic`, `note` | 항상 `true`, 시연 데이터 안내 |
| `conditions`, `office` | 계산에 사용한 요청 그대로와 선택된 회사 |
| `candidates` | 조건 충족 후보 최대 3개, 정렬된 배열 |
| `excluded` | `{id, label, reasons: string[]}` 배열. 미달·미확인 이유 |
| `evaluated_count`, `matched_count` | 평가한 전체 수와 상위 3개 제한 전 충족 수 |

각 후보는 `listing`, `outbound`, `inbound`, `monthly_commute_krw`, `monthly_total_krw`,
`round_trip_minutes`를 가진다. 출근·퇴근 경로는 각각 `minutes`, `fare_krw`, `transfers`,
`walk_minutes`이며 모두 0 이상 정수다. `minutes`에 도보 시간이 이미 포함되어 있다.

### 현재 개발용 판정 규칙

- 보증금·월 지출·편도 시간·편도 환승은 상한과 같아도 통과한다.
- 입주 가능일이 희망일보다 늦으면 제외한다. 같은 날은 통과한다.
- 출근·퇴근 각각에 시간·환승 상한을 적용한다. 경로는 회사별 방향당 고정 1개다.
- 월 교통비 = `(출근 요금 + 퇴근 요금) × 출근일`. 월 지출 = `월세 + 관리비 + 월 교통비`.
- 보증금은 월 지출에 합산하지 않는다. 공과금·정기권·시간 가치·총 거주 기간 비용은 미포함이다.
- 관리비 또는 왕복 경로가 미확인이면 제외한다. 미확인을 0원·0분으로 바꾸지 않는다.
- 출근일 0일이면 교통비만 0원이고 통근 조건은 유지한다. 정식 정책 확정 전 개발용 선택이다.
- 비용 우선은 `월 지출 → 왕복 시간 → ID`, 시간 우선은 `왕복 시간 → 월 지출 → ID`로 정렬한다.
- 후보가 없어도 `200`과 빈 배열을 반환한다. `excluded`로 이유를 보여준다.

기본 입력의 기대값은 D 598,000원 → A 632,000원 → B 712,000원이다.
시간 우선은 B → A → D다. C는 관리비 미확인으로 제외된다.

### 실패와 연결 지점

| 상황 | 응답·화면 처리 |
| --- | --- |
| 잘못된 입력 | `422`, FastAPI 검증 오류 `detail` 배열. 화면은 입력 확인 안내 |
| 알 수 없는 회사 ID | `422`, `detail` 문자열 |
| 시연 파일 누락·파손·형식 오류 | `503`, `{"detail":"시연 데이터를 읽을 수 없습니다."}` |
| 네트워크·8초 초과·잘못된 응답 | 화면이 성공 결과 대신 오류 표시. 입력 유지 후 재시도 |

서버 모델은 `backend/app/schemas/comparison.py`, HTTP 처리는 `api/comparison.py`,
조회는 `db/demo.py`, 계산은 `domain/comparison.py`다.
화면의 `frontend/src/features/comparison/types.ts`와 `api.ts`도 함께 변경한다.
실제 DB·교통 제공자로 교체할 때 이 입력·출력과 순수 계산 함수를 재사용한다.
현재 AI·자연어·주소 검색·캐시·저장 API는 없다. 전체 스키마는 실행 중인 서버의 `/docs`를 기준으로 한다.

## 작업 브랜치 추가: POST /api/explore

기존 `/api/compare` 및 데이터는 유지한다. 새 웹 시제품 전용 규약이다.
요청은 `{message: string(최대 2000자), conditions: ExploreConditions}`이며 message 기본값은 빈 문자열이다.
조건 키는 `deposit`, `budget`(원 단위 정수), `office`(강남역/서울역/여의도역),
`minutes`(편도 도보 포함 분), `move_in`(ISO 날짜), `kind`(원룸/오피스텔/빌라),
`transfers`(편도 환승), `workdays`(0~31, 기본 20), `modes`(조건별 required/preferred)다.
미입력은 null. 환승은 기본 제한 없음. office는 계산 대상을 고르는 선택이며 선호 판정에는 넣지 않는다.
별도 지정이 없으면 보증금·월 예산·입주일은 필수, 통근·유형·환승은 선호다.

LangGraph의 extract → respond가 규칙 기반 조건 추출·검증·추가 질문을 처리한다.
LLM·검색·외부 추적 서비스를 호출하지 않는다. 금액(천만/1000만/1억 5천만),
직장, 분 단위 통근, ISO 입주일, 유형, 환승 없이/환승 1회, 월 출근일 표현을 지원한다.
모호한 문장은 재질문한다. 연도 없는 입주일은 추측하지 않는다.

응답은 `{synthetic:true,note,conditions,reply,homes,partial}`.
`homes`는 `data/demo/explore.json`의 합성 매물 12개 전체이며 월 지출→왕복 중 긴 편도 시간→
왕복 중 큰 환승 수→ID로 정렬한다. 새 시제품의 통근/환승 동률 정책이며 기존 compare 정렬은 바꾸지 않는다.
각 집에 `status`(idle/good/so-so/bad/unknown), `checks`, `reasons`, `commute`, `total`,
`route`, `minutes`, `transfers`를 추가한다. 방향별 시간·환승 모두 상한 이하여야 충족한다.
월 통근비=(출근 요금+퇴근 요금)×출근일, 월 지출=월세+관리비+월 통근비.
정보가 없으면 null. 출근 0일도 경로 검증과 통근 조건은 유지한다.

조건 없음=idle. 확인된 필수 위반=bad, 그 외 관리비/선택 직장 경로 누락=unknown,
그 외 선호 미달=so-so, 모두 충족=good. 필수 위반과 미확인이 함께 있으면 bad와 미확인 이유를 함께 표시한다.
입력이 덜 된 결과는 partial=true인 임시 판정이다. 직장 미입력 시 통근비·월 합계는 null이며
설정된 월 예산 검사는 미확인이므로 확정 추천하지 않는다.

입력 형식 오류는 422, 시연 파일 오류는 503. API 상태는 요청에 실어 보내며 서버에 공용 사용자 상태를 두지 않는다.
화면은 버전 지정 localStorage에 대화·조건·선택 집을 보관한다. 대화는 최대 최근 100개 메시지다.
다른 브라우저/기기와 공유하지 않는다. 선택 집은 조건 변경 후에도 유지된다.
