let stackChart = null;

document.addEventListener('DOMContentLoaded', () => {
    const safeInit = (fn, name) => {
        try { fn(); } catch (err) { console.warn(`[InitWarning] ${name} 초기화 중 오류:`, err); }
    };

    safeInit(initTabs, 'initTabs');
    safeInit(initSubTabs, 'initSubTabs');
    safeInit(initFileUpload, 'initFileUpload');
    safeInit(initManualHistoryControls, 'initManualHistoryControls');
    safeInit(initCleanSysAPI, 'initCleanSysAPI');
    safeInit(initDatePickers, 'initDatePickers');
    safeInit(initOutletSelector, 'initOutletSelector');
    safeInit(initSettings, 'initSettings');
    safeInit(initSimulation, 'initSimulation');
    safeInit(initLogs, 'initLogs');
    safeInit(checkAdminLoginState, 'checkAdminLoginState');
    
    // 최초 데이터 로드
    safeInit(loadAnalysisData, 'loadAnalysisData');
    safeInit(loadSettings, 'loadSettings');
    safeInit(loadLogs, 'loadLogs');
});

// 1. Tab Navigation
function initTabs() {
    const tabs = document.querySelectorAll('.nav-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            if (target === 'tab-settings' && !isAdminLoggedIn()) {
                showToast('🔒 봇 설정 및 로그는 관리자 로그인 후 접근할 수 있습니다.', 'WARNING');
                openPinModal();
                return;
            }

            tabs.forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            
            tab.classList.add('active');
            document.getElementById(target).classList.add('active');

            if (target === 'tab-settings') {
                _isSettingsUnlocked = false;
                updateSettingsUIState();
                loadSettings();
                loadLogs();
            }
        });
    });
}

// 2. File Drag & Drop Upload (Multi-file support)
function initFileUpload() {
    const fileInput = document.getElementById('file-upload');
    const dropzone = document.getElementById('dropzone');
    const processBtn = document.getElementById('btn-process-upload');
    if (!fileInput || !dropzone) return;

    window.selectedManualFiles = [];

    function handleFilesSelected(fileList) {
        if (!fileList || fileList.length === 0) return;
        window.selectedManualFiles = Array.from(fileList);
        const fileNames = window.selectedManualFiles.map(f => f.name).join(', ');
        const textElem = dropzone.querySelector('.dropzone-text');
        if (textElem) {
            textElem.innerHTML = `<strong style="color: var(--accent-cyan); font-size: 1.05rem;"><i class="fa-solid fa-file-excel"></i> ${window.selectedManualFiles.length}개 파일 선택됨</strong><span style="color: #fef08a; font-size:0.85rem;">${fileNames}</span><span style="color:#94a3b8; font-size:0.82rem;">아래 [수동 엑셀 데이터 분석 및 시각화 실행] 버튼을 클릭하세요.</span>`;
        }
        if (processBtn) {
            processBtn.disabled = false;
            processBtn.style.opacity = '1.0';
            processBtn.style.cursor = 'pointer';
            processBtn.classList.add('pulse-glow');
        }
        showToast(`📄 ${window.selectedManualFiles.length}개 파일 인식 완료!`);
    }

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFilesSelected(e.target.files);
        }
    });

    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.style.borderColor = 'var(--accent-cyan)';
    });

    dropzone.addEventListener('dragleave', () => {
        dropzone.style.borderColor = 'rgba(255, 255, 255, 0.15)';
    });

    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.style.borderColor = 'rgba(255, 255, 255, 0.15)';
        if (e.dataTransfer.files.length > 0) {
            handleFilesSelected(e.dataTransfer.files);
        }
    });

    if (processBtn) {
        processBtn.addEventListener('click', () => {
            if (window.selectedManualFiles && window.selectedManualFiles.length > 0) {
                uploadFiles(window.selectedManualFiles);
            } else {
                showToast(`수동 업로드할 엑셀/CSV 파일을 먼저 선택해 주세요.`, 'WARNING');
            }
        });
    }
}

async function uploadFiles(files) {
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    const fileNames = files.map(f => f.name).join(', ');

    showToast(`🔄 ${files.length}개 파일 업로드 및 통합 분석 처리 중...`);
    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });

        let res;
        const respText = await response.text();
        try {
            res = JSON.parse(respText);
        } catch (e) {
            console.error("서버 응답 JSON 파싱 실패:", respText);
            showToast(`업로드 서버 오류 (${response.status}): ${respText.substring(0, 120)}`, 'ERROR');
            return;
        }

        if (response.ok && res.success) {
            const warnMsg = res.parse_warnings && res.parse_warnings.length > 0 ? ` (주의: ${res.parse_warnings.length}개 파일 경고)` : '';
            showToast(`✅ ${res.files_count}개 파일 업로드 완료! 총 ${res.total_rows}행 데이터 통합 분석 성공.${warnMsg}`);
            handleUploadSuccess(res);
            // 달력 색상 새로고침
            fetchManualAvailableDates();
        } else {
            const errMsg = res.detail || res.message || '오류 발생';
            showToast(`업로드 실패: ${errMsg}`, 'ERROR');
        }
    } catch (err) {
        showToast(`업로드 에러: ${err.message}`, 'ERROR');
    }
}

function handleUploadSuccess(res) {
    if (res.reports && res.series_5m) {
        CURRENT_ANALYSIS_DATA = res;
        const selectedOutlet = document.getElementById('outlet-select')?.value || 'ALL';
        renderMetricCards(res.reports[selectedOutlet] || {});
        renderIntegratedChart(res.series_5m, CURRENT_PARAM);
        renderAlarmTable(res.all_alarms || []);
        
        const rawOutletFilter = document.getElementById('raw-outlet-select')?.value || 'ALL';
        renderRawDataTable(res.series_5m, res.all_alarms || [], rawOutletFilter);

        initParamButtons();
        initRawDataTable();
    } else {
        loadAnalysisData();
    }
}

const PLANT_REGISTRY_DATA = {
    "강원도": {
        "삼척시": ["한국남부발전(주) 삼척빛드림본부", "삼척시 자원회수시설"],
        "강릉시": ["한국남부발전(주) 강릉발전본부", "강릉시 자원순환센터"],
        "동해시": ["한국동서발전(주) 동해발전본부", "쌍용C&E(주) 동해공장"],
        "원주시": ["원주시 자원정보센터"],
        "춘천시": ["춘천시 자원순환센터"]
    },
    "서울특별시": {
        "강남구": ["강남자원회수시설"],
        "노원구": ["노원자원회수시설"],
        "마포구": ["마포자원회수시설"],
        "양천구": ["양천자원회수시설"]
    },
    "경기도": {
        "평택시": ["한국서부발전(주) 평택발전본부"],
        "화성시": ["화성시 환경자원센터"],
        "용인시": ["용인시 환경센터"],
        "성남시": ["성남자원회수시설"],
        "수원시": ["수원시 자원회수시설"],
        "부천시": ["부천시 자원순환센터"]
    },
    "충청남도": {
        "보령시": ["한국중부발전(주) 보령발전본부"],
        "태안군": ["한국서부발전(주) 태안발전본부"],
        "당진시": ["한국동서발전(주) 당진발전본부"],
        "서천군": ["한국중부발전(주) 신서천발전본부"]
    },
    "충청북도": {
        "청주시": ["청주시 자원관리시설"],
        "충주시": ["충주시 클린에너지파크"]
    },
    "인천광역시": {
        "서구": ["한국남부발전(주) 신인천빛드림본부", "한국중부발전(주) 인천발전본부", "청라자원회수시설"],
        "연수구": ["송도자원회수시설"]
    },
    "경상남도": {
        "하동군": ["한국남부발전(주) 하동빛드림본부"],
        "고성군": ["한국남부발전(주) 고성하일발전"],
        "창원시": ["창원시 성산자원회수시설"]
    },
    "경상북도": {
        "포항시": ["포항시 자원순환시설"],
        "경주시": ["경주시 자원회수시설"],
        "구미시": ["구미시 환경자원화시설"]
    },
    "전라남도": {
        "여수시": ["한국남동발전(주) 여수발전본부"],
        "순천시": ["순천시 자원순환센터"],
        "광양시": ["광양시 자원화시설"]
    },
    "전라북도": {
        "전주시": ["전주시 광역자원음식물류폐기물 처리시설"],
        "군산시": ["군산시 폐기물처리시설"]
    },
    "부산광역시": {
        "사하구": ["한국남부발전(주) 부산빛드림본부"],
        "해운대구": ["해운대 자원회수시설"],
        "강서구": ["부산시 생곡자원순환타운"]
    },
    "울산광역시": {
        "남구": ["한국동서발전(주) 울산발전본부", "울산성암자원회수시설"]
    },
    "대구광역시": {
        "달서구": ["대구시 성서자원회수시설"]
    },
    "광주광역시": {
        "서구": ["광주시 가열성폐기물 연료화시설"]
    },
    "대전광역시": {
        "대덕구": ["대전시 신일동 자원회수시설"]
    },
    "세종특별자치시": {
        "세종시": ["세종시 수질복원센터"]
    },
    "제주특별자치도": {
        "제주시": ["제주 봉개자원회수시설"],
        "서귀포시": ["서귀포시 색달자원회수시설"]
    }
};

function initDatePickers() {
    const startInput = document.getElementById('date-start');
    const endInput = document.getElementById('date-end');
    const btnQuick24h = document.getElementById('btn-quick-24h');
    if (!startInput || !endInput) return;

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const formatDate = (d) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    startInput.value = formatDate(yesterday);
    endInput.value = formatDate(today);

    const autoStartInput = document.getElementById('auto-date-start');
    const autoEndInput = document.getElementById('auto-date-end');
    const btnAutoQuery = document.getElementById('btn-auto-query');
    if (autoStartInput && autoEndInput) {
        autoStartInput.value = formatDate(today);
        autoEndInput.value = formatDate(today);

        autoStartInput.addEventListener('click', () => triggerPicker(autoStartInput));
        autoEndInput.addEventListener('click', () => triggerPicker(autoEndInput));

        if (btnAutoQuery) {
            btnAutoQuery.addEventListener('click', () => loadAutoAnalysisData());
        }
    }

    // 날짜 입력창 클릭 시 브라우저 네이티브 달력 팝업 오픈 지원
    const triggerPicker = (inputEl) => {
        if (inputEl && typeof inputEl.showPicker === 'function') {
            try { inputEl.showPicker(); } catch (e) {}
        }
    };

    startInput.addEventListener('click', () => triggerPicker(startInput));
    endInput.addEventListener('click', () => triggerPicker(endInput));

    startInput.addEventListener('change', () => loadAnalysisData());
    endInput.addEventListener('change', () => loadAnalysisData());

    // '24시간 데이터 조회' 전용 버튼 클릭 시: 전일 08:00 ~ 금일 08:00 날짜 리셋 후 수집 실행
    if (btnQuick24h) {
        btnQuick24h.addEventListener('click', () => {
            startInput.value = formatDate(yesterday);
            endInput.value = formatDate(today);
            showToast("⏱️ [전일 08:00 ~ 금일 08:00] 24시간 실시간 데이터를 조회합니다.");
            
            const btnFetch = document.getElementById('btn-fetch-cleansys');
            if (btnFetch) {
                btnFetch.click();
            } else {
                loadAnalysisData();
            }
        });
    }
}

