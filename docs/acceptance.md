# 수용 테스트 근거표 (AT01~AT10)

근거 명세: `REALRENT_기능명세서_2026-10-21_v0.1` 11장(검토용, 팀 합의 전). 계약 요약은 [chat-character.md](chat-character.md).
**이 표의 ‘통과’는 이번 실행에서 실제로 돌려 본 것만이다.** 돌리지 않은 것은 ‘미확인’으로 남겼다.
모든 매물·가격은 합성 시연 데이터이고, 의미 판단은 규칙 기반(LLM 없음)이다.

실행 환경(이번 실행, D6 통합 후): Windows 11, 당시 로컬 브랜치(D1·D3·D4·D5 반영 + D6 상세 화면 수정, 커밋 전), 백엔드 `127.0.0.1:8026`, 화면 `127.0.0.1:5196`(`API_PROXY_TARGET`), 당시 이미지 스킨(기본), 헤드리스 Chromium 계열 155. 2026-10-22 01:2x(KST).
증거 폴더(미추적, 커밋하지 않음): 이번 실행 `.playwright-mcp/d6-polish/`, 이전 실행(D5) `.playwright-mcp/d5-qa/`.

## 요약

| 항목 | 이번 실행 결과 | 자동/수동 |
|---|---|---|
| AT01 한국어 입력·조합 | **부분 통과** — IME 조합 *모의*는 통과, 실제 한글 IME 수동 시험은 **미확인** | 자동(모의) + 수동 미확인 |
| AT02 연속 전송·역순 응답 | 통과 | 자동 |
| AT03 모호한 조건 | 통과 | 자동 |
| AT04 의미 판단 실패 후 복구 | 통과 | 자동 |
| AT05 동적인 표정 | **부분 통과** — 속성·값 변화로 확인, 움직임의 보기 좋음(자연스러움)은 사람 확인 **미확인** | 자동 + 수동 미확인 |
| AT06 표정과 계산 분리 | 통과 | 자동 |
| AT07 설명 수치 = API | 통과(숫자 전수 대조는 check-chat) | 자동 |
| AT08 결과 없음 vs 서버 오류 | 통과 | 자동 |
| AT09 에셋 오류·접근성 | **부분 통과** — 이미지 차단·모션 감소 통과, 스크린리더 실기 **미확인** | 자동 + 수동 미확인 |
| AT10 에셋 이용 기록 | **완료 아님 (미확인 권리 있음)** | 문서 확인 |

## 이번에 실제로 실행한 검사 (D6, 통합 후)

| 명령 (저장소 루트 기준) | 결과 | 기록 |
|---|---|---|
| `cd frontend; node scripts/check-chat.ts` | 26개 PASS, FAIL 0, “모두 통과” | 터미널 출력 |
| `cd frontend; node scripts/acceptance-probe.mjs --base http://127.0.0.1:5196 --out ../.playwright-mcp/d6-polish/acc` | AT01·03~09 확인 8건 PASS(AT02는 아래 지연 측정·check-chat이 근거) | `d6-polish/acc/acceptance-probe.json`, `shots/*.png` |
| `cd frontend; node scripts/measure-latency.mjs --base http://127.0.0.1:5196 --n 30 --out ../.playwright-mcp/d6-polish/latency` | 오류 0/30, 역순 응답 10/10, 시간 초과 복구 3/3 | [latency.md](latency.md), `d6-polish/latency/latency-result.json` |
| `cd backend; uv run python -m pytest -q` | 365 passed, 1 warning | 터미널 출력 |
| `cd backend; uv run ruff check app tests` | All checks passed | 터미널 출력 |
| `cd frontend; npm run lint` / `npm run build` | 종료 코드 0 / 빌드 성공 | 터미널 출력 |
| 상세 화면 스크린샷(L01) 1280·375, 375 `scrollWidth` | 375px에서 `scrollWidth` 375(가로 넘침 없음), 1280px 1280 | `d6-polish/L01-detail-1280.png`, `L01-detail-375.png` |

### 이전 실행 (D5, 통합 전)

check-chat 24개 PASS, probe 8건 PASS, 지연 측정 오류 0/30·역순 10/10·복구 3/3, pytest 365 passed, ruff·lint·build 통과. 증거: `.playwright-mcp/d5-qa/`. 당시 화면은 D1(디자인)·D2(`living_cost`)가 진행 중인 작업 트리였다.

`acceptance-probe.mjs`는 `package.json`을 바꾸지 않고 npx 캐시의 playwright-core를 쓴다.

## 항목별 근거

### AT01 한국어 입력·조합 — 부분 통과

