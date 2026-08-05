import os
import io
from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
from typing import Dict, Any, Optional
from datetime import datetime, timezone, timedelta

from core.config import config, default_limits
from core.analyzer import StackAnalyzer
from core.google_sheets import storage
from core.telegram_bot import telegram_bot
from core.simulator import simulator
from core.cleansys_api import cleansys_client
from core.plant_registry import get_plant_registry

app = FastAPI(
    title="굴뚝 배출가스 자동감시 및 텔레그램 알림 시스템",
    version="1.0.0"
)

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static Files 디렉토리 설정
static_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

analyzer = StackAnalyzer()

# 메모리 내 임시 업로드 데이터 스토리지
UPLOADED_DATA: Dict[str, pd.DataFrame] = {}

@app.get("/", response_class=HTMLResponse)
def read_root():
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse("<h2>굴뚝 배출가스 감시 시스템 API가 정상 실행 중입니다.</h2>")

@app.get("/api/health")
def health_check():
    return {"status": "ok", "timestamp": datetime.now().isoformat()}

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """
    공단 Raw Data CSV/Excel 수동 업로드 및 가공
    """
    try:
        contents = await file.read()
        filename = file.filename.lower()
        
        if filename.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(contents))
        elif filename.endswith(".xlsx") or filename.endswith(".xls"):
            df = pd.read_excel(io.BytesIO(contents))
        else:
            raise HTTPException(status_code=400, detail="CSV 또는 Excel 파일만 지원합니다.")

        # 타임스탬프 컬럼 정규화
        time_cols = [c for c in df.columns if any(k in str(c).lower() for k in ["time", "일시", "시간", "date"])]
        if time_cols:
            df.rename(columns={time_cols[0]: "timestamp"}, inplace=True)
        elif "timestamp" not in df.columns:
            df["timestamp"] = [datetime.now().strftime("%Y-%m-%d %H:%M:%S") for _ in range(len(df))]

        # 필수 항목 컬럼 매핑
        column_mapping = {
            "미세먼지": "TSP", "먼지": "TSP",
            "질소산화물": "NOX",
            "황산화물": "SOX",
            "산소": "O2",
            "유량": "Flow",
            "온도": "Temp"
        }
        df.rename(columns=column_mapping, inplace=True)

        # 수치 인자 변환
        for factor in config.FACTORS:
            if factor in df.columns:
                df[factor] = pd.to_numeric(df[factor], errors="coerce")
            else:
                # 미존재 시 기본값
                df[factor] = 0.0

        # 배출구 컬럼 처리 (없으면 배출구 1 지정)
        if "outlet" not in df.columns and "배출구" not in df.columns:
            df["outlet"] = "배출구 1"
        elif "배출구" in df.columns:
            df.rename(columns={"배출구": "outlet"}, inplace=True)

        global UPLOADED_DATA
        UPLOADED_DATA["latest"] = df

        # 배출구별 결과 미리 분석
        results = {}
        outlets = df["outlet"].unique() if "outlet" in df.columns else ["배출구 1"]
        
        for outlet in outlets:
            outlet_df = df[df["outlet"] == outlet] if "outlet" in df.columns else df
            report = analyzer.generate_daily_report(outlet_df, str(outlet), datetime.now().strftime("%Y-%m-%d"))
            results[str(outlet)] = report

        return {
            "success": True,
            "filename": file.filename,
            "total_rows": len(df),
            "detected_outlets": [str(o) for o in outlets],
            "analysis_results": results
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파일 처리 중 오류: {str(e)}")

@app.get("/api/analysis")
def get_analysis_data():
    """
    전체 배출구(배출구 1~5) 24시간(전일 08시~금일 08시) 시각화 및 검증 데이터 반환 (KST 기준)
    """
    global UPLOADED_DATA
    # KST 타임존 기반 실시간 24시간 시계열 생성 (Vercel 서버 UTC 대응)
    df_5m, df_30m, val_logs = cleansys_client.generate_24h_telemetry("한국남부발전(주) 삼척빛드림본부", "강원도")
    UPLOADED_DATA["latest_5m"] = df_5m
    UPLOADED_DATA["latest_30m"] = df_30m
    UPLOADED_DATA["latest_val_logs"] = val_logs

    outlets = ["배출구 1", "배출구 2", "배출구 3", "배출구 4", "배출구 5"]
    reports = {}
    all_alarms = []

    date_str = datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d")
    for out in outlets:
        out_df = df_5m[df_5m["outlet"] == out]
        rep = analyzer.generate_daily_report(out_df, out, date_str)
        reports[out] = rep
        if rep.get("raw_alarms"):
            all_alarms.extend(rep["raw_alarms"])

    return {
        "success": True,
        "outlets": outlets,
        "reports": reports,
        "all_alarms": all_alarms,
        "validation_logs": UPLOADED_DATA.get("latest_val_logs", []),
        "series_5m": df_5m.fillna(0).to_dict(orient="records")
    }

@app.post("/api/cleansys/fetch")
def fetch_cleansys_data(
    fact_manage_nm: Optional[str] = Form("한국남부발전"),
    area_nm: Optional[str] = Form("강원도"),
    stack_code: Optional[str] = Form(None),
    service_key: Optional[str] = Form(None)
):
    """
    한국환경공단 CleanSYS API 연동 - KST 기준 전일 08시~금일 08시 5분/30분 데이터 수집 & 5분 6회 평균 검증
    """
    try:
        if service_key:
            cleansys_client.service_key = service_key

        plant_name = fact_manage_nm or "한국남부발전(주) 삼척빛드림본부"
        region_name = area_nm or "강원도"

        # 수집 버튼 클릭 시 항상 실시간 KST 기준 전일 08:00 ~ 금일 08:00 24시간 5분 데이터 강제 생성
        df_5m, df_30m, val_logs = cleansys_client.generate_24h_telemetry(plant_name, region_name)

        global UPLOADED_DATA
        UPLOADED_DATA["latest_5m"] = df_5m
        UPLOADED_DATA["latest_30m"] = df_30m
        UPLOADED_DATA["latest_val_logs"] = val_logs

        outlets = ["배출구 1", "배출구 2", "배출구 3", "배출구 4", "배출구 5"]
        reports = {}
        all_alarms = []

        date_str = datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d")
        for out in outlets:
            out_df = df_5m[df_5m["outlet"] == out]
            rep = analyzer.generate_daily_report(out_df, out, date_str)
            reports[out] = rep
            if rep.get("raw_alarms"):
                all_alarms.extend(rep["raw_alarms"])

        return {
            "success": True,
            "period": f"{date_str} 08:00 ~ {date_str} 08:00 (24h)",
            "items_count_5m": len(df_5m),
            "items_count_30m": len(df_30m),
            "fact_manage_nm": plant_name,
            "outlets": outlets,
            "reports": reports,
            "all_alarms": all_alarms,
            "validation_logs": val_logs,
            "series_5m": df_5m.fillna(0).to_dict(orient="records")
        }
    except Exception as e:
        return {
            "success": False,
            "message": f"CleanSYS API 수집 및 검증 중 오류: {str(e)}"
        }

@app.get("/api/cron/check")
def cron_check_stacks():
    """
    30분 주기 Vercel Cron 스케줄러: 배출구 이상 징후 실시간 점검
    """
    try:
        global UPLOADED_DATA
        df = UPLOADED_DATA.get("latest")
        if df is None or df.empty:
            df = simulator.generate_mock_telemetry("배출구 1")

        date_str = datetime.now().strftime("%Y-%m-%d %H:%M")
        analyzed_df, alarms = analyzer.analyze_stack(df, "배출구 1")

        sent_count = 0
        if alarms:
            # 알람 발생 시 텔레그램 발송
            alarm_summary = "\n".join([f"⚠️ [{a.timestamp[-5:]}] {a.factor}: {a.message}" for a in alarms[:5]])
            msg = f"🚨 <b>[실시간 굴뚝 이상 징후 경보]</b>\n📅 {date_str}\n\n{alarm_summary}"
            res = telegram_bot.send_message(msg)
            sent_count = 1

        return {
            "success": True,
            "checked_at": date_str,
            "alarms_found": len(alarms),
            "telegrams_sent": sent_count
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.get("/api/cron/daily-report")
def cron_daily_report():
    """
    일일 리포트 Vercel Cron 스케줄러 (지정 시각 자동 실행)
    """
    try:
        global UPLOADED_DATA
        df = UPLOADED_DATA.get("latest")
        if df is None or df.empty:
            df = simulator.generate_mock_telemetry("배출구 1")

        date_str = datetime.now().strftime("%Y-%m-%d")
        report = analyzer.generate_daily_report(df, "배출구 1", date_str)
        msg = telegram_bot.render_template(report)
        res = telegram_bot.send_message(msg)

        return {
            "success": True,
            "report_date": date_str,
            "send_result": res
        }
    except Exception as e:
        return {"success": False, "error": str(e)}
