# 연결 규약

모든 매물·가격·좌표·교통 값은 **합성 데이터**다(`data/demo/listings.csv`, `data/demo/commute_fixture.csv`).
계산 규칙은 팀 승인 전 요구사항 초안(피드백반영본) 기준의 **시연 가정**이다. 응답의 `assumptions`에 그대로 노출한다.

공통 규칙

- 금액: 원 단위 정수, 이름에 `_krw`. 기간: 개월 정수. 시간: 분 정수. 날짜: `YYYY-MM-DD` 형식 문자열.
  `/api/compare`의 `move_in_by`와 `/api/conditions/parse`의 `current.move_in_by`에 날짜 값을 보낼 때 숫자 timestamp, 시각 포함 문자열, 존재하지 않는 날짜는 `422`로 거부한다.
- 확인하지 못한 값은 `null`. `0`과 구분한다.
- `/api/health`를 제외한 모든 응답에 `"synthetic": true`와 `assumptions`를 포함한다.
- 입력 오류는 FastAPI 기본 `422`를 쓴다.

## GET /api/health

```json
{"status": "ok", "service": "real-rent-api"}
```

## GET /api/listings

```jsonc
{
  "synthetic": true,
  "price_basis": "가정값(실거래 미조회)",
  "listings": [
    {
      "listing_id": "L01", "label": "시연 매물 01", "gu": "관악구", "dong": "신림동",
      "deposit_krw": 10000000, "monthly_rent_krw": 500000,
      "monthly_management_krw": 70000,          // null = 미확인
      "management_includes": ["수도", "인터넷"], // 미확인이면 []
      "move_in_available": "2026-11-01",
      "lat": 37.4842, "lng": 126.9295,
      "outbound": {"minutes": 38, "fare_krw": 1550, "transfers": 1, "walk_minutes": 10}, // null = 경로 조회 실패
      "return":   {"minutes": 40, "fare_krw": 1550, "transfers": 1, "walk_minutes": 10}
    }
  ]
}
```

## POST /api/compare

요청

```jsonc
{
  "deposit_limit_krw": 10000000,     // >= 0
  "monthly_budget_krw": 750000,      // >= 0
  "move_in_by": "2026-11-01",
  "office_days": 20,                 // 0..31
  "max_one_way_minutes": 40,         // >= 1
  "max_transfers": 1,                // >= 0
  "priority": "cost",                // "cost" | "time"
  "stay_months": 12,                 // 1..60, 선택, 기본 12
  "management_overrides": {"L03": 60000}, // 선택. 사용자가 직접 확인한 관리비로 재계산
  "living": {                        // 선택. 생략해도 기본값으로 참고 계산
    "persons": 1,                    // 1..6 정수, 기본 1
    "heating": "individual_gas",      // individual_gas | central | electric
    "move_in_month": 11,             // 1..12 정수, 생략/null이면 move_in_by의 월
    "include_economic": true         // 기본 true
  }
}
```

`living` 내부 필드도 모두 선택이며 `heating`의 기본값은 `individual_gas`다. `living` 생략/null은
기본 생활 조건으로 계산하고, 기존 `conditions` echo에는 `living`을 추가하지 않는다.
객체를 전달하면 echo에 기본값과 실제 적용한 입주월을 채운다. 잘못된 타입·범위·알 수 없는 필드는 `422`다.

판정 순서(첫 실패가 `primary_reason`, `reasons`에는 판단 가능한 모든 실패 사유를 이 순서로)

1. 출근 또는 퇴근 경로가 없으면 `route_failed` ("출근 또는 퇴근 경로 조회 실패")
2. 보증금 > 한도 → `fail` ("보증금 한도 초과")
3. 입주 가능일 > 희망일 → `fail` ("입주 가능일이 희망일보다 늦음")
4. 관리비 미확인(덮어쓰기도 없음) → `unknown` ("관리비 미확인으로 월 지출 계산 불가")
5. 월 지출 > 예산 → `fail` ("월 지출 한도 초과"). **예산과 같으면 통과**(가정)
6. 출근일 > 0일 때만: 출근·퇴근 각각 시간 > 상한 → "출근 시간 상한 초과"/"퇴근 시간 상한 초과",
   환승 > 상한 → "출근 환승 상한 초과"/"퇴근 환승 상한 초과". 출근일 0이면 통근 상한 미적용(가정)

상태 우선순위: `route_failed` > `fail` > `unknown` > `pass`. `primary_reason`은 최종 상태를 결정한 범주의 첫 사유다.
(예: 관리비 미확인 + 출근 시간 초과 → `fail`, `primary_reason`="출근 시간 상한 초과", `reasons`=["관리비 미확인으로 월 지출 계산 불가", "출근 시간 상한 초과"])

계산