- **확인 방법**: (자동) `acceptance-probe.mjs`의 AT01 — CDP `Input.imeSetComposition`으로 ‘ㅇ→아→안→안ㄴ→안녀→안녕’ 조합을 보내고, 조합 중 Enter를 실제 IME와 같은 `key=Process, keyCode=229`로 보낸다. 그 뒤 `Input.insertText`로 확정한다. (코드) `ChatPanel.tsx`의 `onKeyDown`이 `composing`·`isComposing`·`keyCode 229`면 전송하지 않는다. (수동) 한글 IME로 “월세 육십만원” 입력 시 글자 손실·커서 이동·조합 중 전송이 없는지 사람이 본다.
- **이번 결과**: 자동 모의 통과 — `/api/react` 요청 0건, 대화 기록 인사 1건 그대로, 입력값 “안녕”, 캐릭터 `data-state="listening"`(서버와 독립). 근거: `acceptance-probe.json`의 AT01, `shots/at01-ime.png`. 입력→로컬 반응 중앙값 5.3 ms ([latency.md](latency.md)).
- **미확인**: 실제 한글 IME로 직접 타자한 시험은 하지 않았다. CDP 모의에서 일반 Enter(`keyCode 13`)를 조합 중에 보내면 브라우저의 암묵적 폼 제출이 일어나 `/api/react`가 1회 나갔다. 실제 IME는 229를 보내므로 해당하지 않을 가능성이 높지만 **실기로 확인한 것은 아니다**.

### AT02 연속 전송·역순 응답 — 통과

- **확인 방법**: (자동) `check-chat.ts`의 “AT02 역순 응답 무시: r-1 응답이 r-2 뒤에 와도 버린다”, “오래된 응답(AT02)은 표정 유지 시각도 바꾸지 않는다”. (브라우저) `measure-latency.mjs`의 역순 응답 검사 — 첫 요청만 1초 지연해 응답을 뒤집는다.
- **이번 결과**: check-chat 2건 PASS. 브라우저 10/10 — 늦게 온 A 응답이 표정을 덮지 않았고 A의 조건 카드도 나타나지 않았다.
- **근거**: `check-chat.txt`, `latency-result.json`의 `stale`, [latency.md](latency.md).

### AT03 모호한 조건 — 통과

- **확인 방법**: (자동) `acceptance-probe.mjs`의 AT03 — `/api/conditions/parse`에 “월세를 조금 줄이고 싶어”(숫자 없음), “월세 60 이하”(단위 없음)를 보낸다. 화면에서는 확인 카드의 “확인 필요” 칩. (`check-chat.ts`) “숫자 없는 의도: 질문만 말풍선, 수치 자동 채움 없음”.
- **이번 결과**: 숫자 없는 입력 → 후보 0, 질문 1 / 단위 없는 금액 → `needs_confirmation: true`, 화면에 “확인 필요” 1개. 사용자가 반영을 누르기 전에는 폼 값이 바뀌지 않는다(check-chat “취소 시 조건 불변”).
- **근거**: `acceptance-probe.json`, `shots/at03-ambiguous.png`.

### AT04 의미 판단 실패 후 복구·비교 계속 — 통과

- **확인 방법**: (자동) `check-chat.ts` “react 실패 → neutral 복구, 조건 확인은 계속, 재전송 가능”, “enum 밖/잘못된 값 → neutral”. (브라우저) probe AT04 — `/api/react`를 연결 끊김으로 막고 조건 입력→반영→비교. `measure-latency.mjs`의 시간 초과 복구(2.2초 지연 → 표정 `neutral`, 조건 카드 표시).
- **이번 결과**: 모두 통과. 표정 요청이 실패해도 비교 결과가 `result` 상태로 끝났다.
- **근거**: `acceptance-probe.json`, `shots/at04-react-failed.png`, `latency-result.json`의 `react_timeout`.

### AT05 동적인 표정 — 부분 통과

- **확인 방법**: (자동) probe AT05 — 대기 중 12회 표본(150 ms 간격)에서 캐릭터 SVG 값이 바뀌는지, 전송 후 `reacting`, 반응 중 새 입력 시 새 표정(`happy`) 반영. (`check-chat.ts`) 반응 표정 3초 유지·1초 이내 끊김 금지·타이핑 시 `listening`. (수동) 움직임이 어색하지 않은지 사람 눈으로 본다.
- **이번 결과**: 대기 표본의 서로 다른 값 2개(미세 움직임 있음), 의미 표정 `listening`(`reacting` 상태) → 새 입력 후 `happy`. 근거: `acceptance-probe.json`, `shots/at05-reacting.png`, `shots/at05-new-expression.png`.
- **미확인**: 정지 스크린샷으로는 부드러움·어색함을 판단할 수 없다. 영상·실시간 확인은 하지 않았다.

### AT06 표정과 계산 분리 — 통과

- **확인 방법**: (자동) probe AT06 — 같은 조건(월 예산 90만 원, 60분)으로 `/api/react` 응답이 정상 / 연결 끊김 / `concerned`로 강제된 세 경우의 `/api/compare` 응답 본문을 비교한다.
- **이번 결과**: 요청 본문 3개 동일, 응답 본문 3개 문자열 완전 일치(52,586 바이트). 코드 구조상 `/api/compare` 요청에는 표정 값이 들어가지 않는다(`CompareRequest`에 표정 필드 없음).
- **근거**: `acceptance-probe.json`의 AT06.

### AT07 설명 수치 = API · 합성/미확인 구별 — 통과

