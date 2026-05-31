# Hugging Face Spaces 무료 배포

이 방식은 처음 만든 Flask 대시보드를 거의 그대로 인터넷 주소로 배포합니다. 핸드폰에서도 같은 화면을 볼 수 있습니다.

## 왜 Hugging Face Spaces인가

- Docker 앱을 무료로 호스팅할 수 있습니다.
- 기본 포트는 `7860`입니다.
- Secrets를 넣을 수 있어 Gmail/OpenAI 키를 코드에 넣지 않아도 됩니다.
- 디스크는 무료 플랜에서 영구 저장이 아니지만, 이 앱은 `PORTFOLIO_CONFIG_URL`로 Apps Script에 설정을 저장하므로 괜찮습니다.

## 1. Space 만들기

1. [Hugging Face Spaces](https://huggingface.co/spaces)에 들어갑니다.
2. `Create new Space`를 누릅니다.
3. Space name: `briefolio`
4. SDK: `Docker`
5. Visibility: 개인용이면 `Private` 가능 여부를 확인하고, 무료 공개로 쓸 경우 `Public`
6. 생성합니다.

## 2. GitHub 코드 올리기

가장 쉬운 방법은 Hugging Face Space 저장소에 GitHub 코드를 가져오는 것입니다.

로컬에서 Space repo를 clone하거나, Hugging Face 웹 UI에서 파일을 업로드해도 됩니다. 필요한 파일은 이미 이 저장소에 있습니다.

- `Dockerfile`
- `app.py`
- `portfolio_core.py`
- `requirements.txt`
- `templates/`
- `static/`
- `data/`
- `scripts/`

## 3. Secrets 설정

Space 화면의 `Settings` -> `Repository secrets`에 아래 값을 추가합니다.

```text
GMAIL_USER=blossom0948@gmail.com
GMAIL_APP_PASSWORD=Gmail 앱 비밀번호
BRIEFING_RECIPIENT=blossom0948@gmail.com
PORTFOLIO_CONFIG_URL=Apps Script URL, ?app=1 없는 /exec 주소
APP_PIN=원하는 접속 PIN
OPENAI_API_KEY=OpenAI API 키, 선택
OPENAI_MODEL=gpt-5.2
```

OpenAI quota가 없으면 대화형 AI는 막힙니다. 그래도 1년 적립 계산 같은 질문은 앱의 내장 계산 모드가 답합니다.

## 4. 접속

배포가 끝나면 주소는 보통 아래 형태입니다.

```text
https://huggingface.co/spaces/내아이디/briefolio
```

또는 Space 내부 앱 URL로 열립니다. 핸드폰에서 이 주소를 열고 홈 화면에 추가하면 앱처럼 쓸 수 있습니다.

## 5. 알림 반영

이 배포 웹사이트에서 설정을 저장하면:

1. Hugging Face 앱이 설정을 받음
2. `PORTFOLIO_CONFIG_URL`로 Apps Script에 저장
3. GitHub Actions가 매일 오전 7시에 Apps Script 설정을 읽음
4. Gmail 브리핑 발송

즉, Hugging Face 웹사이트에서 바꾼 주식 설정이 다음 알림에 반영됩니다.
