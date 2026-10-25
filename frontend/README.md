# 고객 화면 · 개발 1

React + TypeScript + Vite를 사용한다. 조건 입력·변경, 가상 후보 비교와 제외·오류 표시를 제공한다.
주소 검색과 실제 교통 조회, AI 설명은 아직 구현하지 않았다.
개발 1은 발표 자료 편집과 시연 녹화도 맡는다. 실제 개인정보가 포함된 녹화나 대용량 영상은 Git에 넣지 않는다.

## 실행

Node.js 24.14 이상 25 미만과 npm이 필요하다. 저장소 루트에서 작업 브랜치를 먼저 만든다.
화면·서버 함께 실행은 루트에서 `npm run setup`, `npm run dev`를 사용한다. 화면만 실행하려면:

```powershell
cd frontend
npm ci
npm run dev
```

브라우저에서 <http://127.0.0.1:5173>을 연다. 별도 실행 시 서버도 실행해야 한다.
**이 조건으로 비교**는 `/api/compare`, **서버 연결 확인**은 `/api/health`를 호출한다.

- `src/App.tsx`: 화면 조립과 공통 안내.
- `src/components/ConnectionStatus.tsx`: 서버 연결 확인.
- `src/features/comparison/ComparisonPage.tsx`: 조회·비교 상태, 재시도, 오래된 응답 무시.
- `src/features/comparison/ConditionsForm.tsx`: 입력과 브라우저 기본 검증.
- `src/features/comparison/ComparisonResults.tsx`: 비용·왕복 통근·제외 이유.
- `src/features/comparison/api.ts`, `types.ts`: 비교 전용 요청·응답 검증과 타입.
- `src/lib/api.ts`: 공통 요청, 8초 제한, HTTP·응답 형식 오류 처리.
- `vite.config.ts`: 로컬 `/api` 요청을 서버 8000번 포트로 전달.
- `.env.example`: 로컬 연결 설정 예시. `VITE_` 변수는 브라우저에 공개되므로 비밀값을 넣지 않는다.

조건 변경 시 결과를 지우고, 제출 중에는 입력과 중복 제출을 잠근다.
실패하면 입력을 유지해 다시 제출할 수 있다. 서버의 제외 사유와 합성 데이터 표시를 유지한다.

## 검증

```powershell
npm run lint
npm run build
npm test
```

`npm test`는 로컬 HTTP 응답으로 정상·오류 JSON, 본문 연결 중단과 본문 수신 중 8초 제한을 확인한다.

`npm run preview`는 빌드 결과를 4173번 포트에서 확인한다. 서버 연결에는 백엔드 실행도 필요하다.
실제 배포 시 API 경로와 허용 출처를 맞추는 방법은 [아키텍처 문서](../docs/architecture.md)를 따른다.
