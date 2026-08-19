let stackChart = null;

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initSubTabs();
    initFileUpload();
    initManualHistoryControls();
    initCleanSysAPI();
    initDatePickers();
    initOutletSelector();
    initSettings();
    initSimulation();
    initLogs();
    
    // 최초 데이터 로드
    loadAnalysisData();
    loadSettings();
    loadLogs();
});

// 1. Tab Navigation
function initTabs() {
    const tabs = document.querySelectorAll('.nav-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            
            tab.classList.add('active');
            const target = tab.dataset.tab;
            document.getElementById(target).classList.add('active');

            if (target === 'tab-settings') {
                loadSettings();
                loadLogs();
            }
        });
    });
}

// 2. File Drag & Drop Upload
function initFileUpload() {
    const fileInput = document.getElementById('file-upload');
    const dropzone = document.getElementById('dropzone');
    const processBtn = document.getElementById('btn-process-upload');
    if (!fileInput || !dropzone) return;

    function handleFileSelected(file) {
        if (!file) return;
        window.selectedManualFile = file;
        const textElem = dropzone.querySelector('.dropzone-text');
        if (textElem) {
            textElem.innerHTML = `<strong style="color: var(--accent-cyan); font-size: 1.05rem;"><i class="fa-solid fa-file-excel"></i> ${file.name}</strong><span style="color: #fef08a;">파일 인식 완료! 아래 [수동 엑셀 데이터 분석 및 시각화 실행] 버튼을 클릭하세요.</span>`;
        }
        if (processBtn) {
            processBtn.disabled = false;
            processBtn.style.opacity = '1.0';
            processBtn.style.cursor = 'pointer';
            processBtn.classList.add('pulse-glow');
        }
        showToast(`📄 파일 인식 완료: ${file.name}`);
    }

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelected(e.target.files[0]);
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
            handleFileSelected(e.dataTransfer.files[0]);
        }
    });

    if (processBtn) {
        processBtn.addEventListener('click', () => {
            if (window.selectedManualFile) {
                uploadFile(window.selectedManualFile);
            } else {
                showToast(`수동 업로드할 엑셀/CSV 파일을 먼저 선택해 주세요.`, 'WARNING');
            }
        });
    }
}

async function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    showToast(`🔄 엑셀 파일 수동 데이터 분석 처리 중: ${file.name}`);
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
            showToast(`✅ 업로드 완료! 총 ${res.total_rows}개 데이터 가공 및 차트/표 시각화 성공.`);
            
            // 수동 업로드 데이터 기반 직접 시각화 렌더링
            if (res.reports && res.series_5m) {
                CURRENT_ANALYSIS_DATA = res;
                const selectedOutlet = document.getElementById('outlet-select').value || '배출구 1';
                renderMetricCards(res.reports[selectedOutlet] || {});
                renderIntegratedChart(res.series_5m, CURRENT_PARAM);
                renderAlarmTable(res.all_alarms || []);
                
                const rawOutletFilter = document.getElementById('raw-outlet-select').value || 'ALL';
                renderRawDataTable(res.series_5m, res.all_alarms || [], rawOutletFilter);

                initParamButtons();
                initRawDataTable();
            } else {
                loadAnalysisData();
            }
        } else {
            const errMsg = res.detail || res.message || '오류 발생';
            showToast(`업로드 실패: ${errMsg}`, 'ERROR');
        }
    } catch (err) {
        showToast(`업로드 에러: ${err.message}`, 'ERROR');
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
            if (outRows.length > 0) {
                const latestRow = outRows.reduce((a, b) => (a.timestamp || '') > (b.timestamp || '') ? a : b);
                
                const parseNum = v => (v === undefined || v === null || v === '' || isNaN(v)) ? null : Number(v);
                const o2 = parseNum(latestRow.O2);
                const flow = parseNum(latestRow.Flow);
                const temp = parseNum(latestRow.Temp);
                const rowStr = Object.values(latestRow).map(v => String(v || '')).join(' ');

                if (o2 !== null && o2 >= 19.5) {
                    latestStatusByOutlet[out] = '가동정지';
                } else if (flow !== null && flow <= 100) {
                    latestStatusByOutlet[out] = '가동정지';
                } else if (temp !== null && temp <= 30) {
                    latestStatusByOutlet[out] = '가동정지';
                } else if (/가동중지|가동 중지|미운전|정지|STOP/i.test(rowStr)) {
                    latestStatusByOutlet[out] = '가동정지';
                } else if (/점검|자료확인|자료 확인|보수|불량/i.test(rowStr)) {
                    latestStatusByOutlet[out] = '점검 중';
                } else {
                    latestStatusByOutlet[out] = '정상 운전 중';
                }
            } else if (CURRENT_ANALYSIS_DATA.reports && CURRENT_ANALYSIS_DATA.reports[out]) {
                latestStatusByOutlet[out] = CURRENT_ANALYSIS_DATA.reports[out].status || '정상 운전 중';
            }
        });
    }

    const formatStatus = (st) => {
        if (!st || st.includes('운전') || st === '정상') {
            return { icon: '🟢', label: '정상 운전 중' };
        }
        if (st.includes('정지')) {
            return { icon: '🔴', label: '가동정지' };
        }
        if (st.includes('점검') || st.includes('보수')) {
            return { icon: '🟡', label: '점검 중' };
        }
        return { icon: '🟢', label: st };
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
                if (rawSt === undefined) return `${out}: ❓ 데이터 없음`;
                const { icon, label } = formatStatus(rawSt);
                return `${out}: ${icon} ${label}`;
            });
            statusElem.innerHTML = statusLines.map(l =>
                `<span style="display:block;font-size:0.82rem;line-height:1.8;">${l}</span>`
            ).join('');
            statusElem.style.fontSize = '0.82rem';
        }
        if (hoursElem) hoursElem.textContent = '전체 5개 배출구 실시간 상태';

        document.getElementById('val-tsp').textContent = mean(tspArr);
        document.getElementById('val-nox').textContent = mean(noxArr);
        document.getElementById('val-sox').textContent = mean(soxArr);
    } else {
        report = report || {};
        const rawSt = latestStatusByOutlet[selectedOutlet] || report.status || '정상 운전 중';
        const { icon, label } = formatStatus(rawSt);
        if (statusElem) {
            statusElem.textContent = `${icon} ${label}`;
            statusElem.style.fontSize = '';
        }
        if (hoursElem) {
            hoursElem.textContent = `운전 ${report.operating_hours || 0}h / 정지 ${report.stop_hours || 0}h`;
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
    document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
}

async function loadSettings() {
    try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        
        if (data.success && data.settings) {
            const s = data.settings;
            document.getElementById('bot-token').value = s.bot_token || '';
            document.getElementById('chat-id').value = s.chat_id || '';
            document.getElementById('google-sheet-id').value = s.google_sheet_id || '1vmOgz9xh6w5LMg6Oh-yU_-1TNwIuQ8-vIpBAT0IpizY';
            document.getElementById('report-time').value = s.report_time || '08:30';
            document.getElementById('template-text').value = s.template || '';

            if (s.limits) {
                document.getElementById('limit-val-tsp').value = s.limits.TSP || 15.0;
                document.getElementById('limit-val-nox').value = s.limits.NOX || 50.0;
                document.getElementById('limit-val-sox').value = s.limits.SOX || 50.0;
                
                document.getElementById('limit-tsp').textContent = s.limits.TSP || 15.0;
                document.getElementById('limit-nox').textContent = s.limits.NOX || 50.0;
                document.getElementById('limit-sox').textContent = s.limits.SOX || 50.0;
            }
        }
    } catch (err) {
        console.error("설정 로드 오류:", err);
    }
}

