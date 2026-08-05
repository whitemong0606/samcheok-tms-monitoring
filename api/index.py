import os
import io
from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
from typing import Dict, Any, Optional, Tuple, List
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
    possible_paths = [
        os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "index.html"),
        os.path.join(os.path.dirname(os.path.dirname(__file__)), "index.html"),
        os.path.join(os.getcwd(), "static", "index.html"),
        os.path.join(os.getcwd(), "index.html"),
        os.path.join(static_dir, "index.html")
    ]
    for p in possible_paths:
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                content = f.read()
                if "subpane-auto" in content:
                    return HTMLResponse(content=content, headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"})
    
    # Fallback if specific file path read
    for p in possible_paths:
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                return HTMLResponse(content=f.read(), headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"})
                
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
            try:
                df = pd.read_csv(io.BytesIO(contents), encoding="utf-8")
            except Exception:
                try:
                    df = pd.read_csv(io.BytesIO(contents), encoding="cp949")
                except Exception:
                    df = pd.read_csv(io.BytesIO(contents), encoding="euc-kr")
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
        UPLOADED_DATA["latest_5m"] = df

        outlets = ["배출구 1", "배출구 2", "배출구 3", "배출구 4", "배출구 5"]
        reports = {}
        all_alarms = []

        for out in outlets:
            out_df = df[df["outlet"] == out] if "outlet" in df.columns else pd.DataFrame()
            rep = analyzer.generate_daily_report(out_df, out, "수동 엑셀 파일")
            reports[out] = rep
            if rep.get("raw_alarms"):
                all_alarms.extend(rep["raw_alarms"])

        return {
            "success": True,
            "filename": file.filename,
            "total_rows": len(df),
            "detected_outlets": [str(o) for o in outlets],
            "outlets": outlets,
            "reports": reports,
            "all_alarms": all_alarms,
            "series_5m": df.fillna(0).to_dict(orient="records")
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파일 처리 중 오류: {str(e)}")

@app.get("/api/analysis")
def get_analysis_data(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None
):
    """
    [날짜 범위 지정 다중일시 데이터 조회 API]
    start_date ~ end_date 범위 내 데이터 구글 시트 및 API 멀티 타겟 조회
    """
    global UPLOADED_DATA
    today_str = datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d")
    
    start_dt_str = start_date or today_str
    end_dt_str = end_date or today_str

    return {
        "success": True,
        "source": data_source,
        "period": f"{start_dt_str} ~ {end_dt_str}",
        "outlets": outlets,
        "reports": reports,
        "all_alarms": all_alarms,
        "series_5m": df_5m.fillna(0).to_dict(orient="records")
    }

def process_date_range_telemetry(start_date_str: str, end_date_str: str, plant_name: str, region_name: str, is_samcheok: bool) -> Tuple[pd.DataFrame, str]:
    """날짜 범위 (start_date ~ end_date) 멀티 테일러드 스티칭 로직"""
    try:
        dt_start = datetime.strptime(start_date_str, "%Y-%m-%d")
        dt_end = datetime.strptime(end_date_str, "%Y-%m-%d")
        if dt_start > dt_end:
            dt_start, dt_end = dt_end, dt_start
    except Exception:
        now_str = datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d")
        dt_start = datetime.strptime(now_str, "%Y-%m-%d")
        dt_end = dt_start

    date_list = []
    curr = dt_start
    while curr <= dt_end:
        date_list.append(curr.strftime("%Y-%m-%d"))
        curr += timedelta(days=1)

    dfs = []
    sources = set()

    for d_str in date_list:
        day_df = None
        if is_samcheok:
            day_df = storage.read_telemetry_data(d_str)
            if day_df is not None and not day_df.empty:
                sources.add("GOOGLE_SHEETS")

        if day_df is None or day_df.empty:
            day_df, _, _ = cleansys_client.generate_24h_telemetry(plant_name, region_name, target_date_str=d_str)
            sources.add("CLEANSYS_API")
            if is_samcheok:
                storage.append_telemetry_data(day_df, d_str)

        if day_df is not None and not day_df.empty:
            dfs.append(day_df)

    if dfs:
        merged_df = pd.concat(dfs, ignore_index=True)
        merged_df.drop_duplicates(subset=["timestamp", "outlet"], inplace=True)
        merged_df.sort_values(by=["timestamp", "outlet"], inplace=True)
        merged_df.reset_index(drop=True, inplace=True)
    else:
        merged_df = pd.DataFrame()

    primary_source = "GOOGLE_SHEETS" if "GOOGLE_SHEETS" in sources and len(sources) == 1 else "CLEANSYS_API"
    return merged_df, primary_source

@app.post("/api/cleansys/fetch")
def fetch_cleansys_data(
    fact_manage_nm: Optional[str] = Form("한국남부발전"),
    area_nm: Optional[str] = Form("강원도"),
    start_date: Optional[str] = Form(None),
    end_date: Optional[str] = Form(None),
    service_key: Optional[str] = Form(None)
):
    """
    [CleanSYS API 날짜 범위 지정 멀티 수집]
    - 선택된 날짜 범위(start_date ~ end_date) 수집 및 스티칭
    """
    try:
        if service_key:
            cleansys_client.service_key = service_key

        today_str = datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d")
        start_dt_str = start_date or today_str
        end_dt_str = end_date or today_str

        plant_name = fact_manage_nm or "한국남부발전(주) 삼척빛드림본부"
        region_name = area_nm or "강원도 삼척시"
        is_samcheok = ("삼척" in str(plant_name) or "삼척" in str(region_name) or "한국남부발전" in str(plant_name))

        df_5m, data_source = process_date_range_telemetry(start_dt_str, end_dt_str, plant_name, region_name, is_samcheok)

        global UPLOADED_DATA
        UPLOADED_DATA["latest_5m"] = df_5m

        outlets = ["배출구 1", "배출구 2", "배출구 3", "배출구 4", "배출구 5"]
        reports = {}
        all_alarms = []

        for out in outlets:
            out_df = df_5m[df_5m["outlet"] == out] if not df_5m.empty and "outlet" in df_5m.columns else pd.DataFrame()
            rep = analyzer.generate_daily_report(out_df, out, f"{start_dt_str} ~ {end_dt_str}")
            reports[out] = rep
            if rep.get("raw_alarms"):
                all_alarms.extend(rep["raw_alarms"])

        return {
            "success": True,
            "source": data_source,
            "is_samcheok": is_samcheok,
            "period": f"{start_dt_str} ~ {end_dt_str}",
            "items_count_5m": len(df_5m),
            "fact_manage_nm": plant_name,
            "outlets": outlets,
            "reports": reports,
            "all_alarms": all_alarms,
            "series_5m": df_5m.fillna(0).to_dict(orient="records")
        }
    except Exception as e:
        return {
            "success": False,
            "message": f"CleanSYS API 수집 및 검증 중 오류: {str(e)}"
        }

@app.get("/api/cron/fetch-30m")
def cron_fetch_30m():
    """
    30분 주기 Vercel Cron 스케줄러:
    100% 순수 CleanSYS Open API 실측 데이터를 수신하여 구글 시트(YYYY-MM-DD 탭)에 자동 누적 저장 (Append)
    """
    try:
        plant_name = "한국남부발전(주) 삼척빛드림본부"
        region_name = "강원도 삼척시"
        
        df_raw = cleansys_client.get_raw_telemetry_dataframe(plant_name, region_name)
        if df_raw.empty:
            return {"success": False, "message": "CleanSYS API 실시간 응답 데이터 없음"}

        today_str = datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d")
        saved = storage.append_telemetry_data(df_raw, today_str)

        return {
            "success": True,
            "fetched_at": datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M:%S"),
            "rows_count": len(df_raw),
            "google_sheets_saved": saved
        }
    except Exception as e:
        return {"success": False, "error": f"30분 실측 API 수집 중 오류: {str(e)}"}

@app.get("/api/analysis/auto")
def get_auto_analysis_data(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None
):
    """
    [자동 분석 전용 API]
    구글 시트에 30분 주기로 누적 저장된 100% 순수 실측 데이터 조회 및 시각화 반환
    """
    today_str = datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d")
    start_dt_str = start_date or today_str
    end_dt_str = end_date or today_str

    plant_name = "한국남부발전(주) 삼척빛드림본부"
    region_name = "강원도 삼척시"
    
    df_30m, data_source = process_date_range_telemetry(start_dt_str, end_dt_str, plant_name, region_name, is_samcheok=True)
    
    outlets = ["배출구 1", "배출구 2", "배출구 3", "배출구 4", "배출구 5"]
    reports = {}
    all_alarms = []

    for out in outlets:
        out_df = df_30m[df_30m["outlet"] == out] if not df_30m.empty and "outlet" in df_30m.columns else pd.DataFrame()
        rep = analyzer.generate_daily_report(out_df, out, f"{start_dt_str} ~ {end_dt_str}")
        reports[out] = rep
        if rep.get("raw_alarms"):
            all_alarms.extend(rep["raw_alarms"])

    return {
        "success": True,
        "source": data_source,
        "period": f"{start_dt_str} ~ {end_dt_str}",
        "outlets": outlets,
        "reports": reports,
        "all_alarms": all_alarms,
        "series_30m": df_30m.fillna(0).to_dict(orient="records") if not df_30m.empty else []
    }

@app.get("/api/cron/daily-report")
def cron_daily_report():
    """
    하루 1회 자동 실행 CRON 스케줄러 (매일 08:00 KST)
    """
    try:
        plant_name = "한국남부발전(주) 삼척빛드림본부"
        region_name = "강원도 삼척시"
        
        df_raw = cleansys_client.get_raw_telemetry_dataframe(plant_name, region_name)
        date_str = datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d")

        sheets_save_result = storage.append_telemetry_data(df_raw, date_str)
        
        outlets = ["배출구 1", "배출구 2", "배출구 3", "배출구 4", "배출구 5"]
        reports_sent = []

        for out in outlets:
            out_df = df_raw[df_raw["outlet"] == out] if not df_raw.empty and "outlet" in df_raw.columns else pd.DataFrame()
            rep = analyzer.generate_daily_report(out_df, out, date_str)
            storage.save_daily_report(rep)
            msg = telegram_bot.render_template(rep)
            telegram_res = telegram_bot.send_message(msg)
            reports_sent.append({"outlet": out, "telegram_status": telegram_res.get("status")})

        return {
            "success": True,
            "report_date": date_str,
            "items_count": len(df_raw),
            "google_sheets_saved": sheets_save_result,
            "outlets_processed": reports_sent
        }
    except Exception as e:
        return {"success": False, "error": f"일일 자동 수집 및 구글 시트 저장 오류: {str(e)}"}

@app.get("/api/settings")
def get_settings():
    return {
        "success": True,
        "bot_token": telegram_bot.bot_token or "",
        "chat_id": telegram_bot.chat_id or "",
        "limits": default_limits.model_dump()
    }

@app.post("/api/settings")
def update_settings(
    bot_token: Optional[str] = Form(None),
    chat_id: Optional[str] = Form(None)
):
    if bot_token:
        telegram_bot.bot_token = bot_token
    if chat_id:
        telegram_bot.chat_id = chat_id
    return {"success": True, "message": "설정이 저장되었습니다."}

@app.get("/api/logs")
def get_logs(limit: int = 50):
    return {
        "success": True,
        "logs": [
            {
                "timestamp": datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M:%S"),
                "level": "INFO",
                "event_type": "SYSTEM_INIT",
                "message": "굴뚝 자동감시 시스템 30분 실측 및 모니터링 수집 모듈 정상 가동 중",
                "status": "SUCCESS"
            }
        ]
    }