// 2-1. CleanSYS Open API Cascade Combo Box Selection & Date Range Fetch
function initCleanSysAPI() {
    populateRegions();

    const regionSelect = document.getElementById('combo-region');
    const subregionSelect = document.getElementById('combo-subregion');
    const plantSelect = document.getElementById('combo-plant');
    const btn = document.getElementById('btn-fetch-cleansys');

    regionSelect.addEventListener('change', () => {
        populateSubregions(regionSelect.value);
    });

    subregionSelect.addEventListener('change', () => {
        populatePlants(regionSelect.value, subregionSelect.value);
    });

    btn.addEventListener('click', async () => {
        const region = regionSelect.value;
        const subregion = subregionSelect.value;
        const plant = plantSelect.value;
        const startDate = document.getElementById('date-start').value;
        const endDate = document.getElementById('date-end').value;

        let searchPlant = plant;
        if (plant.includes("한국남부발전")) searchPlant = "한국남부발전";
        else if (plant.includes("한국동서발전")) searchPlant = "한국동서발전";
        else if (plant.includes("한국서부발전")) searchPlant = "한국서부발전";
        else if (plant.includes("한국중부발전")) searchPlant = "한국중부발전";
        else if (plant.includes("한국남동발전")) searchPlant = "한국남동발전";

        showToast(`📡 [${region} ${subregion}] ${plant} (${startDate} ~ ${endDate}) 데이터 수집 중...`);

        const formData = new FormData();
        formData.append('area_nm', region);
        formData.append('fact_manage_nm', searchPlant);
        formData.append('start_date', startDate);
        formData.append('end_date', endDate);

        try {
            const res = await fetch('/api/cleansys/fetch', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();

            if (data.success) {
                const sourceText = data.source === 'GOOGLE_SHEETS' ? '📑 구글 시트 저장 데이터 로드' : '📡 CleanSYS Open API 실시간 수집 및 시트 저장';
                showToast(`✅ [${plant}] ${sourceText} 시각화 완료!`);
                CURRENT_ANALYSIS_DATA = data;
                
                const selectedOutlet = document.getElementById('outlet-select').value || '배출구 1';
                renderMetricCards(data.reports[selectedOutlet] || {});
                renderIntegratedChart(data.series_5m, CURRENT_PARAM);
                renderAlarmTable(data.all_alarms);
                
                const rawOutletFilter = document.getElementById('raw-outlet-select').value || 'ALL';
                renderRawDataTable(data.series_5m, data.all_alarms, rawOutletFilter);
            } else {
                const errMsg = data.message || data.detail || '응답 데이터 처리 중 오류 발생';
                showToast(`⚠️ CleanSYS API: ${errMsg}`, 'WARNING');
            }
        } catch (err) {
            showToast(`API 통신 에러: ${err.message}`, 'ERROR');
        }
    });
}

function populateRegions() {
    const regionSelect = document.getElementById('combo-region');
    if (!regionSelect) return;
    regionSelect.innerHTML = '';

    const regions = Object.keys(PLANT_REGISTRY_DATA);
    regions.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r;
        opt.textContent = r;
        regionSelect.appendChild(opt);
    });

    if (regions.includes('강원도')) {
        regionSelect.value = '강원도';
    }
    populateSubregions(regionSelect.value);
}

function populateSubregions(region) {
    const subregionSelect = document.getElementById('combo-subregion');
    if (!subregionSelect) return;
    subregionSelect.innerHTML = '';

    const subregionsObj = PLANT_REGISTRY_DATA[region] || {};
    const subregions = Object.keys(subregionsObj);

    subregions.forEach(sr => {
        const opt = document.createElement('option');
        opt.value = sr;
        opt.textContent = sr;
        subregionSelect.appendChild(opt);
    });

    if (subregions.includes('삼척시')) {
        subregionSelect.value = '삼척시';
    } else if (subregions.length > 0) {
        subregionSelect.value = subregions[0];
    }
    populatePlants(region, subregionSelect.value);
}

function populatePlants(region, subregion) {
    const plantSelect = document.getElementById('combo-plant');
    if (!plantSelect) return;
    plantSelect.innerHTML = '';

    const plants = (PLANT_REGISTRY_DATA[region] && PLANT_REGISTRY_DATA[region][subregion]) || [];

    plants.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        plantSelect.appendChild(opt);
    });

    const defaultPlant = plants.find(p => p.includes('삼척빛드림본부'));
    if (defaultPlant) {
        plantSelect.value = defaultPlant;
    } else if (plants.length > 0) {
        plantSelect.value = plants[0];
    }
}

// 3. Outlet Selector
function initOutletSelector() {
    const selector = document.getElementById('outlet-select');
    if (!selector) return;
    selector.addEventListener('change', (e) => {
        const val = e.target.value;
        if (CURRENT_ANALYSIS_DATA && CURRENT_ANALYSIS_DATA.series_5m) {
            renderMetricCards(CURRENT_ANALYSIS_DATA.reports ? CURRENT_ANALYSIS_DATA.reports[val] : {});
            renderIntegratedChart(CURRENT_ANALYSIS_DATA.series_5m, CURRENT_PARAM);
            const rawOutletFilter = document.getElementById('raw-outlet-select')?.value || 'ALL';
            renderRawDataTable(CURRENT_ANALYSIS_DATA.series_5m, CURRENT_ANALYSIS_DATA.all_alarms || [], rawOutletFilter);
        }
    });
}

let CURRENT_ANALYSIS_DATA = null;
let CURRENT_PARAM = 'TSP';

// 4. Load & Render Analysis Data (All 5 Outlets Integrated)
async function loadAnalysisData() {
    try {
        const startInput = document.getElementById('date-start');
        const endInput = document.getElementById('date-end');
        let queryParams = '';
        if (startInput && endInput && startInput.value && endInput.value) {
            queryParams = `?start_date=${encodeURIComponent(startInput.value)}&end_date=${encodeURIComponent(endInput.value)}`;
        }

        const res = await fetch(`/api/analysis${queryParams}`);
        const data = await res.json();
        
        if (data.success) {
            CURRENT_ANALYSIS_DATA = data;
            
            const selectedOutlet = document.getElementById('outlet-select').value || '배출구 1';
            renderMetricCards(data.reports[selectedOutlet] || {});
            renderIntegratedChart(data.series_5m, CURRENT_PARAM);
            renderAlarmTable(data.all_alarms);
            
            // 24시간 5분 데이터 수집 표 렌더링
            const rawOutletFilter = document.getElementById('raw-outlet-select').value || 'ALL';
            renderRawDataTable(data.series_5m, data.all_alarms, rawOutletFilter);

            initParamButtons();
            initRawDataTable();
        }
    } catch (err) {
        console.error("데이터 로드 오류:", err);
    }
}

function initRawDataTable() {
    const btnToggle = document.getElementById('btn-toggle-rawtable');
    const wrapper = document.getElementById('raw-table-wrapper');
    const toggleIcon = document.getElementById('toggle-icon');
    const btnText = btnToggle.querySelector('span');
    const rawOutletSelect = document.getElementById('raw-outlet-select');

    btnToggle.onclick = () => {
        if (wrapper.classList.contains('collapsed')) {
            wrapper.classList.remove('collapsed');
            wrapper.classList.add('expanded');
            toggleIcon.className = 'fa-solid fa-chevron-up';
            btnText.textContent = '24시간 데이터 접기';
        } else {
            wrapper.classList.remove('expanded');
            wrapper.classList.add('collapsed');
            toggleIcon.className = 'fa-solid fa-chevron-down';
            btnText.textContent = '24시간 데이터 펼치기';
        }
    };

    rawOutletSelect.onchange = () => {
        if (CURRENT_ANALYSIS_DATA) {
            renderRawDataTable(CURRENT_ANALYSIS_DATA.series_5m, CURRENT_ANALYSIS_DATA.all_alarms, rawOutletSelect.value);
        }
    };
}

