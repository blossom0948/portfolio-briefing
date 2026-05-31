# Cloudflare Pages 배포

Cloudflare Pages는 GitHub 저장소와 직접 연동할 수 있습니다. 이 프로젝트에서는 `docs/` 폴더를 Cloudflare Pages용 정적 대시보드로 사용합니다.

## 중요한 차이

Cloudflare Pages는 Flask 서버를 그대로 실행하지 않습니다. 그래서 `http://127.0.0.1:5050`의 Python 백엔드를 그대로 올리는 것이 아니라, 같은 디자인의 정적 대시보드를 `docs/`에 두고, Cloudflare Pages Functions가 `/api/*` 백엔드를 맡습니다.

저장과 알림 반영은 이렇게 됩니다.

1. Cloudflare Pages 대시보드에서 설정 입력
2. `/api/config` Pages Function이 Apps Script URL로 설정 저장
3. `/api/snapshot` Pages Function이 Yahoo Finance chart API로 가격 요약 조회
4. `/api/ai` Pages Function이 OpenAI 또는 Gemini를 호출
5. GitHub Actions가 매일 오전 7시에 Apps Script 설정을 읽음
6. Gmail 브리핑 발송

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

배포 전에 Cloudflare Pages 프로젝트의 `Settings` -> `Environment variables`에 아래 값을 넣습니다.

```text
PORTFOLIO_CONFIG_URL=Apps Script /exec 주소
OPENAI_API_KEY=OpenAI API 키, 선택
OPENAI_MODEL=gpt-4o-mini
GEMINI_API_KEY=Gemini API 키, 선택
GEMINI_MODEL=gemini-2.0-flash
```

`PORTFOLIO_CONFIG_URL`은 필수입니다. `?app=1` 없는 `/exec` 주소를 넣습니다.

사용 순서:

1. Cloudflare Pages 주소로 접속합니다.
2. 대시보드가 자동으로 설정과 가격을 불러옵니다.
3. `주식 설정` 탭에서 보유 수량, 평단, 주식 모으기를 수정합니다.
4. `저장`을 누릅니다.
5. 다시 새로고침했을 때 값이 유지되면 완료입니다.

## AI

AI 키는 프론트엔드에 넣지 않고 Cloudflare Environment variables에 넣습니다. `/api/ai` Pages Function이 대신 호출하므로 키가 브라우저에 노출되지 않습니다.

OpenAI/Gemini quota가 막히면 앱은 1년 적립 시뮬레이션 같은 계산형 질문에 대해 내장 계산 모드로 답합니다.
