# REAL RENT

거주 비용·조건·근거를 바탕으로 집을 비교하는 4인 팀 프로젝트.
화면, 서버, AI와 검증 자료를 **하나의 비공개 저장소**에서 관리한다.

현재는 시작 화면 → 서버 연결 확인까지 실행할 수 있는 초기 구조다.
비용 계산, 추천, RAG, DB 저장과 외부 API 연동은 아직 구현하지 않았다.

## 1. 가장 먼저 할 일

모든 팀원과 저장소 소유자는 [AGENTS.md](AGENTS.md)를 읽는다.
작업 전 최신 `origin/main`을 기준으로 **본인 작업 브랜치**를 만든다.

```powershell
git clone https://github.com/chan12392/real-rent.git
cd real-rent
git fetch origin
git switch -c feat/my-task origin/main
git branch --show-current
```

`feat/my-task`를 실제 작업 이름으로 바꾼다. 이미 진행 중인 브랜치가 있으면 해당 브랜치에서 계속한다.
모든 변경은 PR로 제안하고 다른 팀원의 리뷰를 받는다. 병합은 `chan12392`만 수행한다.
GitHub Free에서 문서로 정한 운영 규칙이며 기술적으로 강제 차단된 상태는 아니다.

## 2. 폴더와 담당자

```text
real-rent/
├─ AGENTS.md                 # 공통 협업 지침
├─ .gitignore                # 비밀값·의존성·생성 파일 제외
├─ .github/                  # PR·이슈 양식, 자동 검사
├─ frontend/                 # 개발 1 · React + TypeScript
│  └─ src/lib/api.ts         # 화면의 서버 요청
├─ backend/                  # Python + FastAPI
│  ├─ app/api/               # 개발 2 · HTTP API
│  ├─ app/core/              # 개발 2 · 서버 설정·공통 인프라
│  ├─ app/schemas/           # 공통 입력·출력 형식, 개발 2가 조율
│  ├─ app/db/                # 개발 2 · DB 구현 예정
│  ├─ app/integrations/      # 개발 2 · 외부 API 구현 예정
│  ├─ app/engine/            # 개발 3 · 조건 추출·경로 응답 정리·RAG
│  ├─ app/domain/            # 분석 · 비용 계산·필터·정렬
│  └─ tests/                 # 서버 자동 검사
├─ data/                     # 공통 데이터와 로컬 생성물 위치
├─ evaluation/               # 분석 · 기준·검증 사례·결과
├─ deploy/                   # 개발 2 · 배포 안내와 설정 위치
└─ docs/                     # API·아키텍처·팀 작업 안내
```

| 담당 | 주 작업 경로 | 맡은 작업 |
| --- | --- | --- |
| 개발 1 · 화면·발표 | `frontend/`, 발표 자료 | 조건 입력·변경, 주소 확인, 후보 비교, 발표 편집·녹화 |
| 개발 2 · 서버·DB·배포 | `backend/app/main.py`, `api/`, `core/`, `db/`, `integrations/`, `deploy/` | 서버·DB, 주소·교통 API, 캐시·오류 처리, 배포 |
| 개발 3 · AI | `backend/app/engine/` | 자연어 조건 추출, 경로 응답 정리, RAG·LangGraph, 추천 이유 |
| 분석 · 데이터·계산·검증 | `backend/app/domain/`, `data/demo/`, `data/references/`, `evaluation/` | 시연 데이터·근거 문서, 비용 계산·필터·정렬 함수, 검증 취합 |
| 공통 · 개발 2 조율 | `backend/app/schemas/`, `docs/api.md` | 입력·출력 예시를 합의하고 함께 변경 |

AI 코드는 백엔드 안의 모듈로 시작한다. 독립 서버와 두 번째 저장소는 현재 필요하지 않다.
계산 함수는 분석 담당자가 구현하고 AI는 그 결과를 사용한다.
개발 2의 착수 순서와 연결 지점은 [개발 2 작업 안내](docs/development-2.md)를 따른다.

## 3. 로컬 실행

필요 도구: Git, Node.js **24.14 이상 25 미만**와 npm, Python **3.12**, [uv](https://docs.astral.sh/uv/getting-started/installation/).
먼저 위 절차대로 작업 브랜치로 전환한다. 아래 명령은 Windows PowerShell 기준이다.
이미 `.env`를 만든 경우 복사 단계를 반복해 기존 설정을 덮어쓰지 않는다.

**터미널 A · 서버**

```powershell
cd backend
uv sync --frozen
Copy-Item .env.example .env
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 --env-file .env
```

API 문서: <http://127.0.0.1:8000/docs>

**터미널 B · 화면** — 저장소 루트에서 시작

```powershell
cd frontend
npm ci
Copy-Item .env.example .env
npm run dev
```

<http://127.0.0.1:5173>에서 **서버 연결 확인**을 누른다.
화면 → 로컬 프록시 → `GET /api/health`가 연결되면 `real-rent-api에 연결되었습니다.`가 표시된다.
이 응답은 서버 프로세스 확인용이며 DB나 외부 API의 정상 동작을 보장하지 않는다.

## 4. 변경 확인과 PR

| 위치 | 실행할 검사 |
| --- | --- |
| `frontend/` | `npm run lint`, `npm run build` |
| `backend/` | `uv run ruff check app tests`, `uv run python -m pytest` |

```powershell
git add <변경한-파일>
git commit -m "feat: 작업 내용"
git push -u origin <내-작업-브랜치>
```

GitHub에서 `main`을 대상으로 PR을 열고 다른 팀원에게 리뷰를 요청한다.
자동 검사는 PR마다 실행한다. 자동 병합과 보호 규칙은 설정하지 않는다.

## 5. 파일 관리

- `.git/`은 `git clone`이 만드는 로컬 숨김 폴더다. GitHub 파일 목록에 업로드하는 폴더가 아니다.
- 제외 목록 파일의 이름은 `.gitignore`다. `.ignore` 파일을 별도로 만들 필요는 없다.
- `.env.example`, `package-lock.json`, `uv.lock`은 공유한다.
- 실제 `.env`, `node_modules`, `.venv`, 빌드·캐시·인덱스·원본 개인정보는 공유하지 않는다.
- `data/demo/listings.json`은 직접 만든 합성 예시이며 현재 API가 자동으로 읽는 데이터는 아니다.

자세한 연결 규약은 [API 문서](docs/api.md), 구조와 배포 시 확인 사항은 [아키텍처](docs/architecture.md),
하루 작업 방식은 [팀 작업 안내](docs/team-workflow.md)를 참고한다.
