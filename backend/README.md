# 서버 · 개발 2 / AI · 개발 3 / 계산 · 분석

Python 3.12와 uv를 사용한다. 현재 구현된 API는 `GET /api/health`다.
DB, 외부 API, 계산 및 RAG 연결은 앞으로 구현한다.

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

## 담당 경로

| 담당 | 경로 | 역할 |
| --- | --- | --- |
| 개발 2 | `app/main.py`, `app/core/` | 앱 조립, 환경 설정과 서버 공통 처리 |
| 개발 2 | `app/api/` | 요청·응답, 오류와 API 연결 |
| 개발 2 | `app/db/` | DB 스키마와 저장·조회 |
| 개발 2 | `app/integrations/`, `../deploy/` | 주소·교통 API, 캐시·오류 처리, 배포 |
| 개발 3 | `app/engine/` | 자연어 조건 추출, 경로 응답 정리, RAG·LangGraph와 추천 이유 |
| 분석 | `app/domain/` | 비용 계산, 필터와 정렬 함수 |
| 공통 · 개발 2 조율 | `app/schemas/` | 입력·출력 형식, 현재는 `HealthResponse`만 존재 |
| 공통 | `tests/` | 실제 동작을 확인하는 자동 검사 |

AI는 같은 서버 안의 모듈로 시작한다. 별도 AI 서버나 특정 DB를 미리 요구하지 않는다.
새 의존성은 `uv add 패키지명`으로 추가하고 `pyproject.toml`과 `uv.lock`을 함께 커밋한다.
`app/main.py`의 `create_app()`과 `app`은 기존 서버 진입점으로 유지한다.
`app/core/config.py`는 앱 생성 시 환경 변수를 읽는다. 실행 명령의 `--env-file .env`가 파일을 로드한다.
개발 2는 [작업 안내](../docs/development-2.md)부터 시작한다.

## 검증

```powershell
uv run ruff check app tests
uv run python -m pytest
```

새 검사는 담당 모듈에 맞춰 `tests/api/`, `tests/integrations/`, `tests/engine/`,
`tests/domain/`에 추가한다. 필요한 디렉터리는 첫 테스트와 함께 만든다.
현재 연결·CORS 검사는 `tests/test_health.py`에 있다.
