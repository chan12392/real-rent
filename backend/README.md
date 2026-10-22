# 서버 · 개발 2 / AI · 개발 3

Python 3.12와 uv를 사용한다. 합성 매물 CSV를 읽어 비용·조건 비교와 근거 답변을 제공한다.
계산은 순수 함수이며, 답변은 메모리 문서 검색과 규칙으로 생성한다. LLM·외부 API는 사용하지 않는다.

## 실행

저장소 루트에서 작업 브랜치를 먼저 만든다.
이미 `.env`가 있으면 복사 단계를 건너뛰어 기존 설정을 보존한다.

```powershell
cd backend
uv sync --frozen
Copy-Item .env.example .env
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 --env-file .env
```

- API 문서: <http://127.0.0.1:8000/docs>
- 연결 확인: <http://127.0.0.1:8000/api/health>
- 환경 변수는 `.env`에서 읽는다. 예시 파일만 Git에 포함한다.
- 기본 데이터는 실행 위치와 무관하게 저장소의 `data/demo/listings.csv`,
  `data/demo/commute_fixture.csv`를 읽는다. 다른 CSV 폴더는 실행 전에
  `$env:REAL_RENT_DATA_DIR = 'C:\path\to\demo'`로 지정한다.

## 엔드포인트

| 메서드·경로 | 동작 |
| --- | --- |
| `GET /api/health` | 기존 서버 연결 확인 |
| `GET /api/listings` | 매물 12건과 출근·퇴근 합성 경로 |
| `POST /api/compare` | 조건 판정, 전체 사유, 비용·점수와 상위 3건 추천 |
| `POST /api/ask` | 근거 인용이 있는 규칙 답변, 미확인·모호함·범위 밖 구분 |

요청·응답 형식은 [연결 규약](../docs/api.md)을 따른다. `/api/health` 외 응답은
`synthetic: true`와 한국어 `assumptions`를 포함한다. 미확인 금액·실패한 경로는 `null`이다.
관리비 덮어쓰기는 해당 비교 요청에만 적용되며 CSV와 근거 문서는 변경하지 않는다.

```powershell
$conditions = @{
    deposit_limit_krw = 10000000; monthly_budget_krw = 750000
    move_in_by = '2026-11-01'; office_days = 20
    max_one_way_minutes = 40; max_transfers = 1; priority = 'cost'
} | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:8000/api/compare -Method Post -ContentType 'application/json' -Body $conditions
$question = @{ question = 'L03 관리비 얼마야?' } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:8000/api/ask -Method Post -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($question))
```

기본 비교 결과는 `pass=2, fail=8, unknown=1, route_failed=1`, 추천은 `L01`, `L05`다.
점수는 계산 가능한 전체 매물 기준으로 반올림(`0.5` 올림)한 미확정 시안이며 거주성은 항상 `null`이다.

## 담당 경로

| 담당 | 경로 | 역할 |
| --- | --- | --- |
| 개발 2 | `app/api/` | 요청·응답, 오류와 API 연결 |
| 개발 2 | `app/db/` | DB 스키마와 저장·조회 |
| 개발 2 | `app/integrations/` | 주소·교통·매물 등 외부 API, 캐시 |
| 개발 3 | `app/engine/` | 조건 구조화, 계산, 필터, RAG와 설명 |
| 공통 | `tests/` | 실제 동작을 확인하는 자동 검사 |

AI는 같은 서버 안의 모듈로 시작한다. 별도 AI 서버나 특정 DB를 미리 요구하지 않는다.
새 의존성은 `uv add 패키지명`으로 추가하고 `pyproject.toml`과 `uv.lock`을 함께 커밋한다.

## 검증

```powershell
uv run ruff check app tests
uv run python -m pytest
```
