# 배포 · 개발 2

배포 서비스와 DB는 아직 선택하지 않았다. 이 폴더에는 선택한 환경의 설정과 운영 안내를 추가한다.
현재 Docker 구성, 원격 배포, 실제 서비스 주소는 없다.

## 현재 실행 가능한 명령

저장소 루트 기준이며, Node.js 버전과 Python 환경은 루트 README를 따른다.

```powershell
cd frontend
npm ci
npm run build
```

생성되는 `frontend/dist/`를 정적 호스팅에 제공한다. 새 터미널에서 서버:

```powershell
cd backend
uv sync --frozen --no-dev
uv run --no-dev uvicorn app.main:app --host 0.0.0.0 --port 8000
```

서버 명령은 환경 변수가 배포 환경에 주입되어 있다고 가정한다. 로컬 `.env`를 사용할 때만
`--env-file .env`를 추가한다. 운영 서버에서 `--reload`는 사용하지 않는다.

## 배포를 연결할 때 기록할 내용

- 화면·서버 주소, 배포 커밋, 배포·되돌리기 명령.
- 같은 도메인이면 `/api` 리버스 프록시 설정. Vite 개발 프록시는 정적 배포에 포함되지 않는다.
- 다른 도메인이면 화면 **빌드 전** `VITE_API_BASE_URL` 설정과 서버 `CORS_ORIGINS`의 정확한 출처.
- DB와 캐시의 위치·유효 기간, 마이그레이션·백업·복구 방법.
- 주소·교통 API의 설정 이름과 호출 한도. 실제 키는 호스팅 비밀 설정에 둔다.
- 배포된 화면 → API 연결과 데이터·외부 API의 성공·실패 확인 결과.

`GET /api/health`는 서버 프로세스 연결만 확인한다. DB·외부 API 준비 상태를 의미하지 않는다.
