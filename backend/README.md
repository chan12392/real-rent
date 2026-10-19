# 서버 · 개발 2 / AI · 개발 3

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
