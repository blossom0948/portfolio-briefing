# 무료로 매일 아침 메일 받기

유료 서버를 쓰지 않으려면 웹사이트 배포와 매일 메일 발송을 분리하는 편이 가장 단순합니다.

## 결론

- 매일 아침 메일 발송: GitHub Actions
- 앱 화면 확인: 내 컴퓨터에서 로컬 실행, 또는 나중에 GitHub Pages용 정적 화면으로 분리
- Gmail 앱 비밀번호: GitHub Secrets에 저장

HTML만으로는 매일 자동 메일 발송을 안정적으로 할 수 없습니다. 브라우저가 닫혀 있으면 JavaScript가 실행되지 않고, Gmail 앱 비밀번호를 HTML 안에 넣으면 누구나 볼 수 있어 위험합니다.

## 1. GitHub 저장소 만들기

1. GitHub에서 새 저장소를 만듭니다.
2. 이 프로젝트를 push합니다.
3. `.env` 파일은 올리지 않습니다.

## 2. GitHub Secrets 설정

저장소에서 `Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret`로 들어가 아래 3개를 만듭니다.

```text
GMAIL_USER
GMAIL_APP_PASSWORD
BRIEFING_RECIPIENT
```

값 예시:

```text
GMAIL_USER=blossom0948@gmail.com
GMAIL_APP_PASSWORD=구글 앱 비밀번호
BRIEFING_RECIPIENT=blossom0948@gmail.com
```

## 3. 매일 오전 7시 자동 실행

`.github/workflows/daily-briefing.yml` 파일이 이미 추가되어 있습니다.

```yaml
schedule:
  - cron: "0 22 * * *"
```

GitHub Actions의 cron은 UTC 기준입니다. 한국 오전 7시는 UTC 전날 22시라서 `0 22 * * *`를 씁니다.

## 4. 수동 테스트

1. GitHub 저장소의 `Actions` 탭으로 갑니다.
2. `Daily portfolio briefing` 워크플로를 누릅니다.
3. `Run workflow`를 누릅니다.
4. Gmail로 브리핑이 오면 성공입니다.

## HTML만으로 가능한 것과 불가능한 것

가능:

- 가격/브리핑 화면을 보여주는 정적 대시보드
- 브라우저가 열려 있을 때만 직접 조회
- 내 컴퓨터 안에서만 localStorage에 설정 저장

어려움:

- 매일 아침 자동 실행
- Gmail 앱 비밀번호 안전 보관
- pykrx/yfinance 같은 Python 라이브러리 실행
- 브라우저 CORS에 막히지 않는 안정적인 뉴스/가격 조회

그래서 무료 MVP는 GitHub Actions로 메일을 보내고, 화면은 로컬 앱으로 관리하는 구성이 가장 낫습니다.
