# REAL RENT

거주 비용·조건·근거를 바탕으로 집을 비교하는 4인 팀 프로젝트.
화면, 서버, AI와 검증 자료를 **하나의 비공개 저장소**에서 관리한다.

현재는 **합성 매물 12건으로 동작하는 시연 제품**이다: 조건 입력 → 통과·탈락·판단 불가·경로 실패 판정 →
월 지출(월세+관리비+통근비)·초기 현금·거주 기간 지출 → 추천 TOP 3 → 위치 보기 → 문서 근거 질문.

- 매물·가격·좌표·교통은 모두 가정값이다(`data/demo/*.csv`). 실거래·교통 API, DB, LLM은 연결하지 않았다.
- 계산 규칙은 팀 승인 전 요구사항 초안 기준이며, 화면 하단과 API 응답 `assumptions`에 가정을 표시한다.
- 근거 질문은 LLM 없이 문서 검색 + 규칙 답변이다. 점수 4축은 미확정 시안이며 거주성은 데이터가 없다.
- 규약: [docs/api.md](docs/api.md). 서버 검증 기록: `backend/validation/`.

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
│  ├─ app/db/                # 개발 2 · DB 구현 예정
│  ├─ app/integrations/      # 개발 2 · 외부 API 구현 예정
│  ├─ app/engine/            # 개발 3 · AI·계산·RAG 구현 예정
│  └─ tests/                 # 서버 자동 검사
├─ data/                     # 공통 데이터와 로컬 생성물 위치
├─ evaluation/               # 분석 1 · 기준·검증 사례·결과
└─ docs/                     # API·아키텍처·팀 작업 안내
```

| 담당 | 주 작업 경로 | 첫 작업 |
| --- | --- | --- |
| 개발 1 · 고객 화면 | `frontend/` | 조건 입력·비교 화면 |
| 개발 2 · 서버·DB·외부 API | `backend/app/api/`, `db/`, `integrations/` | 공통 데이터 형식과 API |
| 개발 3 · AI·계산·RAG | `backend/app/engine/` | 비용 계산과 조건 필터 |
| 분석 1 · 기준·검증 | `evaluation/` | 계산·추천 기준, 수작업 검증 사례 20개 |
| 전원 | `data/demo/`, `docs/` | 샘플 입력·기능 테스트·발표 자료 |

AI 코드는 백엔드 안의 모듈로 시작한다. 독립 서버와 두 번째 저장소는 현재 필요하지 않다.

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

<http://127.0.0.1:5173>을 열면 기본 조건으로 비교 결과가 바로 표시된다. 서버가 꺼져 있으면 오류 상태가 따로 표시된다.

## 발표용 로컬 실행

5분 시연 순서와 실패 대처는 [docs/demo-script.md](docs/demo-script.md), 수용 테스트 근거는 [docs/acceptance.md](docs/acceptance.md),
지연 측정은 [docs/latency.md](docs/latency.md)에 있다. 아래는 Windows PowerShell 기준이며 저장소 루트에서 시작한다.

```powershell
# 터미널 A · 서버 (처음 한 번: uv sync --frozen)
cd backend
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000

# 터미널 B · 화면 (처음 한 번: npm ci)
cd frontend
npm run dev
```

<http://127.0.0.1:5173>을 연다. 기본 캐릭터는 오리지널 마스코트 보금이이고 `?skin=renti`를 붙이면 코드로 그린 캐릭터 렌티로 바뀐다.
자기 PC의 이미지·대사로 쓰는 `?skin=local` 설정은 [내 캐릭터 안내](docs/local-skin.md)를 참고한다.
외부 CDN·웹폰트에 의존하지 않아 설치가 끝난 PC에서는 인터넷 없이 돌아간다. 시연 전 점검:

```powershell
cd frontend
node scripts/check-chat.ts                                              # 대화 로직 39개 검사
node scripts/measure-latency.mjs --base http://127.0.0.1:5173 --n 30   # 지연 측정(서버 두 개를 띄운 상태)
node scripts/acceptance-probe.mjs --base http://127.0.0.1:5173         # 수용 테스트 브라우저 확인
```

두 `.mjs` 스크립트는 `package.json`을 바꾸지 않고 npx 캐시의 `playwright-core`를 찾아 쓴다. 없으면 `--playwright <playwright-core 폴더>`로 지정한다.
결과 파일은 `--out` 폴더(예: `.playwright-mcp/d5-qa`, 미추적)에 저장된다.

- **보금이는 이 팀의 오리지널 캐릭터(AI 생성 시안)이다.** 이미지는 `frontend/public/skins/bogeum/*.png`에 두며, 생성 도구 이용약관상 권리 귀속은 ‘확인 필요’다([에셋 기록](docs/assets/character-asset-log.md)). 이미지가 하나라도 없으면 렌티로 대체된다.
- 매물·가격은 모두 합성 시연 데이터, 의미 판단은 규칙 기반(LLM 미사용)이다. 측정 수치는 로컬 루프백 값이다.

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
