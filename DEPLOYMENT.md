# 초보자용 배포 가이드

이 앱을 안정적으로 매일 아침 메일 발송까지 하려면, 내 컴퓨터가 아니라 항상 켜져 있는 서버에서 돌려야 합니다. 가장 쉬운 길은 Render에 웹앱과 크론 작업을 따로 배포하는 방식입니다.

## 전체 구조

1. GitHub에 코드 올리기
2. Render Web Service로 웹사이트 배포
3. Render Cron Job으로 매일 오전 7시 메일 발송
4. Gmail 앱 비밀번호와 수신 주소는 Render 환경 변수에 저장

## 1. GitHub 준비

1. GitHub에서 새 저장소를 만듭니다.
2. 이 폴더의 파일을 커밋하고 GitHub에 push합니다.
3. `.env` 파일은 올리면 안 됩니다. 이미 `.gitignore`에 들어 있습니다.

## 2. Render 웹앱 만들기

1. [Render](https://render.com)에 가입합니다.
2. `New` -> `Web Service`를 선택합니다.
3. 방금 만든 GitHub 저장소를 연결합니다.
4. 설정값을 아래처럼 넣습니다.

```text
Environment: Python 3
Build Command: pip install -r requirements.txt
Start Command: gunicorn app:app
```

5. 환경 변수에 아래 값을 추가합니다.

```text
GMAIL_USER=blossom0948@gmail.com
GMAIL_APP_PASSWORD=구글에서 받은 앱 비밀번호
BRIEFING_RECIPIENT=blossom0948@gmail.com
ENABLE_APP_SCHEDULER=false
PORTFOLIO_DATA_PATH=/var/data/portfolio.json
```

6. 보유 종목 설정을 서버에 저장하려면 Render의 Persistent Disk를 추가합니다.

```text
Mount Path: /var/data
Size: 가장 작은 용량으로 시작
```

Persistent Disk를 안 붙이면 배포나 재시작 때 저장한 종목 설정이 사라질 수 있습니다.

## 3. Render Cron Job 만들기

웹사이트 배포가 끝났으면 메일 발송용 Cron Job을 따로 만듭니다.

1. Render에서 `New` -> `Cron Job`을 선택합니다.
2. 같은 GitHub 저장소를 연결합니다.
3. 설정값을 아래처럼 넣습니다.

```text
Build Command: pip install -r requirements.txt
Command: python scripts/portfolio_briefing_email.py
Schedule: 0 22 * * *
```

Render Cron은 보통 UTC 기준입니다. 한국 오전 7시는 UTC 전날 22시라서 `0 22 * * *`를 사용합니다.

4. Cron Job에도 웹앱과 같은 환경 변수를 넣습니다.

```text
GMAIL_USER=blossom0948@gmail.com
GMAIL_APP_PASSWORD=구글에서 받은 앱 비밀번호
BRIEFING_RECIPIENT=blossom0948@gmail.com
PORTFOLIO_DATA_PATH=/var/data/portfolio.json
```

Cron Job에서도 같은 보유 종목 데이터를 읽으려면 같은 Persistent Disk를 공유해야 합니다. Render 플랜/구성상 공유가 어렵다면, 처음에는 웹앱 설정 화면보다 `data/portfolio.json` 기본값을 수정해서 쓰는 방식이 더 단순합니다.

## 4. 정상 작동 확인

1. Render 웹앱 주소에 접속합니다.
2. `브리핑 보기` 버튼을 눌러 브리핑이 뜨는지 확인합니다.
3. `테스트 메일` 버튼을 눌러 Gmail로 메일이 오는지 확인합니다.
4. Cron Job 화면에서 `Run now`를 눌러 수동 실행합니다.
5. 메일이 오면 매일 오전 7시 자동 발송 준비가 끝난 것입니다.

## 추천 운영 방식

초기에는 로컬 앱에서 기능을 다듬고, 배포 후에는 Render 환경 변수와 Cron Job 로그를 확인하세요. 메일이 안 오면 먼저 Cron Job 로그에서 Gmail 로그인 실패인지, 가격/뉴스 조회 실패인지 확인하면 됩니다.