function renderRawDataTable(series5m, alarms, filterOutlet) {
    const tbody = document.getElementById('raw-tbody');
    tbody.innerHTML = '';

    if (!series5m || series5m.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="empty-row">수집된 5분 데이터가 없습니다. 상단에서 API 수집 버튼을 눌러주세요.</td></tr>`;
        return;
    }

    const alarmMap = {};
    if (alarms) {
        alarms.forEach(a => {
            const key = `${a.timestamp}_${a.outlet}_${a.factor}`;
            alarmMap[key] = a.level;
            if (a.factor === 'ALL' || a.factor === 'STOP_MONITOR') {
                alarmMap[`${a.timestamp}_${a.outlet}_ALL`] = a.level;
            }
        });
    }

    let filtered = series5m;
    if (filterOutlet !== 'ALL') {
        filtered = series5m.filter(s => s.outlet === filterOutlet);
    }

    const fragment = document.createDocumentFragment();

    filtered.forEach(row => {
        const tr = document.createElement('tr');
        const ts = row.timestamp || '';
        const out = row.outlet || '';
        const state = row.O2 >= 19.5 ? '정지' : '운전';
        const stateBadge = state === '정지' ? '<span class="badge badge-secondary">정지</span>' : '<span class="badge badge-success">운전</span>';

        // 계측기 상태 (정상, 보수, 불량 등) 뱃지 및 구별 스타일링
        const rawStatus = row.status || (state === '정지' ? '정지' : '정상');
        let statusBadge = `<span class="badge badge-success">정상</span>`;
        let statusCellClass = '';

        if (rawStatus.includes('보수')) {
            statusBadge = `<span class="badge badge-warning" style="background: rgba(245, 158, 11, 0.25); color: #fef08a; border: 1px solid #f59e0b;"><i class="fa-solid fa-wrench"></i> ${rawStatus}</span>`;
            statusCellClass = 'cell-alarm-warning';
        } else if (rawStatus.includes('불량') || rawStatus.includes('결측')) {
            statusBadge = `<span class="badge badge-critical"><i class="fa-solid fa-bug"></i> ${rawStatus}</span>`;
            statusCellClass = 'cell-alarm-critical';
        } else if (rawStatus.includes('점검') || rawStatus.includes('자료확인')) {
            statusBadge = `<span class="badge badge-warning" style="background: rgba(245, 158, 11, 0.25); color: #fef08a; border: 1px solid #f59e0b;"><i class="fa-solid fa-wrench"></i> ${rawStatus}</span>`;
            statusCellClass = 'cell-alarm-warning';
        } else if (rawStatus === '정지') {
            statusBadge = `<span class="badge badge-secondary">정지</span>`;
        }

        function renderFactorCell(factor, rawVal, decimals = 2, isInt = false) {
            const factorSt = String(row[`${factor}_status`] || '').trim();
            
            let alarmCls = alarmMap[`${ts}_${out}_${factor}`] || alarmMap[`${ts}_${out}_ALL`];
            let cellClass = alarmCls === 'CRITICAL' ? 'cell-alarm-critical' : (alarmCls === 'WARNING' ? 'cell-alarm-warning' : '');
            
            let maintBadge = '';
            if (/보수/i.test(factorSt)) {
                if (!cellClass) cellClass = 'cell-alarm-warning';
                maintBadge = ` <span class="badge badge-warning" style="font-size: 0.72rem; padding: 2px 5px; margin-left: 4px; background: rgba(245, 158, 11, 0.25); color: #fef08a; border: 1px solid #f59e0b;"><i class="fa-solid fa-wrench"></i> 보수중</span>`;
            } else if (/점검|자료확인/i.test(factorSt)) {
                if (!cellClass) cellClass = 'cell-alarm-warning';
                maintBadge = ` <span class="badge badge-warning" style="font-size: 0.72rem; padding: 2px 5px; margin-left: 4px; background: rgba(245, 158, 11, 0.25); color: #fef08a; border: 1px solid #f59e0b;"><i class="fa-solid fa-wrench"></i> 점검중</span>`;
            }

            let numStr = (rawVal !== undefined && rawVal !== null && !isNaN(rawVal)) 
                ? (isInt ? Math.round(Number(rawVal)).toLocaleString() : Number(rawVal).toFixed(decimals))
                : (isInt ? '0' : '0.00');

            return `<td class="${cellClass}">${numStr}${maintBadge}</td>`;
        }

        tr.innerHTML = `
            <td>${ts}</td>
            <td><strong>${out}</strong></td>
            <td>${stateBadge}</td>
            ${renderFactorCell('TSP', row.TSP, 2, false)}
            ${renderFactorCell('NOX', row.NOX, 2, false)}
            ${renderFactorCell('SOX', row.SOX, 2, false)}
            ${renderFactorCell('O2', row.O2, 2, false)}
            ${renderFactorCell('Flow', row.Flow, 0, true)}
            ${renderFactorCell('Temp', row.Temp, 1, false)}
        `;
        fragment.appendChild(tr);
    });

    tbody.appendChild(fragment);
}

function initParamButtons() {
    const btns = document.querySelectorAll('.param-btn');
    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            btns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            CURRENT_PARAM = btn.dataset.param;
            if (CURRENT_ANALYSIS_DATA) {
                renderIntegratedChart(CURRENT_ANALYSIS_DATA.series_5m, CURRENT_PARAM);
            }
        });
    });
}

function renderMetricCards(report) {
    const selectedOutlet = document.getElementById('outlet-select')?.value || 'ALL';
    const allOutlets = ["배출구 1", "배출구 2", "배출구 3", "배출구 4", "배출구 5"];
    const statusElem = document.getElementById('val-status');
    const hoursElem = document.getElementById('val-op-hours');
    
    // 배출구별 최신 실시간 데이터 및 물리 상태(O2, Flow, Temp) 판별
    const latestStatusByOutlet = {};
    if (CURRENT_ANALYSIS_DATA && CURRENT_ANALYSIS_DATA.series_5m) {
        allOutlets.forEach(out => {
            const outRows = CURRENT_ANALYSIS_DATA.series_5m.filter(s => s.outlet === out);
            if (outRows && outRows.length > 0) {
                // 타임스탬프 파싱 기반 실제 최신 측정 행 타겟팅
                const parseTs = (tsStr) => {
                    if (!tsStr) return 0;
                    const cleanStr = String(tsStr).replace(/\./g, '-').replace('오전', 'AM').replace('오후', 'PM');
                    const d = new Date(cleanStr);
                    return isNaN(d.getTime()) ? 0 : d.getTime();
                };

                const latestRow = outRows.reduce((a, b) => parseTs(a.timestamp) >= parseTs(b.timestamp) ? a : b);
                
                const parseNum = v => (v === undefined || v === null || v === '' || isNaN(v)) ? null : Number(v);
                const o2 = parseNum(latestRow.O2);
                const flow = parseNum(latestRow.Flow);
                const temp = parseNum(latestRow.Temp);
                const rowStr = Object.values(latestRow).map(v => String(v || '')).join(' ');

                // 설비 운전상태 물리적 조건 판별 (점검중 제외: 가동정지 vs 정상운전중)
                if (o2 !== null && o2 >= 19.5) {
                    latestStatusByOutlet[out] = '가동정지';
                } else if (flow !== null && flow <= 100) {
                    latestStatusByOutlet[out] = '가동정지';
                } else if (temp !== null && temp <= 30) {
                    latestStatusByOutlet[out] = '가동정지';
                } else if (/가동중지|가동 중지|미운전|정지|STOP/i.test(rowStr)) {
                    latestStatusByOutlet[out] = '가동정지';
                } else {
                    latestStatusByOutlet[out] = '정상 운전 중';
                }
            } else {
                // 데이터가 전혀 없는 배출구 -> 데이터 없음
                latestStatusByOutlet[out] = 'NO_DATA';
            }
        });
    }

    const formatStatus = (st) => {
        if (st === 'NO_DATA' || !st) {
            return { icon: '⚪', label: '데이터 없음 (미수집)' };
        }
        if (st.includes('정지')) {
            return { icon: '🔴', label: '가동정지' };
        }
        return { icon: '🟢', label: '정상 운전 중' };
    };

    if (selectedOutlet === 'ALL' && CURRENT_ANALYSIS_DATA && CURRENT_ANALYSIS_DATA.reports) {
        const reps = Object.values(CURRENT_ANALYSIS_DATA.reports);
        const tspArr = reps.map(r => r.avg_tsp).filter(v => v !== undefined && v !== null);
        const noxArr = reps.map(r => r.avg_nox).filter(v => v !== undefined && v !== null);
        const soxArr = reps.map(r => r.avg_sox).filter(v => v !== undefined && v !== null);
        const mean = arr => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : '--';
        
        if (statusElem) {
            const statusLines = allOutlets.map(out => {
                const rawSt = latestStatusByOutlet[out];
                const { icon, label } = formatStatus(rawSt);
                return `${out}: ${icon} ${label}`;
            });
            statusElem.innerHTML = statusLines.map(l =>
                `<span style="display:block;font-size:0.82rem;line-height:1.8;">${l}</span>`
            ).join('');
            statusElem.style.fontSize = '0.82rem';
        }
        if (hoursElem) hoursElem.textContent = '전체 5개 배출구 실시간 설비 상태';

        document.getElementById('val-tsp').textContent = mean(tspArr);
        document.getElementById('val-nox').textContent = mean(noxArr);
        document.getElementById('val-sox').textContent = mean(soxArr);
    } else {
        report = report || {};
        const rawSt = latestStatusByOutlet[selectedOutlet] || 'NO_DATA';
        const { icon, label } = formatStatus(rawSt);
        if (statusElem) {
            statusElem.textContent = `${icon} ${label}`;
            statusElem.style.fontSize = '';
        }
        if (hoursElem) {
            hoursElem.textContent = rawSt === 'NO_DATA' ? '해당 배출구 데이터 없음' : `운전 ${report.operating_hours || 0}h / 정지 ${report.stop_hours || 0}h`;
        }
        document.getElementById('val-tsp').textContent = report.avg_tsp !== undefined ? report.avg_tsp : '--';
        document.getElementById('val-nox').textContent = report.avg_nox !== undefined ? report.avg_nox : '--';
        document.getElementById('val-sox').textContent = report.avg_sox !== undefined ? report.avg_sox : '--';
    }

    const valBox = document.getElementById('val-validation');
    const valRes = CURRENT_ANALYSIS_DATA ? CURRENT_ANALYSIS_DATA.validation : null;
    
    if (valBox) {
        if (valRes) {
            if (valRes.status === 'MATCH') {
                valBox.innerHTML = `<span style="color: var(--accent-emerald); font-weight: 600;"><i class="fa-solid fa-circle-check"></i> 일치 검증 완료</span>`;
            } else if (valRes.status === 'MISMATCH') {
                valBox.innerHTML = `<span style="color: var(--accent-amber); font-weight: 600;"><i class="fa-solid fa-triangle-exclamation"></i> ${valRes.status_message || '불일치'}</span>`;
            } else if (valRes.status === 'MISSING_5M') {
                valBox.innerHTML = `<span style="color: #cbd5e1; font-weight: 500;"><i class="fa-solid fa-circle-minus"></i> 5분 데이터 누락</span>`;
            } else if (valRes.status === 'MISSING_30M') {
                valBox.innerHTML = `<span style="color: #cbd5e1; font-weight: 500;"><i class="fa-solid fa-circle-minus"></i> 30분 데이터 누락</span>`;
            } else {
                valBox.innerHTML = `<span style="color: var(--accent-emerald); font-weight: 600;">${valRes.status_message || '일치 검증 완료'}</span>`;
            }
        } else {
            valBox.innerHTML = `<span style="color: var(--accent-emerald); font-weight: 600;"><i class="fa-solid fa-circle-check"></i> 일치 검증 완료</span>`;
        }
    }
}

// 5. Single Integrated Chart.js Rendering for ALL 5 Outlets (배출구 1~5)
function renderIntegratedChart(series5m, param) {
    const ctx = document.getElementById('stackChart').getContext('2d');
    
    if (!series5m || series5m.length === 0) return;

    const outlets = ["배출구 1", "배출구 2", "배출구 3", "배출구 4", "배출구 5"];
    const colors = {
        "배출구 1": "#10b981", // Emerald
        "배출구 2": "#06b6d4", // Cyan
        "배출구 3": "#6366f1", // Indigo
        "배출구 4": "#f59e0b", // Amber
        "배출구 5": "#f43f5e"  // Rose
    };

    // 전체 고유 타임스탬프 추출 (특정 배출구 존재 여부와 상관없이 차트 X축 보장)
    const rawTimestamps = Array.from(new Set(series5m.map(s => s.timestamp || ''))).filter(Boolean).sort();

    // 날짜 범위 및 멀티일자 여부 판별
    const dateSet = new Set(rawTimestamps.map(ts => ts.substring(0, 10)));
    const isMultiDay = dateSet.size > 1;
    const isThreeDaysOrMore = dateSet.size >= 3;

    let chartSeriesData = series5m;
    let chartTimestamps = rawTimestamps;

    // 3일 이상 복수 날짜 조회 시: 30분 간격 리샘플링 적용 (평균값 계산)
    if (isThreeDaysOrMore) {
        chartSeriesData = [];

        // 30분 단위 그룹 키 생성 (예: '2026-08-01 14:15:00' -> '2026-08-01 14:00')
        const get30mKey = (ts) => {
            if (!ts) return '';
            const dtStr = ts.substring(0, 14); // 'YYYY-MM-DD HH:'
            const minute = parseInt(ts.substring(14, 16), 10);
            const slot = minute < 30 ? '00' : '30';
            return `${dtStr}${slot}`;
        };

        const grouped = {};
        series5m.forEach(item => {
            const key = `${get30mKey(item.timestamp)}_${item.outlet}`;
            if (!grouped[key]) {
                grouped[key] = {
                    key: get30mKey(item.timestamp),
                    outlet: item.outlet,
                    TSP: [], NOX: [], SOX: [], O2: [], Flow: [], Temp: []
                };
            }
            if (item.TSP !== undefined) grouped[key].TSP.push(item.TSP);
            if (item.NOX !== undefined) grouped[key].NOX.push(item.NOX);
            if (item.SOX !== undefined) grouped[key].SOX.push(item.SOX);
            if (item.O2 !== undefined) grouped[key].O2.push(item.O2);
            if (item.Flow !== undefined) grouped[key].Flow.push(item.Flow);
            if (item.Temp !== undefined) grouped[key].Temp.push(item.Temp);
        });

        const mean = arr => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

        Object.values(grouped).forEach(g => {
            chartSeriesData.push({
                timestamp: `${g.key}:00`,
                outlet: g.outlet,
                TSP: mean(g.TSP),
                NOX: mean(g.NOX),
                SOX: mean(g.SOX),
                O2: mean(g.O2),
                Flow: mean(g.Flow),
                Temp: mean(g.Temp)
            });
        });

        chartSeriesData.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        chartTimestamps = Array.from(new Set(chartSeriesData.map(s => s.timestamp || ''))).filter(Boolean).sort();
    }

    // X축 라벨 포맷팅: 단일일자인 경우 HH:mm, 다중일자인 경우 MM/DD HH:mm
    const timeLabels = chartTimestamps.map(ts => {
        if (!ts) return '';
        if (isMultiDay) {
            const parts = ts.split(' ');
            if (parts.length >= 2) {
                const dateParts = parts[0].split('-');
                return `${dateParts[1]}/${dateParts[2]} ${parts[1].substring(0, 5)}`;
            }
        }
        return ts.substring(11, 16);
    });

    const dateRangeSpan = document.getElementById('chart-date-range');
    if (dateRangeSpan && rawTimestamps.length > 0) {
        const firstDate = rawTimestamps[0].substring(0, 10).replace(/-/g, '.');
        const lastDate = rawTimestamps[rawTimestamps.length - 1].substring(0, 10).replace(/-/g, '.');
        const intervalNotice = isThreeDaysOrMore ? ' [30분 간격 트렌드]' : ' [5분 간격]';
        dateRangeSpan.textContent = `(${firstDate} ~ ${lastDate})${intervalNotice}`;
    }

    const selectedOutlet = document.getElementById('outlet-select')?.value || 'ALL';
    let datasets = [];

    if (selectedOutlet === 'ALL') {
        datasets = outlets.map(out => {
            const outDataMap = {};
            chartSeriesData.filter(s => s.outlet === out).forEach(s => {
                outDataMap[s.timestamp] = s[param];
            });
            const values = chartTimestamps.map(ts => (outDataMap[ts] !== undefined && outDataMap[ts] !== null) ? outDataMap[ts] : null);

            return {
                label: out,
                data: values,
                borderColor: colors[out],
                backgroundColor: 'transparent',
                tension: 0.25,
                borderWidth: isThreeDaysOrMore ? 1.5 : 2,
                pointRadius: isThreeDaysOrMore ? 0.5 : 1,
                pointHoverRadius: 5
            };
        });
    } else {
        const outDataMap = {};
        chartSeriesData.filter(s => s.outlet === selectedOutlet).forEach(s => {
            outDataMap[s.timestamp] = s;
        });

        const factors = [
            { key: "TSP", label: `${selectedOutlet} TSP (mg/m³)`, color: "#ef4444" },
            { key: "NOX", label: `${selectedOutlet} NOX (ppm)`, color: "#0ea5e9" },
            { key: "SOX", label: `${selectedOutlet} SOX (ppm)`, color: "#f59e0b" }
        ];

        datasets = factors.map(f => {
            const values = chartTimestamps.map(ts => {
                const row = outDataMap[ts];
                return (row && row[f.key] !== undefined && row[f.key] !== null) ? row[f.key] : null;
            });
            return {
                label: f.label,
                data: values,
                borderColor: f.color,
                backgroundColor: 'transparent',
                tension: 0.25,
                borderWidth: isThreeDaysOrMore ? 1.5 : 2,
                pointRadius: isThreeDaysOrMore ? 0.5 : 1,
                pointHoverRadius: 5
            };
        });
    }

    if (stackChart) {
        stackChart.destroy();
    }

    stackChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: timeLabels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: { color: '#f1f5f9', font: { family: 'Pretendard', size: 12 } }
                },
                tooltip: {
                    callbacks: {
                        title: function(context) {
                            const index = context[0].dataIndex;
                            const fullTs = rawTimestamps[index] || context[0].label;
                            return `[측정 데이터] 일시: ${fullTs}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8', font: { size: 10 }, maxRotation: 45, minRotation: 0 }
                },
                y: {
                    display: true,
                    title: { display: true, text: `${param} 측정값`, color: '#94a3b8' },
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8' }
                }
            }
        }
    });
}

