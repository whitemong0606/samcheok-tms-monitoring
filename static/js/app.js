let stackChart = null;

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initFileUpload();
    initCleanSysAPI();
    initOutletSelector();
    initSettings();
    initSimulation();
    initLogs();
    
    // 최초 데이터 로드
    loadAnalysisData('배출구 1');
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

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            uploadFile(e.target.files[0]);
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
            uploadFile(e.dataTransfer.files[0]);
        }
    });
}

async function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    showToast(`파일 업로드 중: ${file.name}`);
    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        const res = await response.json();
        if (res.success) {
            showToast(`업로드 완료! 총 ${res.total_rows}개 데이터 가공 완료.`);
            const currentOutlet = document.getElementById('outlet-select').value;
            loadAnalysisData(currentOutlet);
        } else {
            showToast(`업로드 실패: ${res.detail || '오류 발생'}`, 'ERROR');
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

// 2-1. CleanSYS Open API Cascade Combo Box Selection
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

        let searchPlant = plant;
        if (plant.includes("한국남부발전")) searchPlant = "한국남부발전";
        else if (plant.includes("한국동서발전")) searchPlant = "한국동서발전";
        else if (plant.includes("한국서부발전")) searchPlant = "한국서부발전";
        else if (plant.includes("한국중부발전")) searchPlant = "한국중부발전";
        else if (plant.includes("한국남동발전")) searchPlant = "한국남동발전";

        showToast(`📡 [${region} ${subregion}] ${plant} API 실시간 데이터 수집 중...`);

        const formData = new FormData();
        formData.append('area_nm', region);
        formData.append('fact_manage_nm', searchPlant);

        try {
            const res = await fetch('/api/cleansys/fetch', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();

            if (data.success) {
                showToast(`✅ [${plant}] CleanSYS API 실시간 측정 데이터 수집 및 시각화 완료!`);
                const currentOutlet = document.getElementById('outlet-select').value;
                loadAnalysisData(currentOutlet);
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
    selector.addEventListener('change', (e) => {
        loadAnalysisData(e.target.value);
    });
}

let CURRENT_ANALYSIS_DATA = null;
let CURRENT_PARAM = 'TSP';

// 4. Load & Render Analysis Data (All 5 Outlets Integrated)
async function loadAnalysisData() {
    try {
        const res = await fetch('/api/analysis');
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
        tbody.innerHTML = `<tr><td colspan="9" class="empty-row">수집된 5분 데이터가 없습니다. 상단에서 API 수집 버튼을 눌러주세요.</td></tr>`;
        return;
    }

    // 알람 맵핑 (timestamp + outlet + factor -> level)
    const alarmMap = {};
    if (alarms) {
        alarms.forEach(a => {
            const key = `${a.timestamp}_${a.outlet}_${a.factor}`;
            alarmMap[key] = a.level;
            // 인자가 ALL 이거나 STOP_MONITOR 일 경우
            if (a.factor === 'ALL' || a.factor === 'STOP_MONITOR') {
                alarmMap[`${a.timestamp}_${a.outlet}_ALL`] = a.level;
            }
        });
    }

    let filtered = series5m;
    if (filterOutlet !== 'ALL') {
        filtered = series5m.filter(s => s.outlet === filterOutlet);
    }

    // 표 생성을 위한 DocumentFragment
    const fragment = document.createDocumentFragment();

    filtered.forEach(row => {
        const tr = document.createElement('tr');
        const ts = row.timestamp || '';
        const out = row.outlet || '';
        const state = row.O2 >= 19.5 ? '정지' : '운전';
        const stateBadge = state === '정지' ? '<span class="badge badge-secondary">정지</span>' : '<span class="badge badge-success">운전</span>';

        // 각 인자별 알람 클래스 검출
        function getCellClass(factor) {
            const level = alarmMap[`${ts}_${out}_${factor}`] || alarmMap[`${ts}_${out}_ALL`];
            if (level === 'CRITICAL') return 'cell-alarm-critical';
            if (level === 'WARNING') return 'cell-alarm-warning';
            return '';
        }

        const tspClass = getCellClass('TSP');
        const noxClass = getCellClass('NOX');
        const soxClass = getCellClass('SOX');
        const o2Class = getCellClass('O2');
        const flowClass = getCellClass('Flow');
        const tempClass = getCellClass('Temp');

        tr.innerHTML = `
            <td>${ts}</td>
            <td><strong>${out}</strong></td>
            <td>${stateBadge}</td>
            <td class="${tspClass}">${row.TSP !== undefined ? row.TSP.toFixed(2) : '0.00'}</td>
            <td class="${noxClass}">${row.NOX !== undefined ? row.NOX.toFixed(2) : '0.00'}</td>
            <td class="${soxClass}">${row.SOX !== undefined ? row.SOX.toFixed(2) : '0.00'}</td>
            <td class="${o2Class}">${row.O2 !== undefined ? row.O2.toFixed(2) : '0.00'}</td>
            <td class="${flowClass}">${row.Flow !== undefined ? Math.round(row.Flow).toLocaleString() : '0'}</td>
            <td class="${tempClass}">${row.Temp !== undefined ? row.Temp.toFixed(1) : '0.0'}</td>
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
    document.getElementById('val-status').textContent = report.status || '운전 중';
    document.getElementById('val-op-hours').textContent = `운전 ${report.operating_hours || 0}h / 정지 ${report.stop_hours || 0}h`;
    
    document.getElementById('val-tsp').textContent = report.avg_tsp !== undefined ? report.avg_tsp : '--';
    document.getElementById('val-nox').textContent = report.avg_nox !== undefined ? report.avg_nox : '--';
    document.getElementById('val-sox').textContent = report.avg_sox !== undefined ? report.avg_sox : '--';

    const valBox = document.getElementById('val-validation');
    const valLogs = CURRENT_ANALYSIS_DATA ? CURRENT_ANALYSIS_DATA.validation_logs : [];
    if (valLogs && valLogs.length > 0) {
        valBox.textContent = `불일치 ${valLogs.length}건`;
        valBox.style.color = 'var(--accent-amber)';
    } else {
        valBox.textContent = '일치 검증 완료';
        valBox.style.color = 'var(--accent-emerald)';
    }
}

// 5. Single Integrated Chart.js Rendering for ALL 5 Outlets (배출구 1~5)
function renderIntegratedChart(series5m, param) {
    const ctx = document.getElementById('stackChart').getContext('2d');
    
    if (!series5m || series5m.length === 0) return;

    // 배출구 1~5 목록
    const outlets = ["배출구 1", "배출구 2", "배출구 3", "배출구 4", "배출구 5"];
    const colors = {
        "배출구 1": "#10b981", // Emerald
        "배출구 2": "#06b6d4", // Cyan
        "배출구 3": "#6366f1", // Indigo
        "배출구 4": "#f59e0b", // Amber
        "배출구 5": "#f43f5e"  // Rose
    };

    // 타임스탬프 라벨 (배출구 1 기준 288개 5분 데이터 시계열)
    const timestamps1 = series5m.filter(s => s.outlet === "배출구 1").map(s => s.timestamp ? s.timestamp.substring(11, 16) : '');

    const datasets = outlets.map(out => {
        const outData = series5m.filter(s => s.outlet === out);
        const values = outData.map(s => s[param] !== undefined ? s[param] : 0);

        return {
            label: out,
            data: values,
            borderColor: colors[out],
            backgroundColor: 'transparent',
            tension: 0.25,
            borderWidth: 2,
            pointRadius: 1,
            pointHoverRadius: 5
        };
    });

    if (stackChart) {
        stackChart.destroy();
    }

    stackChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: timestamps1,
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
                            return `[24시간 5분 데이터] 시각: ${context[0].label}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8', font: { size: 11 } }
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