async function saveSettings(e) {
    e.preventDefault();
    const payload = {
        bot_token: document.getElementById('bot-token').value.trim(),
        chat_id: document.getElementById('chat-id').value.trim(),
        google_sheet_id: document.getElementById('google-sheet-id').value.trim(),
        report_time: document.getElementById('report-time').value,
        template: document.getElementById('template-text').value,
        limits: {
            TSP: parseFloat(document.getElementById('limit-val-tsp').value),
            NOX: parseFloat(document.getElementById('limit-val-nox').value),
            SOX: parseFloat(document.getElementById('limit-val-sox').value)
        }
    };

    showToast("설정 저장 중...");
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            showToast("Bot 설정 및 기준치가 구글 시트/저장소에 성공적으로 저장되었습니다!");
            loadSettings();
        } else {
            showToast("저장 실패", 'ERROR');
        }
    } catch (err) {
        showToast(`저장 오류: ${err.message}`, 'ERROR');
    }
}

function insertTag(tag) {
    const textarea = document.getElementById('template-text');
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;

    textarea.value = text.substring(0, start) + tag + text.substring(end);
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = start + tag.length;
}

// 7. System Simulation
function initSimulation() {
    document.getElementById('btn-run-simulation').addEventListener('click', async () => {
        const currentOutlet = document.getElementById('outlet-select').value;
        showToast(`🧪 가상 데이터 시뮬레이션 및 텔레그램 테스트 발송 실행 중...`);
        
        try {
            const res = await fetch(`/api/simulate?outlet=${encodeURIComponent(currentOutlet)}`, {
                method: 'POST'
            });
            const data = await res.json();
            
            if (data.success) {
                const sim = data.data;
                const isMock = sim.telegram_result.is_mock;
                const mockInfo = isMock ? "(가상 발송)" : "(실제 텔레그램 전송)";
                
                showToast(`✅ 시뮬레이션 완료! ${sim.detected_alarm_count}건 이상 징후 감지 및 ${mockInfo} 성공!`);
                loadLogs();
            } else {
                showToast(`시뮬레이션 오류: ${data.detail}`, 'ERROR');
            }
        } catch (err) {
            showToast(`시뮬레이션 실행 실패: ${err.message}`, 'ERROR');
        }
    });
}

// 8. Logs History
function initLogs() {
    document.getElementById('btn-refresh-logs').addEventListener('click', loadLogs);
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
    const historyDateInput = document.getElementById('manual-history-date');
    const loadHistoryBtn = document.getElementById('btn-load-manual-history');

    if (historyDateInput) {
        const today = new Date().toISOString().substring(0, 10);
        historyDateInput.value = today;
    }

    if (loadHistoryBtn) {
        loadHistoryBtn.addEventListener('click', async () => {
            const selectedDate = historyDateInput?.value;
            if (!selectedDate) {
                showToast('조회할 날짜를 선택해주세요.', 'WARNING');
                return;
            }
            loadManualHistory(selectedDate);
        });
    }

    fetchManualAvailableDates();
}

async function fetchManualAvailableDates() {
    try {
        const res = await fetch('/api/analysis/manual/dates');
        const data = await res.json();
        if (data.success && data.dates && data.dates.length > 0) {
            const historyDateInput = document.getElementById('manual-history-date');
            if (historyDateInput) {
                historyDateInput.value = data.dates[0];
            }
        }
    } catch (e) {
        console.error('5분 수동데이터 날짜 목록 조회 실패:', e);
    }
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
        showToast(`수동이력 로드 실패: ${e.message}`, 'CRITICAL');
    }
}