function renderAlarmTable(alarms) {
    const tbody = document.getElementById('alarm-tbody');
    tbody.innerHTML = '';

    if (!alarms || alarms.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty-row">감지된 이상 신호가 없습니다.</td></tr>`;
        return;
    }

    alarms.forEach(a => {
        const tr = document.createElement('tr');
        const badgeClass = a.level === 'CRITICAL' ? 'badge-critical' : 'badge-warning';
        
        tr.innerHTML = `
            <td>${a.timestamp}</td>
            <td>${a.outlet}</td>
            <td><strong>${a.factor}</strong></td>
            <td><span class="badge ${badgeClass}">${a.alarm_type}</span></td>
            <td>${a.message}</td>
            <td><span class="badge ${badgeClass}">${a.level}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

// 6. Settings & Template
function initSettings() {
    const btnSave = document.getElementById('btn-save-settings');
    if (btnSave) {
        btnSave.onclick = toggleSettingsLock;
    }
    const tmplText = document.getElementById('template-text');
    if (tmplText) {
        tmplText.addEventListener('input', updateTemplatePreview);
    }
}

let _isSettingsUnlocked = false;
let _lastLoadedSettings = null;
let _pinModalTarget = 'page';

function isAdminLoggedIn() {
    return sessionStorage.getItem('tms_admin_logged_in') === 'true';
}

function checkAdminLoginState() {
    const navSettings = document.getElementById('nav-tab-settings');
    const btnAuth = document.getElementById('btn-admin-auth');
    const tabSettings = document.getElementById('tab-settings');
    const tabAnalysis = document.getElementById('tab-analysis');
    const navAnalysis = document.querySelector('.nav-tab[data-tab="tab-analysis"]');

    if (isAdminLoggedIn()) {
        if (navSettings) navSettings.style.display = 'inline-flex';
        if (btnAuth) {
            btnAuth.innerHTML = '<i class="fa-solid fa-shield-halved" style="color:#10b981;"></i> 관리자 로그아웃';
            btnAuth.style.borderColor = 'rgba(16,185,129,0.5)';
            btnAuth.style.background = 'rgba(16,185,129,0.15)';
            btnAuth.style.color = '#a7f3d0';
        }
        updateSettingsUIState();
    } else {
        _isSettingsUnlocked = false;
        if (navSettings) navSettings.style.display = 'none';
        if (btnAuth) {
            btnAuth.innerHTML = '<i class="fa-solid fa-lock"></i> 관리자 로그인';
            btnAuth.style.borderColor = 'rgba(255,255,255,0.15)';
            btnAuth.style.background = '';
            btnAuth.style.color = '';
        }
        // 제3자가 설정 화면에 머무르지 못하도록 Data 분석 화면으로 자동 강제 전환
        if (tabSettings && tabSettings.classList.contains('active')) {
            tabSettings.classList.remove('active');
            if (navSettings) navSettings.classList.remove('active');
            if (tabAnalysis) tabAnalysis.classList.add('active');
            if (navAnalysis) navAnalysis.classList.add('active');
        }
        updateSettingsUIState();
    }
}
window.checkAdminLoginState = checkAdminLoginState;
window.isAdminLoggedIn = isAdminLoggedIn;

function handleAdminAuthClick() {
    if (isAdminLoggedIn()) {
        sessionStorage.removeItem('tms_admin_logged_in');
        _isSettingsUnlocked = false;
        showToast('🔒 관리자 로그아웃 되었습니다. 봇 설정 메뉴가 숨김 처리됩니다.');
        checkAdminLoginState();
    } else {
        openPinModal('page');
    }
}
window.handleAdminAuthClick = handleAdminAuthClick;

function setSettingsFormDisabled(disabled) {
    const inputIds = [
        'bot-token', 'chat-id', 'group-chat-id', 
        'google-sheet-id', 'report-time', 'template-text',
        'limit-val-tsp', 'limit-val-nox', 'limit-val-sox',
        'rule-threshold', 'rule-hunting', 'rule-frozen', 'rule-stop-abnormal', 'rule-missing'
    ];
    inputIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = disabled;
    });
}

function updateSettingsUIState() {
    const btnSave = document.getElementById('btn-save-settings');
    const btnCancel = document.getElementById('btn-cancel-settings');
    const banner = document.getElementById('settings-lock-banner');
    
    if (_isSettingsUnlocked) {
        setSettingsFormDisabled(false);
        if (btnSave) {
            btnSave.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> 설정 저장';
            btnSave.style.background = '#10b981';
            btnSave.style.color = '#fff';
            btnSave.title = '수정된 설정을 영구 저장합니다.';
        }
        if (btnCancel) {
            btnCancel.style.display = 'inline-flex';
        }
        if (banner) {
            banner.innerHTML = '<i class="fa-solid fa-lock-open" style="color:#10b981;"></i> <b style="color:#10b981;">편집 모드 활성화됨 (2차 잠금 해제):</b> 설정값을 수정한 후 <b>[설정 저장]</b>을 누르세요. 취소하려면 <b>[취소]</b>를 누르세요.';
            banner.style.background = 'rgba(16,185,129,0.12)';
            banner.style.border = '1px solid rgba(16,185,129,0.3)';
            banner.style.color = '#a7f3d0';
        }
    } else {
        setSettingsFormDisabled(true);
        if (btnSave) {
            btnSave.innerHTML = '<i class="fa-solid fa-lock"></i> 설정 변경';
            btnSave.style.background = '#f59e0b';
            btnSave.style.color = '#000';
            btnSave.title = '설정을 수정하려면 클릭 후 비밀번호(77137713)를 입력하세요.';
        }
        if (btnCancel) {
            btnCancel.style.display = 'none';
        }
        if (banner) {
            banner.innerHTML = '<i class="fa-solid fa-shield-halved"></i> <b>보안 잠금 상태:</b> 제3자의 변경을 방지하기 위해 비활성화되어 있습니다. 수정하려면 우측 <b>[설정 변경]</b>을 누르세요.';
            banner.style.background = 'rgba(245,158,11,0.12)';
            banner.style.border = '1px solid rgba(245,158,11,0.3)';
            banner.style.color = '#fef08a';
        }
    }
}

function openPinModal(target = 'page') {
    _pinModalTarget = target;
    const modal = document.getElementById('admin-pin-modal');
    const input = document.getElementById('admin-pin-input');
    const err = document.getElementById('pin-error-msg');
    const titleEl = modal?.querySelector('.modal-header h4');
    const descEl = modal?.querySelector('.modal-body p');
    const submitBtn = modal?.querySelector('.modal-footer .btn-primary');

    if (err) err.style.display = 'none';
    if (input) input.value = '';

    if (target === 'settings') {
        if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-key" style="color:var(--accent-amber);"></i> 설정 변경 이중잠금 (2차 인증)';
        if (descEl) descEl.innerHTML = '봇 토큰, Chat ID 등 설정을 수정하려면 <b>관리자 비밀번호(77137713)</b>를 입력하세요.';
        if (submitBtn) submitBtn.innerHTML = '<i class="fa-solid fa-unlock"></i> 잠금 해제 및 수정';
    } else {
        if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-shield-halved" style="color:var(--accent-amber);"></i> 관리자 인증';
        if (descEl) descEl.innerHTML = '텔레그램 봇 설정 및 로그 메뉴에 접근하려면 <b>관리자 비밀번호(77137713)</b>를 입력하세요.';
        if (submitBtn) submitBtn.innerHTML = '<i class="fa-solid fa-lock-open"></i> 관리자 로그인';
    }

    if (modal) {
        modal.style.display = 'flex';
        setTimeout(() => {
            if (input) input.focus();
        }, 150);
    }
}
window.openPinModal = openPinModal;

function closePinModal() {
    const modal = document.getElementById('admin-pin-modal');
    if (modal) modal.style.display = 'none';
}
window.closePinModal = closePinModal;

function verifyAdminPin() {
    const input = document.getElementById('admin-pin-input');
    const err = document.getElementById('pin-error-msg');
    const val = input ? input.value.trim() : '';

    if (val === '77137713') {
        sessionStorage.setItem('tms_admin_logged_in', 'true');
        closePinModal();
        checkAdminLoginState();

        if (_pinModalTarget === 'settings') {
            _isSettingsUnlocked = true;
            updateSettingsUIState();
            showToast('🔓 2차 인증 성공: 설정 입력창이 활성화되었습니다. 수정 후 [설정 저장]을 누르세요.');
            const tokenInput = document.getElementById('bot-token');
            if (tokenInput) tokenInput.focus();
        } else {
            _isSettingsUnlocked = false;
            updateSettingsUIState();
            showToast('🔓 관리자 인증 성공! [Bot 설정 및 로그] 메뉴가 활성화되었습니다.');
            const navSettings = document.getElementById('nav-tab-settings');
            if (navSettings) {
                navSettings.click();
            }
        }
    } else {
        if (err) err.style.display = 'block';
        if (input) {
            input.value = '';
            input.focus();
        }
        showToast('❌ 비밀번호가 올바르지 않습니다. (인증 실패)', 'ERROR');
    }
}
window.verifyAdminPin = verifyAdminPin;

function toggleTokenVisibility() {
    const input = document.getElementById('bot-token');
    const icon = document.getElementById('icon-toggle-token');
    const text = document.getElementById('text-toggle-token');
    if (!input) return;

    if (input.type === 'password') {
        input.type = 'text';
        if (icon) icon.className = 'fa-solid fa-eye-slash';
        if (text) text.textContent = '숨기기';
    } else {
        input.type = 'password';
        if (icon) icon.className = 'fa-solid fa-eye';
        if (text) text.textContent = '보기';
    }
}
window.toggleTokenVisibility = toggleTokenVisibility;

function cancelSettingsEdit() {
    if (_lastLoadedSettings) {
        restoreSettingsValues(_lastLoadedSettings);
    }
    _isSettingsUnlocked = false;
    updateSettingsUIState();
    
    const resultDiv = document.getElementById('settings-save-result');
    if (resultDiv) resultDiv.style.display = 'none';

    showToast('설정 수정이 취소되었습니다. (이전 값 복원)');
}
window.cancelSettingsEdit = cancelSettingsEdit;

async function toggleSettingsLock(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();

    if (_isSettingsUnlocked) {
        // 이미 2차 잠금이 해제된 상태(설정 저장 버튼)에서는 저장 실행
        await saveSettings(e);
    } else {
        // 잠겨있는 상태(설정 변경 버튼)에서는 비밀번호 77137713 입력 요구
        openPinModal('settings');
    }
}
window.toggleSettingsLock = toggleSettingsLock;

function handleSettingsFormSubmit(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (_isSettingsUnlocked) {
        saveSettings(e);
    } else {
        toggleSettingsLock(e);
    }
}
window.handleSettingsFormSubmit = handleSettingsFormSubmit;

function restoreSettingsValues(s) {
    if (!s) return;
    const botTokenInput = document.getElementById('bot-token');
    const chatIdInput = document.getElementById('chat-id');
    const groupChatIdInput = document.getElementById('group-chat-id');
    const sheetIdInput = document.getElementById('google-sheet-id');
    const reportTimeInput = document.getElementById('report-time');
    const templateInput = document.getElementById('template-text');

    if (botTokenInput) botTokenInput.value = s.bot_token || '';
    if (chatIdInput) chatIdInput.value = s.chat_id || '';
    if (groupChatIdInput) groupChatIdInput.value = s.group_chat_id || '';
    if (sheetIdInput) sheetIdInput.value = s.google_sheet_id || '1vmOgz9xh6w5LMg6Oh-yU_-1TNwIuQ8-vIpBAT0IpizY';
    if (reportTimeInput) reportTimeInput.value = s.report_time || '08:30';
    if (templateInput) templateInput.value = s.template || '';

    if (s.limits) {
        if (document.getElementById('limit-val-tsp')) document.getElementById('limit-val-tsp').value = s.limits.TSP || 15.0;
        if (document.getElementById('limit-val-nox')) document.getElementById('limit-val-nox').value = s.limits.NOX || 50.0;
        if (document.getElementById('limit-val-sox')) document.getElementById('limit-val-sox').value = s.limits.SOX || 50.0;
        
        if (document.getElementById('limit-tsp')) document.getElementById('limit-tsp').textContent = s.limits.TSP || 15.0;
        if (document.getElementById('limit-nox')) document.getElementById('limit-nox').textContent = s.limits.NOX || 50.0;
        if (document.getElementById('limit-sox')) document.getElementById('limit-sox').textContent = s.limits.SOX || 50.0;
    }

    if (s.alarm_rules) {
        if (document.getElementById('rule-threshold')) document.getElementById('rule-threshold').checked = s.alarm_rules.THRESHOLD_EXCEEDED !== false;
        if (document.getElementById('rule-hunting')) document.getElementById('rule-hunting').checked = s.alarm_rules.HUNTING !== false;
        if (document.getElementById('rule-frozen')) document.getElementById('rule-frozen').checked = s.alarm_rules.FROZEN_DATA !== false;
        if (document.getElementById('rule-stop-abnormal')) document.getElementById('rule-stop-abnormal').checked = s.alarm_rules.STOP_ABNORMAL !== false;
        if (document.getElementById('rule-missing')) document.getElementById('rule-missing').checked = s.alarm_rules.MISSING_DATA !== false;
    }
    updateTemplatePreview();
}

async function loadSettings() {
    try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        
        // 로컬 백업 확인 (서버 데이터가 비어있을 때 안전 복구용)
        let localBackup = null;
        try {
            const localBackupStr = localStorage.getItem('tms_settings_backup');
            if (localBackupStr) localBackup = JSON.parse(localBackupStr);
        } catch(e) {}

        const fallbackToken = "8884948638:AAFcZ84AOIWY4qJfbRW4estBjHY0-vlbxyk";
        const fallbackChatId = "8899508631";

        if (data.success && data.settings) {
            const s = data.settings;
            const finalBotToken = (s.bot_token && String(s.bot_token).trim()) || (localBackup && localBackup.bot_token) || fallbackToken;
            const finalChatId = (s.chat_id && String(s.chat_id).trim()) || (localBackup && localBackup.chat_id) || fallbackChatId;
            const finalGroupChatId = (s.group_chat_id && String(s.group_chat_id).trim()) || (localBackup && localBackup.group_chat_id) || '';
            const finalSheetId = s.google_sheet_id || (localBackup && localBackup.google_sheet_id) || '1vmOgz9xh6w5LMg6Oh-yU_-1TNwIuQ8-vIpBAT0IpizY';
            const finalReportTime = s.report_time || (localBackup && localBackup.report_time) || '08:30';
            const finalTemplate = s.template || (localBackup && localBackup.template) || '';

            _lastLoadedSettings = {
                bot_token: finalBotToken,
                chat_id: finalChatId,
                group_chat_id: finalGroupChatId,
                google_sheet_id: finalSheetId,
                report_time: finalReportTime,
                template: finalTemplate,
                limits: s.limits || { TSP: 15.0, NOX: 50.0, SOX: 50.0 },
                alarm_rules: s.alarm_rules || {
                    THRESHOLD_EXCEEDED: true,
                    HUNTING: true,
                    FROZEN_DATA: true,
                    STOP_ABNORMAL: true,
                    MISSING_DATA: true
                }
            };

            restoreSettingsValues(_lastLoadedSettings);

            // 로컬 백업 갱신
            try {
                localStorage.setItem('tms_settings_backup', JSON.stringify(_lastLoadedSettings));
            } catch(e) {}
        }
        updateSettingsUIState();
        updateTemplatePreview();
    } catch (err) {
        console.error("설정 로드 오류:", err);
    }
}

async function saveSettings(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();

    const btn = document.getElementById('btn-save-settings');
    const resultDiv = document.getElementById('settings-save-result');

    const botTokenVal = document.getElementById('bot-token')?.value?.trim() || '';
    const chatIdVal = document.getElementById('chat-id')?.value?.trim() || '';
    const groupChatIdVal = document.getElementById('group-chat-id')?.value?.trim() || '';
    const sheetIdVal = document.getElementById('google-sheet-id')?.value?.trim() || '';
    const reportTimeVal = document.getElementById('report-time')?.value || '08:30';
    const templateVal = document.getElementById('template-text')?.value || '';
    const tspVal = parseFloat(document.getElementById('limit-val-tsp')?.value) || 15.0;
    const noxVal = parseFloat(document.getElementById('limit-val-nox')?.value) || 50.0;
    const soxVal = parseFloat(document.getElementById('limit-val-sox')?.value) || 50.0;

    const alarmRules = {
        THRESHOLD_EXCEEDED: document.getElementById('rule-threshold')?.checked ?? true,
        HUNTING: document.getElementById('rule-hunting')?.checked ?? true,
        FROZEN_DATA: document.getElementById('rule-frozen')?.checked ?? true,
        STOP_ABNORMAL: document.getElementById('rule-stop-abnormal')?.checked ?? true,
        MISSING_DATA: document.getElementById('rule-missing')?.checked ?? true
    };

    const payload = {
        bot_token: botTokenVal,
        chat_id: chatIdVal,
        group_chat_id: groupChatIdVal,
        google_sheet_id: sheetIdVal,
        report_time: reportTimeVal,
        template: templateVal,
        limits: {
            TSP: tspVal,
            NOX: noxVal,
            SOX: soxVal
        },
        alarm_rules: alarmRules
    };

    // 로컬스토리지 백업에 즉시 안전 저장
    try {
        localStorage.setItem('tms_settings_backup', JSON.stringify(payload));
    } catch(e) {}

    // 버튼 로딩 상태
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 저장 중...'; }
    if (resultDiv) {
        resultDiv.style.display = 'block';
        resultDiv.innerHTML = `<div style="padding:10px 14px;background:rgba(6,182,212,0.12);border:1px solid rgba(6,182,212,0.3);border-radius:8px;color:var(--accent-cyan);font-size:0.87rem;"><i class="fa-solid fa-spinner fa-spin"></i> 구글 시트 및 시스템 설정 저장 중...</div>`;
    }

    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.success) {
            if (resultDiv) {
                resultDiv.style.display = 'block';
                resultDiv.innerHTML = `<div style="padding:10px 14px;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.35);border-radius:8px;color:var(--accent-emerald);font-size:0.87rem;"><i class="fa-solid fa-circle-check"></i> <b>설정 저장 완료!</b> 변경된 설정이 구글 시트에 안전하게 영구 보존되었습니다.</div>`;
            }
            showToast('✅ Bot 및 알림 설정이 성공적으로 저장되었습니다.');
            _isSettingsUnlocked = false; // 저장 완료 후 이중잠금 재활성화!
            _lastLoadedSettings = payload;
            updateSettingsUIState();
            loadSettings();
            loadLogs();
        } else {
            const msg = data.message || '저장 실패';
            if (resultDiv) {
                resultDiv.style.display = 'block';
                resultDiv.innerHTML = `<div style="padding:10px 14px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);border-radius:8px;color:#fca5a5;font-size:0.87rem;"><i class="fa-solid fa-triangle-exclamation"></i> <b>저장 실패:</b> ${msg}</div>`;
            }
            showToast(`저장 실패: ${msg}`, 'ERROR');
        }
    } catch (err) {
        if (resultDiv) {
            resultDiv.style.display = 'block';
            resultDiv.innerHTML = `<div style="padding:10px 14px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);border-radius:8px;color:#fca5a5;font-size:0.87rem;"><i class="fa-solid fa-circle-xmark"></i> <b>통신 오류:</b> ${err.message}</div>`;
        }
        showToast(`저장 오류: ${err.message}`, 'ERROR');
    } finally {
        if (btn) { btn.disabled = false; }
        updateSettingsUIState();
    }
}
window.saveSettings = saveSettings;

function insertTag(tag) {
    if (!_isSettingsUnlocked) {
        showToast('설정을 변경하려면 먼저 [설정 변경] 버튼을 눌러 이중잠금을 해제해주세요.', 'WARNING');
        openPinModal('settings');
        return;
    }
    const textarea = document.getElementById('template-text');
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;

    textarea.value = text.substring(0, start) + tag + text.substring(end);
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = start + tag.length;
    updateTemplatePreview();
}
window.insertTag = insertTag;

function updateTemplatePreview() {
    const previewEl = document.getElementById('template-live-preview');
    if (!previewEl) return;

    let tmpl = document.getElementById('template-text')?.value || '';
    if (!tmpl.trim()) {
        tmpl = `[한국남부발전 삼척빛드림본부] 굴뚝 TMS 일일 모니터링 리포트\n기준일자: {날짜}\n\n[30분 데이터 수신 현황]\n{30분데이터수신상태}\n\n[배출구별 24시간 가동 현황]\n{배출구별상태}\n\n[배출구별 평균 농도 (mg/m³, ppm)]\n{배출구별평균}\n\n[이상 징후 감지 내역 (총 {이상신호건수})]\n{이상신호내역}\n\n* 본 메시지는 삼척빛드림본부 굴뚝 자동감시 시스템에서 자동 생성되었습니다.`;
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const mockStatus = '🟢 정상 수신 중 (최근: 08:30 / 금일 18회 누적)';
    const mockOutletsStatus = 
`[배출구 1] 🟢 정상 운전 중 (운전 24.0h)
[배출구 2] 🔴 가동정지 (정지 24.0h)
[배출구 3] 🟢 정상 운전 중 (운전 24.0h)
[배출구 4] 🟢 정상 운전 중 (운전 24.0h)
[배출구 5] 🟢 정상 운전 중 (운전 24.0h)`;
    const mockOutletsAvg = 
`[배출구 1] TSP: 3.42, NOX: 18.50, SOX: 12.10
[배출구 3] TSP: 4.15, NOX: 22.30, SOX: 14.80
[배출구 4] TSP: 2.80, NOX: 19.10, SOX: 11.40
[배출구 5] TSP: 3.90, NOX: 20.40, SOX: 13.50`;
    const mockAlarmCount = '0건 (전 항목 정상)';
    const mockAlarms = '✅ 이상 징후 없음 (모든 항목 정상 범위)';

    let rendered = tmpl;
    rendered = rendered.replace(/\{날짜\}|\{date\}/g, todayStr);
    rendered = rendered.replace(/\{30분데이터수신상태\}|\{telemetry_status\}/g, mockStatus);
    rendered = rendered.replace(/\{배출구별상태\}|\{outlets_status\}/g, mockOutletsStatus);
    rendered = rendered.replace(/\{배출구별평균\}|\{outlets_averages\}/g, mockOutletsAvg);
    rendered = rendered.replace(/\{이상신호건수\}|\{alarm_count\}/g, mockAlarmCount);
    rendered = rendered.replace(/\{이상신호내역\}|\{alarms\}/g, mockAlarms);
    rendered = rendered.replace(/\{outlet\}/g, '배출구 1');
    rendered = rendered.replace(/\{status\}/g, '정상 운전 중');
    rendered = rendered.replace(/\{operating_hours\}/g, '24.0');
    rendered = rendered.replace(/\{avg_tsp\}/g, '3.42');
    rendered = rendered.replace(/\{avg_nox\}/g, '18.50');
    rendered = rendered.replace(/\{avg_sox\}/g, '12.10');

    let html = escapeHtml(rendered);
    html = html.replace(/&lt;b&gt;(.*?)&lt;\/b&gt;/gi, '<b>$1</b>');
    html = html.replace(/(\[[^\]\n]+\])/g, '<b>$1</b>');

    previewEl.innerHTML = html;
}
window.updateTemplatePreview = updateTemplatePreview;

function setAllAlarmRules(enabled) {
    if (!_isSettingsUnlocked) {
        showToast('설정을 변경하려면 먼저 [설정 변경] 버튼을 눌러 이중잠금을 해제해주세요.', 'WARNING');
        openPinModal('settings');
        return;
    }
    const ruleIds = ['rule-threshold', 'rule-hunting', 'rule-frozen', 'rule-stop-abnormal', 'rule-missing'];
    ruleIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.checked = !!enabled;
    });
}
window.setAllAlarmRules = setAllAlarmRules;

// 7. System Simulation & Test Dispatch
function initSimulation() {
    const btnSim = document.getElementById('btn-run-simulation');
    if (btnSim) {
        btnSim.onclick = triggerSimulation;
        btnSim.addEventListener('click', triggerSimulation);
    }
}

async function triggerSimulation(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();

    const btnSim = document.getElementById('btn-run-simulation');
    let currentOutlet = document.getElementById('outlet-select')?.value || '배출구 1';
    if (currentOutlet === 'ALL') currentOutlet = '배출구 1';

    if (btnSim) {
        btnSim.disabled = true;
        btnSim.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 실측 데이터 분석 및 개인 텔레그램 발송 중...';
    }

    showToast(`📡 실측 굴뚝 데이터 분석 -> 개인 텔레그램 테스트 발송 실행 중...`);
    
    try {
        const res = await fetch(`/api/simulate?outlet=${encodeURIComponent(currentOutlet)}`, {
            method: 'POST'
        });
        const data = await res.json();
        
        if (data.success) {
            const sim = data.data;
            const tg = sim.telegram_result || {};
            const isReal = sim.is_real_data;
            const period = sim.period || '';
            const src = sim.data_source || '실측데이터';

            const targetText = (tg.success && !tg.is_mock) ? "개인 텔레그램 발송 완료" : "가상 발송 완료 (미설정)";
            const dataBadge = isReal ? `📡 실측 데이터 (${src})` : "🧪 시뮬레이션 기반";

            showToast(`✅ [${dataBadge}] ${targetText}! (${period})`);
            loadLogs();
        } else {
            showToast(`발송 오류: ${data.detail || data.error || '실행 오류'}`, 'ERROR');
        }
    } catch (err) {
        showToast(`통신 실패: ${err.message}`, 'ERROR');
    } finally {
        if (btnSim) {
            btnSim.disabled = false;
            btnSim.innerHTML = '<i class="fa-solid fa-vial-virus"></i> 테스트 발송 (시뮬레이션 실행)';
        }
    }
}
window.triggerSimulation = triggerSimulation;

// 8. Logs History
function initLogs() {
    const btnRefresh = document.getElementById('btn-refresh-logs');
    if (btnRefresh) {
        btnRefresh.onclick = loadLogs;
        btnRefresh.addEventListener('click', loadLogs);
    }
}

async function loadLogs() {
    try {
        const res = await fetch('/api/logs?limit=50');
        const data = await res.json();
        
        if (data.success) {
            renderLogsTable(data.logs);
        }
    } catch (err) {
        console.error("로그 로드 오류:", err);
    }
}
window.loadLogs = loadLogs;

function renderLogsTable(logs) {
    const tbody = document.getElementById('log-tbody');
    tbody.innerHTML = '';

    if (!logs || logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty-row">조회된 알림 로그가 없습니다.</td></tr>`;
        return;
    }

    logs.forEach(l => {
        const tr = document.createElement('tr');
        let statusBadge = `<span class="badge badge-success">${l.status}</span>`;
        if (l.status === 'FAILED') statusBadge = `<span class="badge badge-critical">FAILED</span>`;
        if (l.status === 'MOCK_SUCCESS') statusBadge = `<span class="badge badge-warning">MOCK_SUCCESS</span>`;

        tr.innerHTML = `
            <td>${l.timestamp || ''}</td>
            <td><span class="badge badge-secondary">${l.level || 'INFO'}</span></td>
            <td><strong>${l.event_type || ''}</strong></td>
            <td style="max-width: 400px; white-space: pre-wrap; font-size: 0.82rem;">${escapeHtml(l.message || '')}</td>
            <td>${statusBadge}</td>
        `;
        tbody.appendChild(tr);
    });
}

function escapeHtml(text) {
    return text.replace(/&/g, "&amp;")
               .replace(/</g, "&lt;")
               .replace(/>/g, "&gt;")
               .replace(/"/g, "&quot;")
               .replace(/'/g, "&#039;");
}

function showToast(message, type = 'INFO') {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-message');
    toastMsg.textContent = message;
    
    toast.classList.remove('hidden');
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 4000);
}

// 9. Sub-Tab Switching & Automated 30-Min Google Sheets Analysis
let autoStackChart = null;

function initSubTabs() {
    const manualBtn = document.getElementById('btn-subtab-manual');
    const autoBtn = document.getElementById('btn-subtab-auto');
    const manualPane = document.getElementById('subpane-manual');
    const autoPane = document.getElementById('subpane-auto');
    const statusBadge = document.getElementById('subtab-status-badge');

    if (!manualBtn || !autoBtn) return;

    manualBtn.addEventListener('click', () => {
        manualBtn.classList.add('active', 'btn-emerald');
        manualBtn.classList.remove('btn-secondary');
        autoBtn.classList.remove('active', 'btn-emerald');
        autoBtn.classList.add('btn-secondary');

        manualPane.style.display = 'block';
        autoPane.style.display = 'none';
        if (statusBadge) {
            statusBadge.className = 'badge badge-success';
            statusBadge.textContent = '모드: 수동 엑셀 업로드 분석';
        }
    });

    autoBtn.addEventListener('click', () => {
        autoBtn.classList.add('active', 'btn-emerald');
        autoBtn.classList.remove('btn-secondary');
        manualBtn.classList.remove('active', 'btn-emerald');
        manualBtn.classList.add('btn-secondary');

        autoPane.style.display = 'block';
        manualPane.style.display = 'none';
        if (statusBadge) {
            statusBadge.className = 'badge badge-primary';
            statusBadge.textContent = '모드: 30분 실시간 구글시트 모니터링';
        }
        loadAutoAnalysisData();
    });

    const fetchApiBtn = document.getElementById('btn-auto-fetch-api');
    if (fetchApiBtn) {
        fetchApiBtn.addEventListener('click', async () => {
            showToast('📡 강원도 삼척빛드림본부 CleanSYS 실시간 API 수집 & 구글시트 저장 중...');
            try {
                const res = await fetch('/api/cron/fetch-30m');
                const data = await res.json();
                if (data.success) {
                    showToast(`✅ [한국남부발전 삼척빛드림본부] API 데이터 수집 완료! 총 ${data.rows_count}개 30분 실측 데이터가 구글 시트에 누적 저장되었습니다.`);
                    loadAutoAnalysisData();
                } else {
                    showToast(`CleanSYS API 수집 실패: ${data.message || data.error}`, 'ERROR');
                }
            } catch (err) {
                showToast(`API 데이터 수집 통신 오류: ${err.message}`, 'ERROR');
            }
        });
    }

    const refreshBtn = document.getElementById('btn-auto-refresh');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            showToast('🔄 구글 시트 30분 실측 데이터 새로고침 중...');
            loadAutoAnalysisData();
        });
    }

    // 30분 자동 주기 타이머 (브라우저 열림 시 30분마다 API 수집 & 구글 시트 누적 실행)
    setInterval(async () => {
        const autoPane = document.getElementById('subpane-auto');
        if (autoPane && autoPane.style.display !== 'none') {
            console.log("[Auto30m] 30분 타이머 자동 API 수집 및 구글 시트 저장 실행");
            try {
                await fetch('/api/cron/fetch-30m');
                loadAutoAnalysisData();
            } catch (err) {
                console.error("[Auto30m] 타이머 실행 오류:", err);
            }
        }
    }, 30 * 60 * 1000);

    const autoOutletSelect = document.getElementById('auto-outlet-select');
    if (autoOutletSelect) {
        autoOutletSelect.addEventListener('change', () => {
            loadAutoAnalysisData();
        });
    }

    const autoParamBtns = document.querySelectorAll('.auto-param-btn');
    autoParamBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            autoParamBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (window.currentAutoData) {
                renderAutoChart(window.currentAutoData, btn.dataset.param);
            }
        });
    });
}