- `monthly_commute_krw` = (출근 요금 + 퇴근 요금) × 출근일
- `monthly_total_krw` = 월세 + 관리비 + 월 통근비 (하나라도 미확인이면 `null`)
- `initial_cash_krw` = 보증금 + 첫 달 월세 (가정: 중개수수료·이사비 제외)
- `stay_total_krw` = `monthly_total_krw` × `stay_months` (가정: 보증금 전액 반환, 일회성 비용 제외)
- 정렬: `pass`만. `cost`면 (월 지출, 왕복 분, ID), `time`이면 (왕복 분, 월 지출, ID). `rank`는 1부터, 나머지는 `null`.
- `recommended`: 상위 3개 ID.

점수(시안, 미확정 · 0~100 정수, 높을수록 좋음 · 정수화는 반올림, 0.5는 올림)

- `cost`: 월 지출이 계산된 매물끼리 min-max 역정규화. 모두 같으면 100. 계산 불가면 `null`.
- `time`: 왕복 분 기준 같은 방식. 경로 없으면 `null`.
- `convenience`: `max(0, 100 - 20 × (출근 환승 + 퇴근 환승) - 2 × (출근 도보 + 퇴근 도보))`. 경로 없으면 `null`.
- `livability`: 항상 `null` (집 상태·동네 안전 데이터 출처 없음).

응답

```jsonc
{
  "synthetic": true,
  "conditions": { /* 요청 echo, 기본값 채움 */ },
  "assumptions": ["예산과 같으면 통과로 본다", "..."],
  "counts": {"pass": 2, "fail": 8, "unknown": 1, "route_failed": 1},  // 위 기본 요청 기준
  "recommended": ["L01", "L05"],
  "results": [
    {
      "listing_id": "L01", "label": "시연 매물 01", "gu": "관악구", "dong": "신림동",
      "status": "pass",                      // pass | fail | unknown | route_failed
      "primary_reason": null,                // pass면 null
      "reasons": [],
      "rank": 1,
      "management_overridden": false,
      "cost": {
        "deposit_krw": 10000000, "monthly_rent_krw": 500000,
        "monthly_management_krw": 70000, "monthly_commute_krw": 62000,
        "monthly_total_krw": 632000, "initial_cash_krw": 10500000, "stay_total_krw": 7584000
      },
      "commute": {"outbound": {...}, "return": {...}, "round_trip_minutes": 78},
      "scores": {"cost": 90, "time": 60, "convenience": 20, "livability": null}, // 점수 수치는 설명용
      "living_cost": {
        "cash_monthly": {"amount_krw": 672555, "low_krw": 663017, "high_krw": 682694, "estimated_share_pct": 6.03},
        "economic_monthly": {"amount_krw": 739555, "low_krw": 719683, "high_krw": 761361, "estimated_share_pct": 11.57},
        "initial_cash": {"amount_krw": 11004000, "low_krw": 10880000, "high_krw": 11144000, "estimated_share_pct": 2.18},
        "items": [
          {"key": "electricity", "label": "전기", "monthly_krw": 26129, "one_time_krw": 0,
           "low_krw": 19854, "high_krw": 33006, "basis": "가정",
           "note": "사용량·월별 계수·사용량 범위는 가정; 요율 검증 상태 참조", "estimated": true}
          // 실제 응답에는 월세·관리비·공과금·통근·일회성 비용·기회비용 항목을 모두 반환
        ],
        "peak": {"electricity": {"month": 8, "amount_krw": 37267}, "gas": {"month": 1, "amount_krw": 31110}},
        "management_estimated": false,
        "parameter_status": {"gas_krw_per_mj": "검증 필요"} // 실제 응답은 요율표 전체 상태를 그대로 반환
      }
    }
  ]
}
```

`results`는 `listing_id` 오름차순으로 12건 모두 반환한다.

`living_cost`는 **팀 미합의 참고용 시안**이며, `living` 생략 시에도 각 매물에 반환한다.
기존 `cost`, 판정, 순위, 점수, 추천은 그대로이며 예산 판정은 계속 `cost.monthly_total_krw`를 쓴다.
`assumptions`에는 "진짜 월 거주비는 참고용 시안이며 판정·순위에 쓰지 않는다"와 계산 가정을 추가한다.

- 세 합계는 금액·하한·상한(원 정수)과 추정 비중(%, 소수 둘째 자리)을 가진다.
  금액은 항목별 월평균·월할을 0.5원 올림한 뒤 합산한다.
- `living_cost` 블록 자체는 `null`이 아니다. 통근 경로 실패는 통근 항목과 현금·경제 합계의
  네 필드를 모두 `null`로 유지한다. 출근일이 0이어도 경로 미확인은 0원으로 바꾸지 않는다.
