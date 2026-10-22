# 대화형 입력 + 캐릭터 표정 — 구현 계약 (시안)

근거: 사용자 작성 `REALRENT_기능명세서_2026-10-21_v0.1` (검토용, 팀 합의 전). 이 문서는 그 명세를
**현재 브랜치(`/api/listings`, `/api/compare`, 합성 매물 12건)** 위에 붙이기 위한 계약이다.
명세가 인용한 팀 PR 5(`/api/demo/catalog`, 매물 4건)와는 다른 기준선이다.

## 결정(이번 구현의 가정 — 팀 결정 아님)

| 명세의 미정 항목 | 이번 구현의 가정 |
|---|---|
| 캐릭터·렌더러(팀 브랜치 기준) | **자체 제작 SVG 캐릭터 "렌티"**를 코드로 그리고 파라미터(눈·눈썹·입·고개·시선)를 매 프레임 보간한다. 유명 캐릭터·외부 이미지·Live2D 모델은 쓰지 않는다(권리 미확인 회피). 팀에 올리는 브랜치(예: `xoxo787/feat-real-rent-product`, 4ded2c7)는 렌티만 쓴다. |
| 캐릭터 스킨 | 쿼리 없이 열면 기본 캐릭터는 팀 오리지널 마스코트 **보금이**(집 구하러 다니는 작은 토끼, 왼쪽 귀가 접힌 롭이어, 황동 집 열쇠 목걸이. 반말. PNG 7장 `frontend/public/skins/bogeum/*.png`, AI 생성 시안). 말 사전은 `콩!`(확인)·`콩콩!`(반영)·`갸웃?`(질문)·`엥엥?`(이해 못 함)·`총총총!`(비교 중)·`짠!`(통과)·`으앗..`(없음)·`으아앙..`(서버 오류)·`흐흥~`(취소)이고, 형식은 “감탄사 (뜻)”이다. `?skin=renti`로 열면 존댓말 렌티. 보금이 이미지를 하나라도 불러오지 못하면 자동으로 렌티로 대체한다. 판별은 `frontend/src/lib/persona.ts`의 `personaIdFromSearch` 한 곳. 판별은 `frontend/src/lib/persona.ts`의 `personaIdFromSearch` 한 곳. 출처·이용 조건은 [에셋 기록](assets/character-asset-log.md). |
| 의미 판단(Jev 등) | **LLM 없는 규칙 기반 어댑터**. 같은 응답 계약을 지키므로 나중에 모델로 교체 가능. 비밀 키 없음. |
| 입력 중 의미 분석 | **하지 않는다**(명세의 선택 기능). 입력 중에는 로컬 듣기 반응만. |
| 표정 사전 | 아래 8개 enum. 비웃음·평가 표정 없음. |

## 계층과 책임

```text
[입력창] ──키 입력──▶ 로컬 듣기 반응 (서버 무관, IME 조합 중 요청 없음)
   │ 전송(requestId)
   ├──▶ POST /api/react ─────▶ expression_id + confidence ─▶ [표현 계층: 캐릭터]
   └──▶ POST /api/conditions/parse ─▶ 조건 후보·보완 질문 ─▶ [대화 계층: 확인 카드]
                                              │ 사용자 확인
                                              ▼
                                  POST /api/compare (기존, 변경 없음) ─▶ [결과 설명]
```

세 계층은 독립적으로 실패한다. `/api/react`가 실패해도 조건 확인·비교는 계속된다.

## POST /api/react (신규)

요청 `{"request_id": "r-12", "message": "월세를 조금 줄이고 싶어", "context": {"phase": "input"}}`

- `request_id`: 1~64자, 화면이 만든 식별자. 응답에 그대로 돌려준다.
- `message`: 공백 제거 후 1~500자. 빈 값은 422.
- `context`: 선택. `phase` ∈ `input | confirm | result`. 대화 원문 전체는 보내지 않는다.

응답

```jsonc
{
  "synthetic": true,
  "assumptions": ["표정은 규칙 기반 키워드 판단이며 추천 계산에 쓰지 않는다"],
  "request_id": "r-12",
  "expression_id": "empathetic",   // 아래 enum만
  "confidence": 0.8,               // 0.0~1.0, 의미 분류 확신도. 표정 강도가 아니다
  "intent": "save_cost",           // 아래 enum만
  "engine": "rule-based-v0"
}
```