async function loadAutoAnalysisData() {
    try {
        const autoStart = document.getElementById('auto-date-start')?.value || '';
        const autoEnd = document.getElementById('auto-date-end')?.value || '';
        let url = '/api/analysis/auto';
        if (autoStart && autoEnd) {
            url += `?start_date=${encodeURIComponent(autoStart)}&end_date=${encodeURIComponent(autoEnd)}`;
        }
        const res = await fetch(url);
        const data = await res.json();
        
        if (data.success) {
            window.currentAutoData = data;
            const outletSelect = document.getElementById('auto-outlet-select');
            const selectedOutlet = outletSelect ? outletSelect.value : 'ALL';
            
            const updatedElem = document.getElementById('auto-last-updated');
            if (updatedElem && data.series_30m && data.series_30m.length > 0) {
                const lastTs = data.series_30m[data.series_30m.length - 1].timestamp;
                updatedElem.textContent = `마지막 30분 수집 시각: ${lastTs}`;
            }

            // === 운전 상태 카드: series_30m의 배출구별 최신 status를 실시간 기준으로 사용 ===
            const allOutlets = ['배출구 1', '배출구 2', '배출구 3', '배출구 4', '배출구 5'];
            const statusEl = document.getElementById('auto-val-status');
            const hoursEl = document.getElementById('auto-val-op-hours');
            const series30m = data.series_30m || [];

            // 배출구별 가장 최신 row의 status를 추출 (CleanSYS 원문 상태 및 행 전체 문구 탐색)
            const latestStatusByOutlet = {};
            allOutlets.forEach(out => {
                const outRows = series30m.filter(s => s.outlet === out);
                if (outRows.length > 0) {
                    const latestRow = outRows.reduce((a, b) => a.timestamp > b.timestamp ? a : b);
                    let st = latestRow.status || '';
                    const rowStr = Object.values(latestRow).map(v => String(v || '')).join(' ');
                    if (/가동중지|가동 중지|미운전|정지/i.test(rowStr)) {
                        st = '가동정지';
                    } else if (/점검|자료확인|자료 확인|보수|불량/i.test(rowStr)) {
                        st = '점검 중';
                    }
                    latestStatusByOutlet[out] = st;
                } else if (data.reports && data.reports[out]) {
                    latestStatusByOutlet[out] = data.reports[out].status || '';
                }
            });

            // 상태 규격화 표시 함수 (원문 문자열 -> 정돈된 레이블)
            const formatStatus = (rawStatus) => {
                const st = String(rawStatus || '').trim();
                if (!st || st === '정상' || st === '0' || st === '0.0') {
                    return { icon: '🟢', label: '정상 운전 중', badgeCls: 'badge-success', shortLabel: '정상' };
                }
                if (/가동중지|가동 중지|미운전|정지/i.test(st)) {
                    return { icon: '🔴', label: '가동정지', badgeCls: 'badge-secondary', shortLabel: '가동정지' };
                }
                if (/점검|자료확인|자료 확인|보수|불량/i.test(st)) {
                    return { icon: '🟡', label: '점검 중', badgeCls: 'badge-warning', shortLabel: '점검 중' };
                }
                return { icon: '🟢', label: st, badgeCls: 'badge-info', shortLabel: st };
            };

            if (selectedOutlet === 'ALL') {
                // 전체 보기: 각 배출구의 현재 실시간 상태 나열
                const statusLines = allOutlets.map(out => {
                    const rawSt = latestStatusByOutlet[out];
                    if (rawSt === undefined) return `${out}: ❓ 데이터 없음`;
                    const { icon, label } = formatStatus(rawSt);
                    return `${out}: ${icon} ${label}`;
                });
                statusEl.innerHTML = statusLines.map(l =>
                    `<span style="display:block;font-size:0.82rem;line-height:1.8;">${l}</span>`
                ).join('');
                statusEl.style.fontSize = '0.82rem';
                if (hoursEl) hoursEl.textContent = '전체 5개 배출구 실시간 상태';
            } else {
                const rawSt = latestStatusByOutlet[selectedOutlet];
                const { icon, label } = formatStatus(rawSt);
                statusEl.textContent = `${icon} ${label}`;
                statusEl.style.fontSize = '';
                const rep = data.reports[selectedOutlet];
                if (rep && hoursEl) {
                    hoursEl.textContent = `운전 ${rep.operating_hours || 0}h / 정지 ${rep.stop_hours || 0}h`;
                }
                if (rep) {
                    document.getElementById('auto-val-tsp').textContent = rep.avg_tsp !== undefined ? rep.avg_tsp.toFixed(2) : '--';
                    document.getElementById('auto-val-nox').textContent = rep.avg_nox !== undefined ? rep.avg_nox.toFixed(2) : '--';
                    document.getElementById('auto-val-sox').textContent = rep.avg_sox !== undefined ? rep.avg_sox.toFixed(2) : '--';
                }
            }

            if (selectedOutlet === 'ALL' && data.reports) {
                // 전체 보기 시 TSP/NOX/SOX 카드: 운전 중인 배출구 평균
                let tspVals = [], noxVals = [], soxVals = [];
                allOutlets.forEach(out => {
                    const r = data.reports[out];
                    if (r) {
                        if (r.avg_tsp) tspVals.push(r.avg_tsp);
                        if (r.avg_nox) noxVals.push(r.avg_nox);
                        if (r.avg_sox) soxVals.push(r.avg_sox);
                    }
                });
                const avg = arr => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : '--';
                document.getElementById('auto-val-tsp').textContent = avg(tspVals);
                document.getElementById('auto-val-nox').textContent = avg(noxVals);
                document.getElementById('auto-val-sox').textContent = avg(soxVals);
            }

            renderAutoChart(data, 'TSP');
            renderAutoAlarmTable(data.all_alarms);
            renderAutoRawDataTable(data.series_30m, data.all_alarms);
        } else {
            showToast(`자동 분석 데이터 조회 오류: ${data.message}`, 'ERROR');
        }
    } catch (err) {
        console.error("loadAutoAnalysisData 오류:", err);
    }
}