- 관리비 미확인은 면적 없는 통계 참고 추정으로 표시(`management_estimated: true`)하며,
  기존 `unknown` 판정·`cost`의 `null`은 유지한다. `management_overrides`는 이 계산에도 반영한다.
- 매물 CSV에 유형·면적·이사 규모가 없어 **주거용 오피스텔(요율 적용요건 충족)·면적 미확인·소형 이사/청소**를
  가정한다. 합성 매물의 실제 속성을 확인한 것이 아니다. 면적 미확인은 면적 없는 관리비 추정표를 선택한다.
- `initial_cash`는 보증금+첫 달 월세+중개보수+이사·청소이며 기존 `cost.initial_cash_krw`와 범위가 다르다.
  `items`의 일회성 항목은 `monthly_krw`가 거주 기간 월할액이고 `one_time_krw`·`low_krw`·`high_krw`는 선납 원금이다.
- `include_economic: false`면 `economic_monthly`의 네 필드를 모두 `null`로 두고 보증금 기회비용 항목을 제외한다.
  현금 월 지출과 초기 현금, 초기 현금에 필요한 중개·이사·청소 항목은 유지한다.
- 중앙·전기 난방이면 `peak.gas`는 `null`이다. 엔진은 가스를 제외하며 별도 난방비는 미확인이므로 합계에 포함하지 않는다.
  관리비 포함 공과금은 중복 계산하지 않고 0원·`관리비 포함`으로 표시한다.
- `parameter_status`는 `extra_cost_params.py`의 상태 문자열을 번역·승격 없이 전달한다.
  근거 등급 `basis`의 `실측`은 엔진 입력값 구분이며, 이 시연의 매물·교통값은 여전히 합성 데이터다.

계산식과 한계: [부대경비 계산식](extra-cost-formula.md).

## POST /api/ask

LLM을 쓰지 않는 **문서 검색 + 규칙 답변**이다. 근거 문서는 매물 CSV에서 생성한 `L01`~`L12`, `COMMON`.

요청: `{"question": "L03 관리비 얼마야?", "listing_id": null}` (`listing_id`는 선택, 화면에서 매물을 고른 상태면 전달)

응답

```jsonc
{
  "synthetic": true,
  "status": "answered",     // answered | unknown(문서에 값 없음) | clarify(어느 매물인지 모호) | out_of_scope(문서에 없는 주제)
  "answer": "L03의 관리비는 확인되지 않았습니다.",
  "citations": [{"doc_id": "L03", "quote": "- 관리비: 확인되지 않음"}],
  "candidates": []           // clarify일 때 후보 매물 ID
}
```

채점 기준: `evaluation/rag_answer_key.csv` (must_include 포함, must_not_include 미포함, 근거 문서 일치).

## POST /api/react

LLM·외부 서비스 없이 문장 키워드로 캐릭터 반응을 고르는 독립 어댑터다.
조건 확인·추천 계산에는 표정과 confidence를 사용하지 않는다.

요청

```json
{
  "request_id": "r-12",
  "message": "월세를 조금 줄이고 싶어",
  "context": {"phase": "input"}
}
```

- `request_id`: 1~64자 문자열. 공백 등을 바꾸지 않고 응답에 그대로 반환한다.
- `message`: 양끝 공백 제거 후 1~500자. 빈 값·공백만·500자 초과는 `422`다.
- `context`: 선택. 전달하면 `phase`는 `input | confirm | result` 중 하나다.
- 입력은 텍스트 데이터로만 처리하며 명령으로 실행하지 않는다. 전체 대화·키·토큰은 필요하지 않다.

응답

```json
{
  "synthetic": true,
  "assumptions": ["표정은 규칙 기반 키워드 판단이며 추천 계산에 쓰지 않는다"],
  "request_id": "r-12",
  "expression_id": "empathetic",
  "confidence": 0.8,
  "intent": "save_cost",
  "engine": "rule-based-v0"
}
```

- `expression_id`: `neutral | listening | thinking | happy | empathetic | concerned | surprised | apologetic`.
- `intent`: `save_cost | shorten_commute | set_condition | greeting | thanks | question | complaint | unknown`.
- confidence는 `0.0~1.0`의 규칙 분류 확신도이며 표정 강도가 아니다.
- 비용 절약·부정 감정에는 공감, 조건 설정·통근 단축에는 듣기, 감사·인사에는 기쁨, 질문에는 생각 반응을 낸다.
  판단 불가이면 `neutral`, `unknown`, confidence `0.2`다. 사용자를 비웃거나 평가하는 표정은 없다.
- 응답의 `request_id`가 화면의 최신 요청과 다르면 화면에서 버린다.

## POST /api/conditions/parse

한국어 문장을 비교 조건 **후보와 보완 질문**으로 바꾸는 규칙 기반 어댑터다.
사용자 확인 전에 `/api/compare` 조건을 적용하거나 저장하지 않으며, `/api/react`와 독립적으로 동작한다.

