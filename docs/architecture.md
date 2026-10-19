# 구조와 현재 구현 범위

```text
브라우저: React + TypeScript
  └─ /api 요청
       └─ FastAPI
            ├─ api/          요청·응답 (현재 /health만 구현)
            ├─ db/           저장·조회 예정
            ├─ integrations/ 외부 서비스 예정
            └─ engine/       계산·필터·AI·RAG 예정

evaluation/  수작업 기준과 검증
data/demo/   공유 가능한 합성 입력
```

## 선택한 시작 구조

- 하나의 저장소에서 화면과 서버를 함께 변경하고 PR 한 개로 연결 규약을 검토한다.
- 화면은 React·TypeScript·Vite, 서버는 Python·FastAPI를 사용한다.
- AI·계산·RAG는 처음에는 같은 Python 서버 안의 모듈로 구현한다.
- DB, LLM 제공자, 벡터 저장소와 배포 서비스는 아직 선택하지 않았다.
- 의존성은 `frontend/package-lock.json`, `backend/uv.lock`으로 고정한다.

## 현재 실행 경로

1. 화면의 연결 확인 버튼이 `src/lib/api.ts`를 호출한다.
2. 로컬 Vite가 `/api` 요청을 `API_PROXY_TARGET`으로 전달한다. 기본값은 서버 8000번 포트다.
3. FastAPI가 `/api/health`에 상태 JSON을 반환한다.
4. 화면은 HTTP 오류, 응답 형식 오류, 연결 실패와 8초 시간 초과를 성공과 구분한다.

아직 매물 조회·계산·추천·계약 기능은 제공하지 않는다.

## 환경과 배포

`frontend/.env.example`과 `backend/.env.example`만 공유하고 실제 값은 각자 `.env`에 둔다.
`VITE_` 변수는 빌드 결과에 포함되므로 공개 가능한 API 주소만 넣는다.

로컬 개발·미리보기는 Vite의 프록시를 사용한다. 실제 정적 배포에는 이 프록시가 자동으로 생기지 않는다.
배포 시 다음 중 한 방식을 선택하고 README에 실행 주소를 기록한다.

- 같은 도메인: 호스팅 또는 리버스 프록시에서 `/api`를 FastAPI로 전달한다.
- 다른 도메인: 빌드 전에 `VITE_API_BASE_URL=https://서버주소/api`를 지정하고 서버의 `CORS_ORIGINS`에 화면의 정확한 출처를 추가한다.

현재 배포는 수행하지 않았다. 인증, 영속 저장, 외부 서비스 연결 후에는 별도 운영 검증이 필요하다.