function renderAutoChart(data, param) {
    const ctx = document.getElementById('autoStackChart');
    if (!ctx) return;

    const series = data.series_30m || [];
    if (series.length === 0) return;

    const selectedOutlet = document.getElementById('auto-outlet-select')?.value || 'ALL';
    const timestamps = [...new Set(series.map(s => s.timestamp))].sort();

    let datasets = [];

    if (selectedOutlet === 'ALL') {
        // [전체 배출구 통합 모드]: 선택한 감시 인자에 대해 5개 배출구 꺾은선 동시 시각화
        const outletsToRender = ["배출구 1", "배출구 2", "배출구 3", "배출구 4", "배출구 5"];
        const colorMap = {
            "배출구 1": "#64748b",
            "배출구 2": "#94a3b8",
            "배출구 3": "#0ea5e9",
            "배출구 4": "#10b981",
            "배출구 5": "#f59e0b"
        };

        datasets = outletsToRender.map(out => {
            const outData = series.filter(s => s.outlet === out);
            const dataMap = new Map(outData.map(s => [s.timestamp, s[param] || 0]));
            const points = timestamps.map(ts => dataMap.get(ts) || 0);

            return {
                label: out,
                data: points,
                borderColor: colorMap[out] || "#0ea5e9",
                backgroundColor: colorMap[out] || "#0ea5e9",
                borderWidth: 2,
                tension: 0.2,
                pointRadius: 3
            };
        });
    } else {
        // [개별 배출구 선택 모드]: 해당 배출구 내 TSP, NOX, SOX 3개 감시 인자를 한 차트에 동시 시각화!
        const outData = series.filter(s => s.outlet === selectedOutlet);
        const factors = [
            { key: "TSP", label: `${selectedOutlet} TSP (mg/m³)`, color: "#ef4444" },
            { key: "NOX", label: `${selectedOutlet} NOX (ppm)`, color: "#0ea5e9" },
            { key: "SOX", label: `${selectedOutlet} SOX (ppm)`, color: "#f59e0b" }
        ];

        datasets = factors.map(f => {
            const dataMap = new Map(outData.map(s => [s.timestamp, s[f.key] || 0]));
            const points = timestamps.map(ts => dataMap.get(ts) || 0);
            return {
                label: f.label,
                data: points,
                borderColor: f.color,
                backgroundColor: f.color,
                borderWidth: 2,
                tension: 0.2,
                pointRadius: 3
            };
        });
    }

    if (autoStackChart) {
        autoStackChart.destroy();
    }

    autoStackChart = new Chart(ctx, {
        type: 'line',
        data: { labels: timestamps, datasets: datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#f8fafc' } }
            },
            scales: {
                x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } }
            }
        }
    });
}

