# Cloudflare Pages 배포

Cloudflare Pages는 GitHub 저장소와 직접 연동할 수 있습니다. 이 프로젝트에서는 `docs/` 폴더를 Cloudflare Pages용 정적 대시보드로 사용합니다.

## 중요한 차이

Cloudflare Pages는 Flask 서버를 그대로 실행하지 않습니다. 그래서 `http://127.0.0.1:5050`의 Python 백엔드를 그대로 올리는 것이 아니라, 같은 디자인의 정적 대시보드를 `docs/`에 둡니다.

저장과 알림 반영은 이렇게 됩니다.

1. Cloudflare Pages 대시보드에서 설정 입력
2. Apps Script URL로 설정 저장
3. GitHub Actions가 매일 오전 7시에 Apps Script 설정을 읽음
4. Gmail 브리핑 발송

Cloudflare Containers는 Flask Docker를 그대로 실행할 수 있지만 Workers Paid plan 대상입니다. 무료로 가려면 Pages + Apps Script + GitHub Actions 조합이 낫습니다.

## 배포 단계

1. [Cloudflare Dashboard](https://dash.cloudflare.com/)에 로그인합니다.
2. `Workers & Pages`로 갑니다.
3. `Create application`을 누릅니다.
4. `Pages` -> `Connect to Git`을 선택합니다.
5. GitHub 계정을 연결하고 `blossom0948/portfolio-briefing` 저장소를 선택합니다.
6. 빌드 설정을 아래처럼 둡니다.

```text
Project name: portfolio-briefing
Production branch: main
Framework preset: None
Build command: 비워두기
Build output directory: docs
Root directory: /
```

7. 배포합니다.

배포가 끝나면 아래 같은 주소가 생깁니다.

```text
https://portfolio-briefing.pages.dev
```

## 사용 방법

1. Cloudflare Pages 주소로 접속합니다.
2. `연결 설정` 탭에 Apps Script `/exec` URL을 넣습니다.
3. `URL 저장`을 누릅니다.
4. `불러오기`를 누릅니다.
5. 주식 설정을 바꾸고 `저장`을 누릅니다.
6. 다시 `불러오기`를 눌러 저장값이 보이면 완료입니다.

## AI

정적 Cloudflare Pages에 OpenAI/Gemini API 키를 직접 넣으면 키가 노출됩니다. 그래서 AI 대화형 기능은 아래 중 하나로 가야 합니다.

- 로컬 Flask 대시보드에서 사용
- Apps Script 앱에서 사용
- Cloudflare Worker를 별도로 만들어 API 키를 Worker Secret에 저장하고 호출

지금 무료 MVP에서는 AI를 로컬 Flask나 Apps Script 쪽에 두는 것이 안전합니다.