- `expression_id` ∈ `neutral, listening, thinking, happy, empathetic, concerned, surprised, apologetic`
- `intent` ∈ `save_cost, shorten_commute, set_condition, greeting, thanks, question, complaint, unknown`
- 판단 불가 → `neutral`, `unknown`, confidence ≤ 0.3. 사용자를 비웃거나 평가하는 반응 금지.

## POST /api/conditions/parse (신규)

요청 `{"message": "월세 60 이하, 40분 안쪽", "current": { /* CompareRequest 와 같은 필드, 선택 */ }}`

응답

```jsonc
{
  "synthetic": true,
  "assumptions": ["..."],
  "candidates": [
    {
      "field": "monthly_budget_krw",       // CompareRequest 필드명 중 하나
      "value": 600000,                     // 그 필드 타입 그대로
      "display": "월 지출 한도 60만 원",
      "source_text": "월세 60 이하",
      "needs_confirmation": true,
      "note": "‘60’을 만 원 단위로 읽었습니다. 월 지출 한도는 월세+관리비+통근비 합계입니다."
    }
  ],
  "questions": [                           // 값을 정하지 못한 항목. 임의로 채우지 않는다
    {"field": "monthly_budget_krw", "question": "월 지출 한도를 얼마로 할까요?", "options": []}
  ],
  "understood": true                       // 조건 후보나 질문이 하나라도 있으면 true
}
```

- 대상 필드: `deposit_limit_krw, monthly_budget_krw, move_in_by, office_days, max_one_way_minutes, max_transfers, priority, stay_months`.
- 단위 없는 금액·“주 N일”·연도 없는 날짜처럼 해석이 필요한 값은 `needs_confirmation: true`와 `note`.
- 숫자 없는 의도(“월세를 조금 줄이고 싶어”)는 후보를 만들지 않고 `questions`만 낸다.
- `current`와 같은 값은 후보에서 뺀다.
- 해석 실패 → `candidates: [], questions: [], understood: false`. 원문은 화면이 보존한다.

## 화면 상태 모델

`idle → listening → thinking → reacting → idle`, 별도로 `comparing · result · error`.

- 전송마다 새 `request_id`. 응답의 `request_id`가 최신이 아니면 **버린다**(표정·조건·결과 모두).
- `/api/react` 1.5초 초과·오류·enum 밖 값 → `neutral`로 복구, 비교 기능은 계속. 조건 해석(`/api/conditions/parse`) 완료를 기다리지 않고 바로 복구한다.
- 입력과 비교 시작에 함께 순번을 매긴다. 비교 중이거나 그 입력보다 나중에 시작한 비교가 있으면, 늦게 온 그 입력의 `/api/react` 응답(성공·실패)은 비교·결과 표정을 바꾸지 않는다. 결과 표정은 다음 입력까지 유지한다.
- 표정 강도(intensity)는 표정별 기본값 표에서 정한다. confidence < 0.5면 `neutral`. **confidence를 강도로 쓰지 않는다.**
- 비교 결과가 오기 전에는 “찾았다” 류 문장을 쓰지 않는다.
- 결과 설명 문장의 모든 숫자는 `/api/compare` 응답 필드에서 가져온다. 미확인 값은 “미확인”.

## 캐릭터 컴포넌트 계약

```ts
// frontend/src/components/character/index.ts 에서 export
export type ExpressionId = 'neutral' | 'listening' | 'thinking' | 'happy' | 'empathetic' | 'concerned' | 'surprised' | 'apologetic'
export type CharacterState = 'idle' | 'listening' | 'thinking' | 'reacting' | 'comparing' | 'result' | 'error'
export const EXPRESSIONS: readonly ExpressionId[]
export const DEFAULT_INTENSITY: Record<ExpressionId, number> // 0..1
export function Character(props: {
  state: CharacterState
  expression: ExpressionId
  intensity?: number        // 0..1, 기본 DEFAULT_INTENSITY[expression]
  typingPulse?: number      // 키 입력마다 1씩 증가하는 카운터 → 미세한 끄덕임·시선
  reducedMotion?: boolean   // 미지정이면 prefers-reduced-motion을 따름
  label?: string            // 화면 낭독용 상태 문장
}): JSX.Element
```

## 에셋 기록

[`docs/assets/character-asset-log.md`](assets/character-asset-log.md) — 렌티(자체 코드 작성)와 보금이(오리지널 설정, AI 생성 이미지)의 출처, 제작 도구, 이용 조건, 공개 범위, 미확인 권리.
