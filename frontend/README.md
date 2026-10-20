# 고객 화면 · 개발 1

React + TypeScript + Vite를 사용한다. 현재는 시작 화면과 서버 연결 확인만 구현되어 있다.
조건 입력·변경, 주소 확인, 후보 비교, 근거·오류 표시는 앞으로 구현한다.
개발 1은 발표 자료 편집과 시연 녹화도 맡는다. 실제 개인정보가 포함된 녹화나 대용량 영상은 Git에 넣지 않는다.

## 실행

Node.js 24.14 이상 25 미만과 npm이 필요하다. 저장소 루트에서 작업 브랜치를 먼저 만든다.
이미 `.env`가 있으면 복사 단계를 건너뛰어 기존 설정을 보존한다.

```powershell
cd frontend
npm ci
Copy-Item .env.example .env
npm run dev
```

브라우저에서 <http://127.0.0.1:5173>을 연다. 별도 터미널에서 서버도 실행한 뒤
**서버 연결 확인** 버튼을 누르면 실제 `/api/health` 응답을 표시한다.

- `src/App.tsx`: 시작 화면. 고객 화면을 이곳에서 확장한다.
- `src/lib/api.ts`: 서버 요청과 응답 확인.
- `vite.config.ts`: 로컬 `/api` 요청을 서버 8000번 포트로 전달.
- `.env.example`: 로컬 연결 설정 예시. `VITE_` 변수는 브라우저에 공개되므로 비밀값을 넣지 않는다.

## 검증

```powershell
npm run lint
npm run build
```

`npm run preview`는 빌드 결과를 4173번 포트에서 확인한다. 서버 연결에는 백엔드 실행도 필요하다.
실제 배포 시 API 경로와 허용 출처를 맞추는 방법은 [아키텍처 문서](../docs/architecture.md)를 따른다.