- **확인 방법**: (자동) `check-chat.ts` “AT07 설명의 모든 숫자가 응답 값(또는 응답 값끼리의 차이/순위)과 일치”. (브라우저) probe AT07 — 화면 말풍선의 1위 매물명이 `/api/compare` 1위와 같고 “합성 시연 데이터” 고지가 있는지.
- **이번 결과**: 둘 다 통과. 예: 1위 “시연 매물 01: 월 지출 632,000원, 왕복 78분”, 문장 끝 “합성 시연 데이터 기준이에요. 실제 매물·가격이 아니에요.” 미확인 값은 “미확인”으로 표시(`explain.ts`의 `UNCONFIRMED`).
- **한계**: 브라우저 쪽 검사는 매물명·고지만 대조한다. 숫자 전수 대조는 check-chat(함수 단위)이 맡는다.
- **근거**: `check-chat.txt`, `acceptance-probe.json`, `shots/at07-result-explain.png`.

### AT08 결과 없음 vs 서버 오류 — 통과

- **확인 방법**: (자동) `check-chat.ts` “AT08 pass 0건 문장 ≠ 서버 오류 문장”, “결과 표정/상태: pass→happy, none→empathetic, error→apologetic”. (브라우저) probe AT08 — 월세 10만 원 이하(통과 0건)와 `/api/compare`를 HTTP 500으로 바꾼 경우의 마지막 말풍선을 비교.
- **이번 결과**: 결과 없음 → “조건에 맞는 매물이 없어요 … 주요 탈락 사유 …”, 서버 오류 → “서버 오류로 비교 결과를 받지 못했어 … 조건에 맞는 매물이 없다는 뜻은 아니야”. 서로 다르고 오류 쪽 표정은 `error`.
- **근거**: `acceptance-probe.json`, `shots/at08-no-result.png`, `shots/at08-server-error.png`.

### AT09 에셋 오류·접근성 — 부분 통과

- **확인 방법**: (자동) probe AT09 — `/skins/**` 이미지 요청을 막고 `prefers-reduced-motion: reduce`로 조건 입력→비교. 결과 말풍선, `data-reduced-motion`, 캐릭터 `aria-label`, 600 ms 뒤 캐릭터 DOM 정지 여부를 본다. (코드) `ChatPanel.tsx`의 `CharacterBoundary` 대체 영역(`role="img"` + `aria-label`).
- **이번 결과**: 이미지가 막혀도 결과 말풍선(통과 5건·1위 설명)이 읽혔고, 캐릭터는 대체 표시(스크린샷상 렌티 모양)로 나왔다. `data-reduced-motion="true"`, `aria-label` 유지, 600 ms 동안 캐릭터 DOM 변화 없음.
- **미확인**: 스크린리더(NVDA 등)로 `role="log"`·`aria-live` 낭독을 실제로 들어 보지 않았다. 색 대비 수치 측정도 하지 않았다(D1 디자인 변경 중).
- **근거**: `acceptance-probe.json`, `shots/at09-assets-blocked-reduced-motion.png`.

### AT10 에셋 이용 기록 — **완료 아님**

- **확인 방법**: (문서) [assets/character-asset-log.md](assets/character-asset-log.md)에 출처·제작 도구·이용 조건·공개 범위·미확인 권리가 있는지, 화면에 쓰이는 모든 캐릭터 에셋이 그 기록에 있는지.
- **이번 결과 (정확한 현재 상태)**:
  - **렌티**(자체 제작 SVG): 기록 있음. 출처·도구·공개 범위(과제 내부 시연까지)가 적혀 있고, **AI 결과물의 저작권 귀속·기존 캐릭터와의 유사성 검토는 하지 않았다고 ‘미확인 권리’에 명시**돼 있다.
  - **보금이**(오리지널 마스코트, AI 생성 이미지 7장 `frontend/public/skins/bogeum/*.png`): 기존 캐릭터 이미지를 참조하지 않고 오리지널 설정으로 Codex 내장 이미지 생성을 써서 2026-10-22에 생성했다. **생성 도구 이용약관상 권리 귀속은 확인 필요**로 남아 있다. `character-asset-log.md`에 항목이 있다. 이전의 기존 캐릭터풍 스킨은 이 브랜치에서 제거했다.
- **결론**: 렌티와 보금이 모두 기록은 있으나 권리 귀속(AI 생성 도구 이용약관·유사성 검토)이 미확인이므로 AT10은 **‘완료 아님(권리 미확인)’을 유지한다.** 팀 공개·배포 전에 두 캐릭터의 권리 귀속을 팀이 확인해야 한다.

## 남은 수동 확인 목록

1. 실제 한글 IME 타자 시험(AT01).
2. 캐릭터 움직임·표정 전환의 자연스러움을 영상 또는 실시간으로 확인(AT05).
3. 스크린리더 낭독·색 대비(AT09).
4. (완료) 통합 후 자동 검사 재실행 — 위 D6 표. 이후 코드가 바뀌면 다시 돌린다.
5. 보금이·렌티 권리 확인(AT10, 팀 결정). 기록 파일에 두 캐릭터 항목이 있다.
