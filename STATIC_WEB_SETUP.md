# 무료 웹 배포 구조

이 구조는 유료 서버 없이 웹 입력값을 매일 아침 메일에 반영합니다.

## 구조

- GitHub Pages: 설정 화면을 무료로 호스팅
- Google Apps Script: 웹에서 입력한 포트폴리오 설정을 저장
- GitHub Actions: 매일 오전 7시에 설정을 읽고 Gmail 발송

GitHub Pages는 정적 사이트 호스팅이고, GitHub 공식 문서에서도 GitHub Free의 public repo에서 사용할 수 있습니다. Apps Script Web App은 HTTP POST가 들어오면 `doPost(e)`를 실행할 수 있습니다. Cloudflare Workers도 무료 플랜이 있지만, Python의 `pykrx/yfinance`를 그대로 쓰기 어려워 지금 프로젝트에는 GitHub Actions가 더 맞습니다.

## 1. GitHub Pages 켜기

1. GitHub 저장소 `Settings`로 갑니다.
2. `Pages` 메뉴로 갑니다.
3. `Build and deployment`에서 `Deploy from a branch`를 선택합니다.
4. Branch는 `main`, 폴더는 `/docs`를 선택합니다.
5. 저장합니다.

잠시 후 이런 주소가 생깁니다.

```text
https://blossom0948.github.io/portfolio-briefing/
```

## 2. Google Apps Script 만들기

1. [Apps Script](https://script.google.com/)에 들어갑니다.
2. 새 프로젝트를 만듭니다.
3. `apps-script/Code.gs` 파일 내용을 복사해서 붙여넣습니다.
4. 왼쪽의 `+` 버튼으로 HTML 파일을 만들고 이름을 `Index`로 둡니다.
5. `apps-script/Index.html` 파일 내용을 복사해서 붙여넣습니다.
6. `배포` -> `새 배포`를 누릅니다.
7. 유형은 `웹 앱`을 선택합니다.
8. 실행 사용자는 `나`, 액세스 권한은 `모든 사용자`로 둡니다.
9. 배포 후 나온 Web app URL을 복사합니다.

## 3. GitHub Actions에 설정 URL 저장

GitHub 저장소에서:

`Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret`

아래 secret을 추가합니다.

```text
PORTFOLIO_CONFIG_URL=Apps Script Web app URL
```

이미 넣은 Gmail secret 3개는 그대로 둡니다.

## 4. 웹에서 설정 저장

핸드폰에서는 Apps Script Web App URL 뒤에 `?app=1`을 붙여 접속하는 것이 가장 안정적입니다.

```text
https://script.google.com/macros/s/.../exec?app=1
```

1. 위 주소로 접속합니다.
2. 보유 수량, 평단, 주식 모으기 계획을 입력합니다.
3. `저장`을 누릅니다.
4. "저장했습니다" 메시지가 뜨면 다음 메일에 반영됩니다.

GitHub Pages 주소는 안내용/백업용으로 둬도 됩니다. 실제 핸드폰 입력은 Apps Script 웹앱을 추천합니다.

## 5. 메일 테스트

1. GitHub `Actions` 탭으로 갑니다.
2. `Daily portfolio briefing`을 선택합니다.
3. `Run workflow`를 누릅니다.
4. 메일 내용이 웹에서 저장한 설정을 반영하면 성공입니다.

## AI를 웹사이트에 넣는 방법

가능은 하지만 API 키를 HTML에 직접 넣으면 안 됩니다. 안전한 방식은 Apps Script 서버 함수에서 AI를 호출하는 것입니다.

이 프로젝트의 Apps Script 앱에는 `AI에게 물어보기` 섹션이 포함되어 있습니다.

1. [Google AI Studio](https://aistudio.google.com/)에서 Gemini API 키를 만듭니다.
2. Apps Script 프로젝트 설정으로 갑니다.
3. `스크립트 속성`에 아래 값을 추가합니다.

```text
GEMINI_API_KEY=발급받은 API 키
GEMINI_MODEL=gemini-2.0-flash
```

4. Apps Script를 새 버전으로 다시 배포합니다.
5. 핸드폰 앱에서 `AI에게 물어보기`에 질문을 입력합니다.

예시 질문:

```text
삼성전자를 매주 1만원씩 1년 모으면 총 얼마를 쓰고, 주가가 -20%, 0%, +20%일 때 결과가 어떻게 돼?
```

Gemini API의 표준 텍스트 생성은 `generateContent` REST 엔드포인트를 사용합니다. 이 프로젝트에서는 Apps Script의 `UrlFetchApp`이 그 엔드포인트를 호출합니다.
