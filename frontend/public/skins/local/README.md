# 내 PC의 캐릭터

이 폴더에 다음 8개 파일을 직접 넣는다. 이 안내 파일만 Git으로 공유하며, 이미지·JSON·하위 폴더는 `.gitignore`로 제외된다.

```text
neutral.png
excited.png
thinking.png
worried.png
surprised.png
sorry.png
blink.png
skin.json
```

`skin.json`은 `frontend/skin-template/skin.example.json`을 복사한 뒤 이름·인사·출처·감탄사·말투를 바꾼다.
이미지는 권리 있는 캐릭터만 사용하고 로컬 결과물은 커밋·공유하지 말 것.
기존 파일이 있으면 먼저 별도 이름으로 보관한다. 설치 절차·스키마·실패 대처는 [로컬 스킨 안내](../../../../docs/local-skin.md)를 참고한다.

`frontend`에서 `npm run skin:check`를 통과한 뒤 앱 주소에 `?skin=local`을 붙여 연다.
