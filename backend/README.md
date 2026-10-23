# 서버 · 개발 2 / AI · 개발 3 / 계산 · 분석

Python 3.12와 uv를 사용한다. 연결 확인, 시연 목록 조회, 조건별 비교 API를 제공한다.
시연 JSON으로 비용·필터·정렬을 계산하며 실제 DB·외부 API·RAG는 연결하지 않았다.

## 실행

저장소 루트에서 작업 브랜치를 먼저 만든다.
화면·서버 함께 실행은 루트에서 `npm run setup`, `npm run dev`를 사용한다. 서버만 실행하려면:

```powershell
cd backend
uv sync --frozen
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

- API 문서: <http://127.0.0.1:8000/docs>
- 연결 확인: <http://127.0.0.1:8000/api/health>
- 시연 목록: <http://127.0.0.1:8000/api/demo/catalog>
- 비교: `POST /api/compare`. `/docs`에서 입력 예시와 응답을 실행할 수 있다.
- 기본값은 `.env` 없이 실행된다. 별도 설정이 필요하면 `.env.example`을 복사하고 `--env-file .env`를 추가한다.

## 담당 경로

| 담당 | 경로 | 역할 |
| --- | --- | --- |
| 개발 2 | `app/main.py`, `app/core/` | 앱 조립, 환경 설정과 서버 공통 처리 |
| 개발 2 | `app/api/` | 요청·응답, 오류와 API 연결 |
| 개발 2 | `app/db/demo.py` | 시연 파일 조회·형식 검사. DB 교체 시 조회 경계 |
| 개발 2 | `app/integrations/`, `../deploy/` | 주소·교통 API, 캐시·오류 처리, 배포 |
| 개발 3 | `app/engine/` | 자연어 조건 추출·확인, 문서 근거·LangGraph와 추천 이유 |
| 분석 | `app/domain/` | 비용 계산, 필터와 정렬 함수 |
| 공통 · 개발 2 조율 | `app/schemas/` | 연결 확인·조건·매물·왕복 경로·비교 결과 모델 |
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
현재 연결·CORS 검사는 `tests/test_health.py`, 비교 API·계산·입력 경계·불완전 데이터 검사는
`tests/test_comparison.py`에 있다. 계산 함수는 HTTP·파일·외부 API 호출 없이 직접 검사할 수 있다.

## 대화·지도 시제품 추가

`POST /api/explore`는 `engine/explore.py`의 LangGraph 규칙 기반 대화 흐름과
`domain/explore.py`의 개별 매물 판정을 연결한다. LLM/API 키가 필요하지 않다.
입출력은 `schemas/explore.py`, 합성 데이터는 `data/demo/explore.json`,
자동 검사는 `tests/test_explore.py`, `tests/engine/`이다. 기존 비교 API는 유지한다.
조건을 모두 확인한 뒤에만 비교하며 변경 시 재확인한다. 출근일과 비용/시간 우선순위에
임의 기본값을 넣지 않는다. 합성 근거 문서는 `data/references/explore.json`에서 매물 ID별로 찾는다.
진행 상태와 실제 모델·주소·교통 연결의 남은 범위는 [개발 3 안내](../docs/development-3.md)를 따른다.