요청

```json
{
  "message": "월세 60 이하, 40분 안쪽",
  "current": {"office_days": 20}
}
```

- `message`: 양끝 공백 제거 후 1~500자. 빈 값·공백만·500자 초과는 `422`다.
- `current`: 선택. `/api/compare`와 같은 필드명·값 형식의 전체 또는 일부 조건이다.
  생략한 필드에는 기본값을 채우지 않는다. 동일한 현재 값은 후보에서 제외한다.
  `current` 자체의 잘못된 범위·자료형·알 수 없는 필드는 `422`다.
- 문장 속 범위 위반·잘못된 날짜·서로 다른 값은 후보 대신 이유가 있는 질문으로 돌려준다.

응답

```json
{
  "synthetic": true,
  "assumptions": [
    "조건은 LLM 없는 한국어 규칙으로 해석한 후보이며 사용자 확인 전에는 적용하지 않는다",
    "월 지출 한도는 월세+관리비+통근비 합계이며 단위 없는 금액은 만 원으로 읽는다",
    "연도 없는 날짜는 서버 기준일 이후 가장 가까운 날짜, 주 출근일은 round(주 일수*52/12)로 읽는다"
  ],
  "candidates": [
    {
      "field": "monthly_budget_krw",
      "value": 600000,
      "display": "월 지출 한도 600,000원",
      "source_text": "월세 60 이하",
      "needs_confirmation": true,
      "note": "단위 없는 금액을 만 원 단위로 읽었습니다. 월 지출 한도는 월세+관리비+통근비 합계입니다. 월세만의 금액과 합계 한도는 다르므로 확인해 주세요."
    },
    {
      "field": "max_one_way_minutes",
      "value": 40,
      "display": "편도 통근 상한 40분",
      "source_text": "40분 안쪽",
      "needs_confirmation": false,
      "note": null
    }
  ],
  "questions": [],
  "understood": true
}
```

대상 필드와 해석

| 필드 | 해석과 유효 범위 |
| --- | --- |
| `deposit_limit_krw` | `보증금 N`. `천만`, `1천만`, `1000만`, `1억` 등 원 단위 0 이상 정수. |
| `monthly_budget_krw` | `월세 N`, `월 예산 N`, `한 달 N`, `월 N`. 원 단위 0 이상 정수. |
| `max_one_way_minutes` | `40분 이내/안쪽/이하/까지`, `편도 40분`. 1 이상 정수. |
| `max_transfers` | `환승 1번/1회 이하`, `환승 없이/직통`은 0. 0 이상 정수. |
| `office_days` | `월 20일 출근`은 20, `주 5일 출근`은 `round(5*52/12)=22`. 월 0~31일 정수. |
| `move_in_by` | `2026-11-01`, `11월 1일 입주`, `11/1`. 존재하는 날짜를 `YYYY-MM-DD`로 반환. |
| `stay_months` | `1년`, `12개월`, `2년 살` 등 1~60개월 정수. |
| `priority` | `통근/시간 우선`, `빨리`는 `time`; `싸게`, `비용/돈 우선`, `저렴`은 `cost`. |

- 단위 없는 `60 이하` 등은 만 원으로 읽고 확인을 요구한다. 대상 없는 금액도 월 지출 한도 후보로 읽고 확인을 요구한다.
- 금액·통근 시간·환승의 숫자 뒤에 `이상`·`초과`·`안 돼`·`싫어` 등 반대 방향이나 부정 표현이 있으면
  상한 후보를 만들지 않고 해당 필드의 확인 질문을 반환한다. 다른 필드의 유효한 후보는 유지한다.
- 월세라고 말해도 후보 필드는 월세+관리비+통근비 합계인 `monthly_budget_krw`다.
  월세만의 금액과 다르다는 `note`와 `needs_confirmation: true`를 항상 포함한다.
- 주 출근일 환산은 확인과 환산식 안내를 포함한다. `재택`·`출근 안 함`은 월 출근일 0일 후보와 확인 안내를 낸다.
- 연도 없는 날짜는 서버 기준일(기본 `date.today()`) 당일을 포함해 가장 가까운 미래 날짜로 읽고 확인을 요구한다.
  명시한 연도는 그대로 쓴다. 엔진 함수의 `reference_date` 인자로 기준일을 주입할 수 있다.
- `월세를 조금 줄이고 싶어`는 금액을 만들지 않고 `monthly_budget_krw` 질문 1개만,
  `더 가까웠으면`은 `max_one_way_minutes` 질문만 낸다.
- `questions` 항목은 `{"field": "monthly_budget_krw", "question": "...", "options": []}` 형식이다.
  후보나 질문이 하나라도 있으면 `understood: true`; 모두 없으면 `false`다.
