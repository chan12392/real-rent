# 내 캐릭터: PC별 로컬 스킨

팀원 각자가 자기 PC에서 캐릭터 이미지 7장과 대사를 설정하는 기능이다. 로컬 파일을 공유하거나 서버에 업로드하지 않는다.
권리 있는 캐릭터만 쓰고, 로컬 결과물은 커밋·공유하지 말 것. `git add -f`로 제외 규칙을 우회하지 않는다.

## 3단계 사용법

1. **템플릿 복사.** `frontend`에서 아래 명령으로 `skin.json`을 만든 다음 이름·인사·출처·감탄사·말투를 수정한다.
   이미 파일이 있다면 새 이름으로 보관한 후 복사한다. 원본을 덮어쓰지 않는다.

   ```powershell
   Copy-Item -LiteralPath skin-template/skin.example.json -Destination public/skins/local/skin.json
   ```

2. **이미지 7장 넣기.** `frontend/public/skins/local/`에 `neutral.png`, `excited.png`, `thinking.png`,
   `worried.png`, `surprised.png`, `sorry.png`, `blink.png`를 넣는다. 투명 1024×1024 PNG 권장, 정사각형 512px 이상 허용.
   [표정·겹침 요령](../frontend/skin-template/POSES.md), [이미지 생성용 템플릿](../frontend/skin-template/PROMPT-TEMPLATE.md)을 참고한다.

3. **검사하고 열기.** `frontend`에서 `npm run skin:check`를 실행한다. 오류가 0이면 기존 앱 실행 방법대로 서버·화면을 켜고
   주소에 `?skin=local`을 붙인다(예: `http://127.0.0.1:5173/?skin=local`). 파일을 바꾸면 페이지를 새로고침한다.

   ```powershell
   npm run skin:check
   # 다른 폴더 또는 기본 스킨 이미지만 검사
   npm run skin:check -- public/skins/bogeum --images-only
   ```

쿼리 없이 열면 보금이, `?skin=renti`면 렌티다. 로컬 JSON·이미지 중 하나라도 없거나 잘못되면 그림·이름·이후 말투가 렌티로 바뀌고,
캐릭터 아래에 `내 캐릭터를 불러오지 못해 렌티로 보여요: <이유>`가 표시된다. 파일을 고치고 새로고침한다.
상태 문구·패널 제목·대화 이름표는 `name`, 캐릭터 아래 작은 표기는 `credit`, 첫 인사는 `greeting`이다.
숫자 계산·추천·조건 해석은 기존 로직을 쓰며 감탄사와 어미만 바뀐다.

## skin.json 규약

UTF-8 JSON 객체. 모든 필드가 필수이며 문자 수는 유니코드 코드 포인트 기준이다. 제한이 있는 문자열은 공백만으로 채울 수 없다.
알 수 없는 추가 필드는 사용하지 않는다. 인사 내용과 이름을 서로 맞추는 것은 작성자의 몫이다.

| 필드 | 형식 | 사용 위치 |
| --- | --- | --- |
| `name` | 문자열 1~12자 | 제목·이름표·상태 문구 |
| `greeting` | 문자열 | 대화 첫 인사(빈 문자열도 허용) |
| `credit` | 문자열 1~60자 | 캐릭터 아래 작은 출처 표기 |
| `interjections` | 아래 9개 키의 객체, 각각 문자열 1~12자 | “감탄사 (본문)” 형식의 대사 |
| `tone` | `"casual"` 또는 `"polite"` | 본문 반말·존댓말 |

| 감탄사 키 | 대화 단계 |
| --- | --- |
| `confirm` | 조건 확인 |
| `applied` | 조건 반영 |
| `question` | 보완 질문 |
| `not_understood` | 이해 실패·유효하지 않은 조건 |
| `comparing` | 결과를 기다림 |
| `result_pass` | 통과 결과 |
| `result_none` | 통과 매물 없음 |
| `server_error` | 서버 연결 실패 |
| `cancel` | 조건 변경 취소 |

전체 예시는 [skin.example.json](../frontend/skin-template/skin.example.json)이다.
화면과 CLI는 `persona.ts`의 순수 함수 `personaFromSkinJson(unknown)`으로 같은 규약을 검증한다.
텍스트는 React 텍스트로만 표시하며 HTML·스크립트로 실행하지 않는다.

## 검사 결과 읽기

표에는 7장 각각의 크기·모서리 알파·`neutral` 대비 알파 마스크 IoU와 JSON 검사 결과가 나온다.
오류가 있으면 종료 코드 1, 없으면 0이다. IoU < 0.85는 경고여서 종료 코드 0이지만 실루엣을 맞추는 것을 권장한다.

- 지원: 비인터레이스 RGB/RGBA 8bit PNG. RGB는 tRNS 투명색도 읽는다. 팔레트·그레이스케일·16bit·인터레이스는 “지원 안 함” 오류다.
- 네 모서리가 알파 0이어야 하고 전체가 투명하면 오류다. 알파 > 0인 픽셀을 마스크로 삼는다.
- 같은 크기는 전 픽셀을 비교하고 다른 크기는 정규화 좌표로 최근접 샘플링한다. 64메가픽셀 초과는 메모리 보호를 위해 지원하지 않는다.
- CRC·청크·압축·PNG 필터 0~4를 확인한다. 화면은 PNG 형식·로딩·정사각형 크기를 검사하므로 투명도·IoU는 사용 전에 CLI로 확인한다.

`frontend/public/skins/local/README.md`만 추적한다. 이미지와 JSON은 `.gitignore`로 제외된다.
Vite는 `public` 파일을 빌드 산출물에도 복사하므로 **개인 스킨이 들어 있는 `dist`를 배포·공유하지 않는다**.
공유용 빌드는 개인 파일이 없는 별도 깨끗한 작업 경로에서 만든다. Git 제외는 권리 확인이나 배포 차단을 대신하지 않는다.
