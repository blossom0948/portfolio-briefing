# Portfolio Briefing App

삼성전자, QQQM, VOO 같은 보유 종목을 관리하고 매일 아침 브리핑 메일을 보내는 Flask 앱입니다.

## 로컬 실행

```powershell
.\.venv\Scripts\python.exe app.py
```

브라우저에서 `http://127.0.0.1:5050`을 엽니다.

## 환경 변수

`.env` 파일에 아래 값이 필요합니다.

```env
GMAIL_USER=blossom0948@gmail.com
GMAIL_APP_PASSWORD=앱비밀번호
BRIEFING_RECIPIENT=blossom0948@gmail.com
ENABLE_APP_SCHEDULER=false
```

`.env`는 `.gitignore`에 포함되어 있어 저장소에 올라가지 않습니다.

## 주요 기능

- 보유 종목 추가, 삭제, 수량/평단 편집
- 매수/매도 기록으로 수량과 평단 자동 반영
- 종목별 주식 모으기 계획 저장
- `pykrx`로 국내 주식 가격 조회
- `yfinance`로 미국 ETF 가격과 해외 뉴스 조회
- Google News RSS로 국내 뉴스 조회
- 해외 뉴스 제목 한국어 번역
- 앱 안에서 Now Brief 패널 보기
- 브리핑 미리보기와 Gmail 테스트 발송
- `ENABLE_APP_SCHEDULER=true`일 때 서버 실행 중 매일 오전 7시 KST 자동 메일 발송

## 배포 메모

Render, Railway, Fly.io 같은 Python 서버 배포 환경에 올리는 구성이 가장 단순합니다.
배포할 때는 `.env` 파일 대신 서비스의 환경 변수 설정 화면에 Gmail 값을 넣으세요.
로컬에서는 이미 Codex 자동화가 매일 오전 7시에 메일을 보내므로, 중복 발송을 피하려면 `ENABLE_APP_SCHEDULER=false`를 유지하세요.

자세한 배포 순서는 `DEPLOYMENT.md`를 참고하세요.