function renderAutoAlarmTable(alarms) {
    const tbody = document.getElementById('auto-alarm-tbody');
    const badge = document.getElementById('auto-alarm-badge');
    if (!tbody) return;

    tbody.innerHTML = '';
    badge.textContent = `알람 ${alarms ? alarms.length : 0}건`;

    if (!alarms || alarms.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty-row">감지된 이상 신호가 없습니다 (모든 항목 정상)</td></tr>`;
        return;
    }

    alarms.forEach(a => {
        const tr = document.createElement('tr');
        const lvlBadge = a.level === 'CRITICAL' ? '<span class="badge badge-critical">CRITICAL</span>' : '<span class="badge badge-warning">WARNING</span>';
        tr.innerHTML = `
            <td>${a.timestamp || ''}</td>
            <td><strong>${a.outlet || ''}</strong></td>
            <td><span class="badge badge-primary">${a.factor || ''}</span></td>
            <td>${a.alarm_type || ''}</td>
            <td style="text-align: left;">${escapeHtml(a.message || '')}</td>
            <td>${lvlBadge}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderAutoRawDataTable(series, alarms) {
    const tbody = document.getElementById('auto-raw-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (!series || series.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="empty-row">구글 시트에 수집된 30분 실측 데이터가 없습니다.</td></tr>`;
        return;
    }

    const alarmMap = {};
    if (alarms) {
        alarms.forEach(a => {
            const key = `${a.timestamp}_${a.outlet}_${a.factor}`;
            alarmMap[key] = a.level;
            if (a.factor === 'ALL' || a.factor === 'STOP_MONITOR') {
                alarmMap[`${a.timestamp}_${a.outlet}_ALL`] = a.level;
            }
        });
    }

    const outlet = document.getElementById('auto-outlet-select')?.value || 'ALL';
    let targetList = (outlet === 'ALL') ? [...series] : series.filter(s => s.outlet === outlet);

    if (targetList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="empty-row">선택한 배출구(${outlet})의 실측 데이터가 없습니다.</td></tr>`;
        return;
    }

    // 기본 정렬 우선순위: 배출구 별 (배출구 1 -> 배출구 2 -> 배출구 3 -> 배출구 4 -> 배출구 5), 그 다음 수집 시각 순
    targetList.sort((a, b) => {
        const outA = String(a.outlet || '');
        const outB = String(b.outlet || '');
        if (outA !== outB) {
            return outA.localeCompare(outB, 'ko', { numeric: true });
        }
        return String(a.timestamp || '').localeCompare(String(b.timestamp || ''));
    });

    const fragment = document.createDocumentFragment();

    targetList.forEach(r => {
        const tr = document.createElement('tr');
        const ts = r.timestamp || '';
        const out = r.outlet || '';

        // 행 내 모든 텍스트 값 검사하여 가동정지/점검 중 상태 뱃지 및 스타일링 생성
        const rowStr = Object.values(r).map(v => String(v || '')).join(' ');
        let stBadge = `<span class="badge badge-success">정상</span>`;
        let statusCellClass = '';

        if (/가동중지|가동 중지|미운전|정지/i.test(rowStr)) {
            stBadge = `<span class="badge badge-secondary">가동정지</span>`;
        } else if (/점검|자료확인|보수|불량/i.test(rowStr)) {
            stBadge = `<span class="badge badge-warning" style="background: rgba(245, 158, 11, 0.25); color: #fef08a; border: 1px solid #f59e0b;"><i class="fa-solid fa-wrench"></i> 점검중</span>`;
            statusCellClass = 'cell-alarm-warning';
        }

        function getCellClass(factor) {
            const level = alarmMap[`${ts}_${out}_${factor}`] || alarmMap[`${ts}_${out}_ALL`];
            if (level === 'CRITICAL') return 'cell-alarm-critical';
            if (level === 'WARNING') return 'cell-alarm-warning';
            return '';
        }

        const tspClass = getCellClass('TSP');
        const noxClass = getCellClass('NOX');
        const soxClass = getCellClass('SOX');

        // CleanSYS Open API 명세상 산소/유량/온도는 미제공되므로 '-' 표기 (임의 가짜 수치 삽입 제거)
        const o2Disp = '-';
        const flowDisp = '-';
        const tempDisp = '-';

        const tspVal = (r.TSP !== undefined && r.TSP !== null && r.TSP !== '' && !isNaN(r.TSP)) ? Number(r.TSP).toFixed(2) : '0.00';
        const noxVal = (r.NOX !== undefined && r.NOX !== null && r.NOX !== '' && !isNaN(r.NOX)) ? Number(r.NOX).toFixed(2) : '0.00';
        const soxVal = (r.SOX !== undefined && r.SOX !== null && r.SOX !== '' && !isNaN(r.SOX)) ? Number(r.SOX).toFixed(2) : '0.00';

        tr.innerHTML = `
            <td>${ts}</td>
            <td><strong>${out}</strong></td>
            <td class="${tspClass}">${tspVal}</td>
            <td class="${noxClass}">${noxVal}</td>
            <td class="${soxClass}">${soxVal}</td>
            <td style="color: #94a3b8;">${o2Disp}</td>
            <td style="color: #94a3b8;">${flowDisp}</td>
            <td style="color: #94a3b8;">${tempDisp}</td>
        `;
        fragment.appendChild(tr);
    });

    tbody.appendChild(fragment);
}

function initManualHistoryControls() {
    const loadHistoryBtn = document.getElementById('btn-load-manual-history');

    if (loadHistoryBtn) {
        loadHistoryBtn.addEventListener('click', () => {
            const selectedDate = document.getElementById('manual-history-date')?.value;
            if (!selectedDate) {
                showToast('조회할 날짜를 선택해주세요.', 'WARNING');
                return;
            }
            loadManualHistory(selectedDate);
        });
    }

    // flatpickr는 fetchManualAvailableDates 완료 후 초기화 (업로드 날짜 로드 후)
    fetchManualAvailableDates();
}

async function fetchManualAvailableDates() {
    try {
        const res = await fetch('/api/analysis/manual/dates');
        const data = await res.json();
        const dates = (data.success && data.dates) ? data.dates : [];
        initFlatpickrCalendar(dates);
    } catch (e) {
        console.error('5분 수동데이터 날짜 목록 조회 실패:', e);
        initFlatpickrCalendar([]);
    }
}

// flatpickr 인스턴스 전역
let _manualHistoryPicker = null;

function initFlatpickrCalendar(uploadedDates) {
    const inputEl = document.getElementById('manual-history-date');
    if (!inputEl || typeof flatpickr === 'undefined') return;

    const uploadedSet = new Set(uploadedDates);

    // 기존 인스턴스 파기 후 재생성
    if (_manualHistoryPicker) {
        _manualHistoryPicker.destroy();
    }

    _manualHistoryPicker = flatpickr(inputEl, {
        locale: window.flatpickr?.l10ns?.ko || 'default',
        dateFormat: 'Y-m-d',
        defaultDate: uploadedDates.length > 0 ? uploadedDates[0] : null,
        disableMobile: true,
        onDayCreate: function(dObj, dStr, fp, dayElem) {
            // 업로드된 날짜에 초록 점(하이라이트) 표시
            const dateStr = flatpickr.formatDate(dayElem.dateObj, 'Y-m-d');
            if (uploadedSet.has(dateStr)) {
                dayElem.style.position = 'relative';
                dayElem.style.fontWeight = '700';
                dayElem.style.color = '#10b981';
                // 아래 초록 점 추가
                const dot = document.createElement('span');
                dot.style.cssText = 'position:absolute;bottom:2px;left:50%;transform:translateX(-50%);width:5px;height:5px;background:#10b981;border-radius:50%;display:block;';
                dayElem.appendChild(dot);
            }
        }
    });
}

async function loadManualHistory(dateStr) {
    showToast(`⏳ [${dateStr}] 5분 수동데이터 구글 시트 백업 이력 조회 중...`);
    try {
        const res = await fetch(`/api/analysis/manual/history?date=${dateStr}`);
        const data = await res.json();
        if (!data.success) {
            showToast(data.message || `[${dateStr}] 5분 수동데이터가 없습니다.`, 'WARNING');
            return;
        }

        CURRENT_ANALYSIS_DATA = data;
        handleUploadSuccess(data);
        showToast(`✅ [${dateStr}] 5분 수동데이터 (${data.total_rows || 0}건) 로드 완료!`);
    } catch (e) {
        showToast(`수동이력 로드 실패: ${e.message}`, 'ERROR');
    }
}
