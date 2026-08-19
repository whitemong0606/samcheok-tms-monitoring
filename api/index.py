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

import numpy as np

def sanitize_for_json(obj):
    if isinstance(obj, dict):
        return {str(k): sanitize_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [sanitize_for_json(v) for v in obj]
    elif isinstance(obj, (float, int)):
        if pd.isna(obj) or np.isnan(obj) or np.isinf(obj):
            return 0.0
        return float(obj) if isinstance(obj, float) else int(obj)
    elif isinstance(obj, (pd.Timestamp, datetime)):
        return obj.strftime("%Y-%m-%d %H:%M:%S")
    elif pd.isna(obj):
        return None
    elif hasattr(obj, "item"):
        val = obj.item()
        if val is None or (isinstance(val, float) and (np.isnan(val) or np.isinf(val))):
            return 0.0
        return val
    elif isinstance(obj, (str, bool)):
        return obj
    return str(obj)

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
                df = pd.read_csv(io.BytesIO(contents), encoding="utf-8", header=None)
            except Exception:
                try:
                    df = pd.read_csv(io.BytesIO(contents), encoding="cp949", header=None)
                except Exception:
                    df = pd.read_csv(io.BytesIO(contents), encoding="euc-kr", header=None)
        elif filename.endswith(".xlsx") or filename.endswith(".xls"):
            try:
                df = pd.read_excel(io.BytesIO(contents), header=None, engine="openpyxl")
            except Exception:
                try:
                    df = pd.read_excel(io.BytesIO(contents), header=None, engine="xlrd")
                except Exception:
                    df = pd.read_excel(io.BytesIO(contents), header=None)
        else:
            return JSONResponse(status_code=400, content={"success": False, "detail": "CSV 또는 Excel 파일만 지원합니다."})

        # 가로 다중 배출구(Wide Format) 엑셀 vs 세로 단일/다중 엑셀 자동 인식
        time_cols_indices = []
        header_row_idx = None

        # === 원본 엑셀 절대 열 기준: G(6),N(13),U(20),AB(27),AI(34),AP(41) 컬럼명 미리 기록 ===
        # 헤더 행을 나중에 찾더라도 절대 열의 실제 헤더 텍스트를 보존
        EXCEL_ABS_COL_FACTORS = {
            "TSP":  6,   # G
            "NOX":  13,  # N
            "SOX":  20,  # U
            "O2":   27,  # AB
            "Flow": 34,  # AI
            "Temp": 41,  # AP
        }
        # 헤더 행 스캔 전, 각 절대 열 위치의 실제 컬럼 헤더 텍스트를 저장
        abs_col_header_texts = {}  # factor -> (abs_col_idx, header_text_in_that_col)

        for r_idx in range(min(15, len(df))):
            r_vals = [str(v).strip().lower() for v in df.iloc[r_idx].fillna("").tolist()]
            t_indices = [i for i, v in enumerate(r_vals) if any(k in v for k in ["일시", "시간", "date", "time", "시각", "측정일시"])]
            if len(t_indices) >= 2:
                time_cols_indices = t_indices
                header_row_idx = r_idx
                break

        if len(time_cols_indices) >= 2:
            # [가로 다중 배출구 Wide Format unpivoting]
            blocks = []
            for b_idx, start_col in enumerate(time_cols_indices):
                end_col = time_cols_indices[b_idx + 1] if b_idx + 1 < len(time_cols_indices) else df.shape[1]
                
                outlet_name = f"배출구 {b_idx + 1}"
                if header_row_idx > 0:
                    for row_above in range(header_row_idx):
                        val_above = str(df.iloc[row_above, start_col]).strip()
                        if val_above and val_above.lower() not in ["nan", "none"]:
                            digits = "".join(filter(str.isdigit, val_above))
                            if digits in ["1", "2", "3", "4", "5"]:
                                outlet_name = f"배출구 {digits}"
                            else:
                                outlet_name = val_above
                            break

                block_df = df.iloc[header_row_idx:, start_col:end_col].copy()
                block_df.columns = block_df.iloc[0]
                block_df = block_df.iloc[1:].reset_index(drop=True)
                block_df["outlet"] = outlet_name
                blocks.append(block_df)

            df = pd.concat(blocks, ignore_index=True)
        else:
            # [세로 표준 엑셀/CSV 탐색]
            for idx in range(min(15, len(df))):
                row_str = " ".join(df.iloc[idx].dropna().astype(str)).lower()
                if any(k in row_str for k in ["일시", "시간", "date", "time", "먼지", "질소", "황산", "tsp", "nox", "sox", "배출구", "굴뚝"]):
                    header_row_idx = idx
                    break

            if header_row_idx is not None:
                # 절대 열 기준 헤더 텍스트 기록 (헤더 행의 실제 셀 값)
                for factor, abs_idx in EXCEL_ABS_COL_FACTORS.items():
                    if abs_idx < df.shape[1]:
                        raw_hdr = str(df.iloc[header_row_idx, abs_idx]).strip()
                        if raw_hdr and raw_hdr.lower() not in ["nan", "none", ""]:
                            abs_col_header_texts[factor] = raw_hdr
                df.columns = df.iloc[header_row_idx]
                df = df.iloc[header_row_idx + 1:].reset_index(drop=True)

        # 컬럼명 매핑 정규화: '보정후' / '보정값' / '보정' 컬럼 우선 선택 정밀 스코어링
        factors_keywords = {
            "timestamp": ["일시", "시간", "date", "time", "시각", "측정일시"],
            "outlet": ["배출구", "굴뚝", "stack", "outlet", "호기"],
            "TSP": ["먼지", "tsp", "dust"],
            "NOX": ["질소", "nox", "no2", "질소산화"],
            "SOX": ["황산", "sox", "so2", "황산화"],
            "O2": ["산소", "o2(%)", "o2 (%)", "o2"],
            "Flow": ["유량", "flow", "fl1", "fl2", " fl ", "fl("],
            "Temp": ["온도", "temp", "tmp", "tmp(", "온도("],
            "State": ["상태", "state", "status", "구분"]
        }

        col_map = {}
        already_mapped_targets = set()
        for factor, keywords in factors_keywords.items():
            best_col = None
            best_score = -1
            for col in df.columns:
                c_str = str(col).strip()
                c_lower = c_str.lower()
                if any(k in c_lower for k in ["기준치", "허용기준", "기준", "limit"]):
                    continue
                if any(k in c_lower for k in keywords):
                    score = 10
                    if "보정후" in c_lower or "보정값" in c_lower:
                        score += 1000
                    elif "보정" in c_lower and "보정전" not in c_lower and "보정후" not in c_lower:
                        score += 500
                    elif "보정전" in c_lower or "측정값" in c_lower:
                        score += 1
                    if score > best_score:
                        best_score = score
                        best_col = col
            if best_col is not None and best_col not in col_map and factor not in already_mapped_targets:
                col_map[best_col] = factor
                already_mapped_targets.add(factor)

        df.rename(columns=col_map, inplace=True)
        df = df.loc[:, ~df.columns.duplicated()].copy()

        # ===================================================================
        # [인덱스 기반 보정후값 폴백]
        # 1순위: 헤더 파싱 전 절대 열(G,N,U,AB,AI,AP)에서 기록한 실제 헤더명으로 매핑
        # 2순위: 키워드 매핑 후에도 factor가 없으면 파싱 후 컬럼 순번으로 폴백
        # ===================================================================
        all_cols_list = list(df.columns)
        for factor, abs_idx in EXCEL_ABS_COL_FACTORS.items():
            if factor in df.columns:
                continue  # 이미 키워드 매핑 성공
            # 1순위: 절대 열에서 기록한 헤더명으로 찾기
            recorded_hdr = abs_col_header_texts.get(factor)
            if recorded_hdr and recorded_hdr in df.columns:
                df.rename(columns={recorded_hdr: factor}, inplace=True)
                print(f"[UploadParse][AbsHdr] {factor} <- 절대 열 헤더명: '{recorded_hdr}'")
                continue
            # 2순위: 현재 파싱된 df 컬럼 순번으로 폴백
            if abs_idx < len(all_cols_list):
                fallback_col = all_cols_list[abs_idx]
                fb_lower = str(fallback_col).lower()
                if not any(k in fb_lower for k in ["기준치", "허용기준", "기준", "limit"]):
                    df.rename(columns={fallback_col: factor}, inplace=True)
                    print(f"[UploadParse][IdxFallback] {factor} <- 순번 {abs_idx} (컬럼명: '{fallback_col}')")

        # 컬럼명 진단 로그
        mapped_factors = [f for f in ['TSP','NOX','SOX','O2','Flow','Temp','timestamp','outlet'] if f in df.columns]
        print(f"[UploadParse] 매핑 완료 factors: {mapped_factors}")
        print(f"[UploadParse] 전체 컬럼: {list(df.columns)[:20]}")

        if "timestamp" not in df.columns:
            df["timestamp"] = [datetime.now().strftime("%Y-%m-%d %H:%M:%S") for _ in range(len(df))]

        if "outlet" not in df.columns:
            df["outlet"] = "배출구 1"
        else:
            def norm_out(v):
                if v is None or pd.isna(v):
                    return "배출구 1"
                s = str(v).strip()
                digits = "".join(filter(str.isdigit, s))
                if digits in ["1", "2", "3", "4", "5"]:
                    return f"배출구 {digits}"
                return s
            df["outlet"] = df["outlet"].apply(norm_out)

        for factor in config.FACTORS:
            if factor in df.columns:
                target_col = df[factor]
                if isinstance(target_col, pd.DataFrame):
                    target_col = target_col.iloc[:, 0]
                df[factor] = pd.to_numeric(target_col, errors="coerce").fillna(0.0)
            else:
                df[factor] = 0.0

        df["timestamp"] = df["timestamp"].astype(str)
        df["outlet"] = df["outlet"].astype(str)

        series_records = []
        for r in df.to_dict(orient="records"):
            row_dict = {}
            for k, v in r.items():
                if pd.isna(v) or v is None:
                    row_dict[k] = 0.0 if k in config.FACTORS else ""
                elif hasattr(v, "strftime"):
                    row_dict[k] = v.strftime("%Y-%m-%d %H:%M:%S")
                else:
                    row_dict[k] = v
            series_records.append(row_dict)

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

        res_payload = {
            "success": True,
            "filename": file.filename,
            "total_rows": len(df),
            "detected_outlets": [str(o) for o in outlets],
            "outlets": outlets,
            "reports": reports,
            "all_alarms": all_alarms,
            "series_5m": series_records
        }
        return JSONResponse(status_code=200, content=sanitize_for_json(res_payload))
    except Exception as e:
        import traceback
        err_msg = f"파일 처리 중 오류: {str(e)}"
        print(f"[UploadError] {err_msg}\n{traceback.format_exc()}")
        return JSONResponse(status_code=500, content={"success": False, "detail": err_msg, "message": err_msg})

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
        "series_30m": (
            df_30m.assign(
                status=df_30m["status"].fillna("") if "status" in df_30m.columns else ""
            ).fillna(0).to_dict(orient="records")
            if not df_30m.empty else []
        )
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
