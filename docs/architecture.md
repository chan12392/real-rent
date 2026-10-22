# 구조와 현재 구현 범위

```text
브라우저: React + TypeScript
  └─ /api 요청
       └─ FastAPI
            ├─ core/         서버 설정 (개발 2)
            ├─ schemas/      공통 입력·출력 형식 (개발 2 조율)
            ├─ api/          /health, /demo/catalog, /compare
            ├─ db/           시연 JSON 조회·검사 (실제 DB 예정)
            ├─ integrations/ 외부 서비스 예정
            ├─ engine/       조건 추출·경로 응답 정리·AI·RAG 예정 (개발 3)
            └─ domain/       비용 계산·필터·정렬 (분석)

evaluation/  수작업 기준과 검증
data/demo/   공유 가능한 합성 입력
data/references/ 공유 가능한 근거 문서
deploy/      배포 안내와 설정 위치
```

## 선택한 시작 구조

- 하나의 저장소에서 화면과 서버를 함께 변경하고 PR 한 개로 연결 규약을 검토한다.
- 화면은 React·TypeScript·Vite, 서버는 Python·FastAPI를 사용한다.
- AI·RAG는 `engine/`, 계산·필터·정렬은 `domain/`으로 나누고 같은 Python 서버에서 실행한다.
- DB, LLM 제공자, 벡터 저장소와 배포 서비스는 아직 선택하지 않았다.
- 의존성은 `frontend/package-lock.json`, `backend/uv.lock`으로 고정한다.

## 현재 실행 경로

1. `scripts/dev.mjs`가 포트 사용 여부를 검사하고 화면·서버를 실행한다. 종료 시 자신이 시작한 프로세스만 정리한다.
2. `ComparisonPage`가 `/api/demo/catalog`로 회사 목록을 읽고 `ConditionsForm`을 표시한다.
3. 사용자가 조건을 제출하면 비교 API 클라이언트 → 공통 `requestApi` → Vite 프록시 → FastAPI로 전달된다.
4. `/api/compare`가 입력 검사 → `load_demo_data()` → `compare_listings()`를 호출한다.
5. 순수 계산 함수가 후보·비용·순서·제외 사유를 반환하고 `ComparisonResults`가 표시한다.
6. 조건을 수정하면 이전 결과를 지운다. 제출 중 입력을 잠그고, 실패 후 재시도할 수 있다.

`/api/health`는 별도 연결 검사로 유지한다. 화면은 HTTP 오류, 응답 형식 오류, 연결 실패와 8초 초과를 구분한다.
시연 데이터는 요청마다 읽는다. 실제 매물·교통 조회, AI·RAG, 영속 저장과 계약 기능은 제공하지 않는다.

## 기능 구현 시 연결 방향

- 개발 2의 `api/`가 요청을 검증하고 `db/`, `integrations/`, `engine/`, `domain/`을 연결한다.
- 개발 3의 `engine/`는 전달받은 조건·경로·근거와 분석 담당자의 `domain/` 결과로 추천 이유를 만든다.
- `domain/`은 계산·필터·정렬만 처리한다. HTTP·DB·LLM을 가져오지 않는다.
- 공통 입력·출력 형식은 `schemas/`와 `docs/api.md`에서 조율한다. 화면 타입·응답 검사도 함께 수정한다.
- 화면은 `/api`로만 연결한다. 외부 API 키를 화면에 넣지 않는다.

현재 `api/ → db/demo.py → domain/comparison.py` 연결이 구현되어 있다.
`integrations/`, `engine/`의 외부 API·AI 연결은 담당자가 다음 PR에서 추가한다.

## 환경과 배포

`frontend/.env.example`과 `backend/.env.example`만 공유하고 실제 값은 각자 `.env`에 둔다.
`VITE_` 변수는 빌드 결과에 포함되므로 공개 가능한 API 주소만 넣는다.

로컬 개발·미리보기는 Vite의 프록시를 사용한다. 실제 정적 배포에는 이 프록시가 자동으로 생기지 않는다.
배포 시 다음 중 한 방식을 선택하고 README에 실행 주소를 기록한다.

- 같은 도메인: 호스팅 또는 리버스 프록시에서 `/api`를 FastAPI로 전달한다.
- 다른 도메인: 빌드 전에 `VITE_API_BASE_URL=https://서버주소/api`를 지정하고 서버의 `CORS_ORIGINS`에 화면의 정확한 출처를 추가한다.

현재 배포는 수행하지 않았다. 인증, 영속 저장, 외부 서비스 연결 후에는 별도 운영 검증이 필요하다.
개발 2의 실행·확인 항목은 [배포 안내](../deploy/README.md)에 정리한다.

## 작업 브랜치의 탐색 시제품

기본 React 화면은 `features/explore/ExplorePage`다. `/api/explore` →
LangGraph `extract`/`respond` → `domain/explore.evaluate_home` → 합성 매물 12개 전체 판정으로 연결한다.
기존 비교 컴포넌트는 `/?view=legacy`에서 제공한다. 조건·대화 상태는 브라우저 localStorage에만
저장하고 요청마다 서버에 전달한다. LangGraph에 사용자 공용 체크포인터를 두지 않는다.
규칙 추출·정형 답변이며 LLM/RAG 서비스가 아니다. 자세한 범위는 `docs/explore-prototype.md`를 따른다.
