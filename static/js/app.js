let stackChart = null;

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initFileUpload();
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
    selector.addEventListener('change', (e) => {
        loadAnalysisData(e.target.value);
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
        tbody.innerHTML = `<tr><td colspan="9" class="empty-row">수집된 5분 데이터가 없습니다. 상단에서 API 수집 버튼을 눌러주세요.</td></tr>`;
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

    const outlets = ["배출구 1", "배출구 2", "배출구 3", "배출구 4", "배출구 5"];
    const colors = {
        "배출구 1": "#10b981", // Emerald
        "배출구 2": "#06b6d4", // Cyan
        "배출구 3": "#6366f1", // Indigo
        "배출구 4": "#f59e0b", // Amber
        "배출구 5": "#f43f5e"  // Rose
    };

    const stack1Data = series5m.filter(s => s.outlet === "배출구 1");
    const rawTimestamps = stack1Data.map(s => s.timestamp || '');

    // 날짜 범위 및 멀티일자 여부 판별
    const dateSet = new Set(rawTimestamps.map(ts => ts.substring(0, 10)));
    const isMultiDay = dateSet.size > 1;

    // X축 라벨 포맷팅: 단일일자인 경우 HH:mm, 다중일자인 경우 MM/DD HH:mm
    const timeLabels = rawTimestamps.map(ts => {
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
        dateRangeSpan.textContent = `(${firstDate} ~ ${lastDate})`;
    }

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
