# 🏭 굴뚝 배출가스 자동감시 및 텔레그램 알림 시스템 (EcoStack Monitor)

FastAPI, Google Sheets API, Pandas, Telegram Bot을 기반으로 구현된 굴뚝 배출가스(5개 배출구, 6개 항목) 자동 상태 감시, 이상 징후 판별 및 일일 리포트 알림 웹 대시보드 시스템입니다.

---

## 🌟 주요 기능

1. **다중 탭 웹 대시보드 (Web UI)**
   - **Data 분석 탭**: 공단 Raw Data (.csv, .xlsx) 수동 업로드, Chart.js 다중 축 시각화 차트, 5개 배출구 선택, 실시간 이상 신호 판별 결과 표.
   - **Bot 설정 및 로그 탭**: 텔레그램 Bot Token, Chat ID, 일일 알림 전송 시간, 배출 허용 기준치(TSP, NOX, SOX), 커스텀 템플릿 편집기(태그 클릭 삽입) 및 알림 전송 로그 조회.
   - **시스템 시뮬레이션 기능**: '테스트 발송 (시뮬레이션 실행)' 버튼 클릭 시 가상 굴뚝 원시 데이터(헌팅, 센서 고정, 기준치 초과, 정지 중 이상 데이터)를 생성하여 텔레그램 발송까지 전 과정 검증.

2. **핵심 분석 및 5가지 알람 엔진**
   - **운전/정지 상태 판별**: 보일러 연소 가스 특성을 반영하여 $O_2 \ge 19.5\%$ (정지), $O_2 \le 16.0\%$ (운전)를 구분하고, 운전 상태 시간대만 독립적으로 인자별 평균 수치 계산.
   - **① 결측 알람**: 2시간(4회 연속) 데이터 미수신 시 발생.
   - **② 기준치 초과 알람**: TSP, NOX, SOX 허용 기준 초과 시 발생.
   - **③ 급변동(헌팅) 알람**: $O_2, Flow, Temp \ge 50\%$, $TSP, NOX, SOX \ge 100\%$ 급변 시 발생.
   - **④ 고정 데이터 알람**: 10회 연속 동일 수치 지시 시 발생 (SOX/NOX는 0 제외 상수 또는 운전 중 24시간 0.00 고정 시 발생).
   - **⑤ 정지 중 이상 데이터 알람**: 정지 상태로 판별되었음에도 유량/온도/배출가스 지속 송출 시 발생.

3. **Google Sheets & Fallback 데이터 저장소**
   - Google Sheets API를 통해 Bot 설정 및 발송 로그를 저장.
   - 인증키 미설정 시 **자동 로컬 JSON Fallback (`core/storage_fallback.json`)**으로 동작하여 에러 없이 오프라인/테스트 가능.

4. **Vercel CRON 스케줄링 배포 지원**
   - `vercel.json`에 정의된 30분 주기 periodic 점검(`*/30 * * * *`) 및 매일 지정 시각 일일 리포트 자동 발송.

---

## 📂 프로젝트 구조

```
stack_monitor_system/
├── api/
│   └── index.py                 # FastAPI 웹 응용 프로그램 및 REST API 라우터
├── core/
│   ├── __init__.py
│   ├── config.py                # 상수, 환경변수 및 기준치 설정
│   ├── analyzer.py              # 운전/정지 판별 및 5가지 이상 알람 검증 엔진
│   ├── google_sheets.py         # Google Sheets API 연동 및 로컬 Fallback 스토리지
│   ├── telegram_bot.py          # 텔레그램 알림 발송 및 템플릿 치환 모듈
│   └── simulator.py             # 가상 데이터 생성 및 시뮬레이션 테스트 발송 모듈
├── static/
│   ├── index.html               # 글래스모피즘 다중 탭 웹 대시보드
│   ├── css/style.css            # 반응형 다크 모드 스타일시트
│   └── js/app.js                # UI 상호작용 및 Chart.js 시각화 스크립트
├── requirements.txt             # 파이썬 의존성 패키지 목록
├── vercel.json                  # Vercel Serverless & CRON 스케줄링 설정
└── README.md                    # 사용 및 배포 가이드
```

---

## 🚀 로컬 실행 방법

1. **의존성 설치**
   ```bash
   pip install -r requirements.txt
   ```

2. **FastAPI 웹 서버 실행**
   ```bash
   uvicorn api.index:app --reload --port 8000
   ```

3. **웹 대시보드 접속**
   웹 브라우저에서 `http://127.0.0.1:8000` 로 접속합니다.

---

## 🧪 시스템 시뮬레이션 테스트 방법

1. 웹 대시보드 접속 후 **'Bot 설정 및 로그'** 탭으로 이동합니다.
2. 텔레그램 Bot Token과 Chat ID를 입력하거나 기본 테스트 상태로 둡니다. (Token 미설정 시 가상 발송 로그로 처리됨)
3. **'테스트 발송 (시뮬레이션 실행)'** 버튼을 클릭합니다.
4. 가상 데이터 24시간분 생성 $\rightarrow$ 5가지 이상 징후 분석 $\rightarrow$ 텔레그램 메세지 전송 전 과정이 실행되며, 하단 **'알림 송신 내역'** 표에서 실시간으로 결과를 확인할 수 있습니다.

---

## ☁️ Vercel 배포 방법

1. GitHub 리포지토리에 본 프로젝트 코드를 커밋 및 푸시합니다.
2. [Vercel Dashboard](https://vercel.com)에서 **New Project**를 선택하고 해당 리포지토리를 가져옵니다.
3. **Environment Variables** 설정:
   - `TELEGRAM_BOT_TOKEN`: (선택) 텔레그램 봇 토큰
   - `TELEGRAM_CHAT_ID`: (선택) 텔레그램 챗 ID
   - `GOOGLE_CREDENTIALS`: (선택) Google Service Account JSON 내용 전체
   - `GOOGLE_SHEET_ID`: (선택) Google Spreadsheet ID
4. **Deploy** 버튼을 눌러 배포를 완료합니다. `vercel.json`에 정의된 CRON 스케줄이 자동으로 활성화됩니다.
