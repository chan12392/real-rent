# REAL RENT 서버 엔진·API 검증

- 작업: task_c21f69e002e8 / ctx_31bb98a83303
- 브랜치: xoxo787/feat-real-rent-product (전환·커밋·푸시·PR 없음)
- 수정 범위: backend/**만. docs/api.md·데이터·평가 CSV는 읽기 전용으로 사용.
- 실행 환경: Windows, CPython 3.12.12, uv 0.9.28.
- 의존성 추가 없음; 기존 uv.lock으로 uv sync --frozen 실행.

## 합격 기준 (expected / observed / passed)

| 검사 | expected | observed | passed |
| --- | --- | --- | --- |
| backend: uv run ruff check app tests | 종료 0, 오류 0 | 종료 0, All checks passed! | true |
| backend: uv run python -m pytest | 전체 통과 | 종료 0, 78 passed, 1 warning, 0.74s | true |
| 참고 계산 이식 | 손계산 기대값 14개 통과 | tests/test_calc.py 14 passed | true |
| API·입력 검증 | 기본 조건·덮어쓰기·422·RAG 포함 | tests/test_api.py 50 passed | true |
| RAG 답안지 | 13/13, Q13 clarify, 근거 인용 일치 | 13/13, L08·L09 후보 확인 | true |
| 추가 경계 사례 | 상태 우선순위·전 사유·0일·점수·환경 경로 | tests/test_engine.py 11 passed | true |
| 기존 health·CORS | 기존 계약 보존 | tests/test_health.py 3 passed | true |
| Python 구문 검사 | compileall 종료 0 | uv run python -m compileall -q app tests 종료 0 | true |
| 포맷 검사 | 변경한 Python 파일 포맷 일치 | ruff format --check, 13 files already formatted | true |
| 소스 보안·차이 검사 | 비밀값 패턴·공백 오류 없음 | 소스 패턴 일치 파일 0, git diff --check 종료 0 | true |
| 실제 Uvicorn POST /api/compare | HTTP 200, counts 2/8/1/1, 추천 L01·L05 | HTTP 200, 아래 JSON, 12건 | true |
| 실제 Uvicorn POST /api/ask | HTTP 200, unknown, L03 인용, 0원 문구 없음 | HTTP 200, 아래 JSON | true |
| 검증 서버 정리 | 이번에 시작한 프로세스만 종료 | Popen으로 생성한 PID 종료 확인 | true |

합성 자료에 대한 로컬 검증이다. 외부 API·LLM·유료 서비스는 호출하지 않았다.
테스트 경고는 기존 Starlette TestClient의 httpx 사용 중단 예고 1건이며 테스트 실패는 없다.
독립 타입 검사·커버리지 측정 도구는 프로젝트에 설정되어 있지 않아 실행하지 않았다.

## 조정자에게 확인한 규약

- 문서 응답 예시와 실제 CSV 계산이 다르면 계산 규칙·CSV 손계산을 우선한다.
- health는 기존 응답 유지. 나머지 새 API에 synthetic과 assumptions를 포함한다.
- primary_reason은 최종 status를 결정한 범주의 첫 사유; reasons는 판정 순서대로 전부 반환한다.
- Q03은 '확인되지 않음'을 명시하고 금지 문자열 '0원'을 답변에 넣지 않는다.
- 점수 정수화는 반올림(0.5 올림). 62.5 → 63 경계를 별도 테스트했다.

## 실제 HTTP 응답

- 검증 시각 (UTC): 2026-10-20T17:32:10.572463+00:00
- 서버: `python -m uvicorn app.main:app --host 127.0.0.1 --port 3082`
- 기존 서버·사용자 포트는 변경하지 않고 OS가 배정한 별도 포트를 사용했다.

### POST /api/compare 기본 요청

```json
{
  "deposit_limit_krw": 10000000,
  "monthly_budget_krw": 750000,
  "move_in_by": "2026-11-01",
  "office_days": 20,
  "max_one_way_minutes": 40,
  "max_transfers": 1,
  "priority": "cost"
}
```
### POST /api/compare 실제 응답 발췌

```json
{
  "synthetic": true,
  "conditions": {
    "deposit_limit_krw": 10000000,
    "monthly_budget_krw": 750000,
    "move_in_by": "2026-11-01",
    "office_days": 20,
    "max_one_way_minutes": 40,
    "max_transfers": 1,
    "priority": "cost",
    "stay_months": 12,
    "management_overrides": {}
  },
  "assumptions": [
    "예산과 같으면 통과로 본다.",
    "월 출근일수가 0이면 통근 시간·환승 상한을 적용하지 않는다.",
    "초기 현금은 보증금과 첫 달 월세의 합이며 중개수수료·이사비 등 일회성 비용은 제외한다.",
    "거주 기간 지출은 보증금 전액 반환을 가정하며 보증금과 일회성 비용은 제외한다.",
    "점수는 미확정 시안이며 거주성은 집 상태·동네 안전 데이터 출처가 없어 평가하지 않는다.",
    "매물·가격·좌표·교통 값은 합성 데이터이며 실거래·실제 경로를 조회하지 않았다.",
    "별도 공과금·정기권 할인·시간의 금전 환산은 월 지출에서 제외한다."
  ],
  "counts": {
    "pass": 2,
    "fail": 8,
    "unknown": 1,
    "route_failed": 1
  },
  "recommended": [
    "L01",
    "L05"
  ],
  "results_count": 12,
  "L01": {
    "listing_id": "L01",
    "label": "시연 매물 01",
    "gu": "관악구",
    "dong": "신림동",
    "status": "pass",
    "primary_reason": null,
    "reasons": [],
    "rank": 1,
    "management_overridden": false,
    "cost": {
      "deposit_krw": 10000000,
      "monthly_rent_krw": 500000,
      "monthly_management_krw": 70000,
      "monthly_commute_krw": 62000,
      "monthly_total_krw": 632000,
      "initial_cash_krw": 10500000,
      "stay_total_krw": 7584000
    },
    "commute": {
      "outbound": {
        "minutes": 38,
        "fare_krw": 1550,
        "transfers": 1,
        "walk_minutes": 10
      },
      "return": {
        "minutes": 40,
        "fare_krw": 1550,
        "transfers": 1,
        "walk_minutes": 10
      },
      "round_trip_minutes": 78
    },
    "scores": {
      "cost": 72,
      "time": 15,
      "convenience": 20,
      "livability": null
    }
  }
}
```
### POST /api/ask: L03 관리비 얼마야? 실제 응답

```json
{
  "synthetic": true,
  "assumptions": [
    "예산과 같으면 통과로 본다.",
    "월 출근일수가 0이면 통근 시간·환승 상한을 적용하지 않는다.",
    "초기 현금은 보증금과 첫 달 월세의 합이며 중개수수료·이사비 등 일회성 비용은 제외한다.",
    "거주 기간 지출은 보증금 전액 반환을 가정하며 보증금과 일회성 비용은 제외한다.",
    "점수는 미확정 시안이며 거주성은 집 상태·동네 안전 데이터 출처가 없어 평가하지 않는다.",
    "매물·가격·좌표·교통 값은 합성 데이터이며 실거래·실제 경로를 조회하지 않았다.",
    "별도 공과금·정기권 할인·시간의 금전 환산은 월 지출에서 제외한다."
  ],
  "status": "unknown",
  "answer": "L03 관리비: 확인되지 않음",
  "citations": [
    {
      "doc_id": "L03",
      "quote": "- 관리비: 확인되지 않음"
    }
  ],
  "candidates": []
}
```

## 수정 파일과 남은 범위

- app/engine/: 불변 입력 모델, CSV 로더, 순수 계산·판정·정렬·점수, 메모리 근거 문서, 2-gram TF-IDF 검색, 규칙 답변.
- app/api/listings.py, app/api/schemas.py, app/main.py: 라우터 등록, 요청·응답 Pydantic 검증.
- tests/test_calc.py, tests/test_engine.py, tests/test_api.py: 손계산·경계·API·13문항 회귀 검증.
- README.md, app/engine/README.md: 실행·엔드포인트·가정·데이터 위치 안내.
- 이 검증 보고서.

합성 CSV 기준 구현과 서버 검증은 완료했다. 실제 매물·실거래·외부 교통 조회, DB, LLM 기능은 구현하지 않았다.
프런트엔드 통합과 커밋·푸시·PR은 메인 조정자 담당이다. 별도 외부 게시나 병합은 수행하지 않았다.
