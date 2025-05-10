// static/script.js

/**
 * 填充時間下拉選單
 * @param {string} selectElementId - 下拉選單元素的ID
 * @param {number} startHour - 開始的小時 (默認 0)
 * @param {number} endHourBefore - 結束的小時 (不包含，例如 48 表示到 47:30)
 * @param {string} defaultSelectedTime - 默認選中的時間值 "HH:MM"
 * @param {number} minuteInterval - 分鐘間隔 (默認 30)
 */
function populateTimeSelectWithOptions(selectElementId, startHour = 0, endHourBefore = 24, defaultSelectedTime = "09:00", minuteInterval = 30) {
    const selectElement = document.getElementById(selectElementId);
    if (!selectElement) {
        console.error(`populateTimeSelect: Element with ID '${selectElementId}' not found.`);
        return;
    }
    selectElement.innerHTML = ''; // 清空現有選項

    for (let h = startHour; h < endHourBefore; h++) {
        for (let m = 0; m < 60; m += minuteInterval) {
            const hourStr = String(h).padStart(2, '0');
            const minStr = String(m).padStart(2, '0');
            const timeValue = `${hourStr}:${minStr}`;

            const option = document.createElement('option');
            option.value = timeValue;
            option.textContent = timeValue;
            if (timeValue === defaultSelectedTime) {
                option.selected = true;
            }
            selectElement.appendChild(option);
        }
    }
}

// --- 輔助函數 ---
function isValidTimeFormat(timeStr) {
    return /^\d{1,2}:\d{2}$/.test(timeStr);
}
function showError(message) {
    const errorMessageDiv = document.getElementById('error-message');
    if (errorMessageDiv) {
        errorMessageDiv.textContent = message;
        errorMessageDiv.style.display = 'block';
    } else {
        alert(message); // Fallback
    }
}
function generateHtmlTable(dataArray, columns, headers = {}) {
    if (!dataArray || dataArray.length === 0) return "<p>無數據可顯示。</p>";
    let tableHtml = "<table class='results-table'><thead><tr>";
    columns.forEach(col => { tableHtml += `<th>${headers[col] || col}</th>`; });
    tableHtml += "</tr></thead><tbody>";
    dataArray.forEach(row => {
        tableHtml += "<tr>";
        columns.forEach(col => { tableHtml += `<td>${row[col] !== undefined && row[col] !== null ? row[col] : ''}</td>`; });
        tableHtml += "</tr>";
    });
    tableHtml += "</tbody></table>";
    return tableHtml;
}
function jsTimeToSlot(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return null;
    const parts = timeStr.split(':');
    if (parts.length !== 2) return null;
    try {
        const h = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        if (isNaN(h) || isNaN(m) || m < 0 || m > 59 || h < 0) return null;
        return h * 2 + Math.floor(m / 30);
    } catch { return null; }
}
function jsSlotToTimeStr(slotIndex) {
     if (typeof slotIndex !== 'number' || slotIndex < 0 || !Number.isInteger(slotIndex) ) return "??:??";
     const h = Math.floor(slotIndex / 2);
     const m = (slotIndex % 2) * 30;
     return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
 function jsParseTimeRange(rangeStr) {
    if (!rangeStr || typeof rangeStr !== 'string') return [null, null];
    let parts;
    if (rangeStr.includes('–')) parts = rangeStr.split('–'); // EN DASH
    else if (rangeStr.includes('-')) parts = rangeStr.split('-'); // HYPHEN
    else return [null, null];
    if (parts.length !== 2) return [null, null];
    const startSlot = jsTimeToSlot(parts[0].trim());
    const endSlot = jsTimeToSlot(parts[1].trim());
    if (startSlot === null || endSlot === null) {
         console.warn(`Invalid time string in range for parsing: ${rangeStr}`);
         return [null, null];
    }
    return [startSlot, endSlot];
}

/**
 * 格式化排班結果為 HTML 表格
 */
function formatGridAsTable(gridData, unfilledSlots, schedulePeriodStr, status) {
    if (!gridData && status !== "OPTIMAL" && status !== "FEASIBLE") {
        return "<p>無有效的排班網格可顯示。</p>";
    }
    const [startSlotAbs, endSlotAbs] = jsParseTimeRange(schedulePeriodStr);
    if (startSlotAbs === null || endSlotAbs === null || endSlotAbs <= startSlotAbs) {
        console.error("無法解析排班時段:", schedulePeriodStr);
        return "<p>無法解析排班時段以生成網格。</p>";
    }
    const numSlots = endSlotAbs - startSlotAbs;
    if (numSlots <= 0) {
        console.error("排班時段無效 (numSlots <= 0):", schedulePeriodStr);
        return "<p>排班時段無效。</p>";
    }

    const table = document.createElement('table');
    table.className = 'schedule-grid-table';

    const thead = table.createTHead();
    const headerRow = thead.insertRow();
    const thEmpName = document.createElement('th');
    thEmpName.textContent = '員工';
    headerRow.appendChild(thEmpName);

    for (let i = 0; i < numSlots; i++) {
        const sAbs = i + startSlotAbs;
        const h = Math.floor(sAbs / 2);
        const m = (sAbs % 2) * 30;
        const timeHeader = `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`;
        const thTime = document.createElement('th');
        thTime.textContent = timeHeader;
        headerRow.appendChild(thTime);
    }

    const tbody = table.createTBody();
    const employeeKeys = gridData ? Object.keys(gridData).sort() : [];
    const kFromInput = parseInt(document.getElementById('k-employees').value) || employeeKeys.length || 0;

    for (let empIdx = 0; empIdx < kFromInput; empIdx++) {
        const empKey = `K${empIdx + 1}`;
        const row = tbody.insertRow();
        const cellEmpName = row.insertCell();
        cellEmpName.textContent = empKey;
        cellEmpName.className = 'employee-name-cell';

        const schedule = gridData && gridData[empKey] ? gridData[empKey] : Array(numSlots).fill('');
        for (let i = 0; i < numSlots; i++) {
            const cell = row.insertCell();
            let task = schedule[i] || '';
            let displayTask = task;
            let taskClass = 'task-empty';
            if (task === 'R' || task === '.') {
                displayTask = '.'; taskClass = 'task-rest';
            } else if (task && task.trim() !== '') {
                taskClass = 'task-work';
                taskClass += ` task-code-${task.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
            }
            cell.textContent = displayTask; cell.className = taskClass; cell.title = task;
        }
    }

    const sdRow = tbody.insertRow();
    sdRow.className = 'sd-row';
    const cellSDLabel = sdRow.insertCell();
    cellSDLabel.textContent = 'SD';
    cellSDLabel.className = 'employee-name-cell';

    const unfilledJobsAtSlot = {};
    (unfilledSlots || []).forEach(unfilled => {
        const slot = jsTimeToSlot(unfilled.time_slot);
        if (slot !== null) {
            if (!unfilledJobsAtSlot[slot]) unfilledJobsAtSlot[slot] = [];
            if (!unfilledJobsAtSlot[slot].includes(unfilled.job_code)) {
               unfilledJobsAtSlot[slot].push(unfilled.job_code);
            }
        }
    });
    for (let i = 0; i < numSlots; i++) {
        const cellSD = sdRow.insertCell();
        const absSlot = startSlotAbs + i;
        if (unfilledJobsAtSlot[absSlot] && unfilledJobsAtSlot[absSlot].length > 0) {
            unfilledJobsAtSlot[absSlot].sort();
            let sdText = unfilledJobsAtSlot[absSlot].join(',');
            if (sdText.length > 4 && unfilledJobsAtSlot[absSlot].length > 1) { // Simple truncation
                sdText = sdText.substring(0, 3) + '+';
            } else if (sdText.length > 4) {
                sdText = sdText.substring(0, 4);
            }
            cellSD.textContent = sdText;
            cellSD.classList.add('task-unfilled');
            cellSD.title = unfilledJobsAtSlot[absSlot].join(',');
        } else {
            cellSD.textContent = ''; cellSD.classList.add('task-empty');
        }
    }
    return table.outerHTML;
}


document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed");

    const kSelect = document.getElementById('k-employees');
    const scheduleStartSelect = document.getElementById('schedule-start');
    const scheduleEndSelect = document.getElementById('schedule-end');
    const maxWorkMinutesSelect = document.getElementById('max-work-minutes');
    const restAfterWorkMinutesSelect = document.getElementById('rest-after-work-minutes');
    const enableMandatoryBreakCheckbox = document.getElementById('enable-mandatory-break');
    const mandatoryBreakSettingsDiv = document.getElementById('mandatory-break-settings');
    const breakPeriodStartSelect = document.getElementById('break-period-start');
    const breakPeriodEndSelect = document.getElementById('break-period-end');
    const minBreakMinutesSelect = document.getElementById('min-break-minutes');
    const jobCodeInput = document.getElementById('job-code');
    const jobTimeStartSelect = document.getElementById('job-time-start');
    const jobTimeEndSelect = document.getElementById('job-time-end');
    const addJobTimeButton = document.getElementById('add-job-time-button');
    const currentJobTimesDiv = document.getElementById('current-job-times');
    const addJobDefinitionButton = document.getElementById('add-job-definition-button');
    const jobDefinitionsDisplay = document.getElementById('job-definitions-display');
    const clearJobsButton = document.getElementById('clear-jobs-button');
    const generateScheduleButton = document.getElementById('generate-schedule-button');
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorMessageDiv = document.getElementById('error-message');
    const scheduleResultsSection = document.getElementById('schedule-results');
    const resultStatusDiv = document.getElementById('result-status');
    const gridContainer = document.getElementById('schedule-grid-container');
    const employeeStatsContainer = document.getElementById('employee-stats-container');
    const jobStatsContainer = document.getElementById('job-stats-container');
    const unfilledDetailsContainer = document.getElementById('unfilled-details-container');
    const unfilledSection = document.getElementById('unfilled-section');
    const printScheduleButton = document.getElementById('print-schedule-button');
    const screenshotScheduleButton = document.getElementById('screenshot-schedule-button');
    const contactLink = document.getElementById('contact-link');
    const contactModal = document.getElementById('contact-modal');
    const closeContactModalButton = document.getElementById('close-contact-modal');
    const contactForm = document.getElementById('contact-form');
    const formStatusDiv = document.getElementById('form-status');

    let currentJobTimeRanges = [];
    let allJobDefinitions = [];
    window.lastGeneratedReport = null;
    window.lastSchedulePeriod = null;
    let scheduleTimer = null;
    const MAX_SOLVE_TIME_SECONDS = 180;

    if (enableMandatoryBreakCheckbox) {
        toggleMandatoryBreakSettings();
        enableMandatoryBreakCheckbox.addEventListener('change', toggleMandatoryBreakSettings);
    }
    renderAllJobDefinitions();

    populateTimeSelectWithOptions('schedule-start', 0, 24, '09:00');
    populateTimeSelectWithOptions('schedule-end', 0, 48, '18:00');
    populateTimeSelectWithOptions('break-period-start', 0, 48, '12:00');
    populateTimeSelectWithOptions('break-period-end', 0, 48, '13:00');
    populateTimeSelectWithOptions('job-time-start', 0, 48, '09:00');
    populateTimeSelectWithOptions('job-time-end', 0, 48, '10:00');

    if (addJobTimeButton) addJobTimeButton.addEventListener('click', handleAddJobTime);
    if (addJobDefinitionButton) addJobDefinitionButton.addEventListener('click', handleAddJobDefinition);
    if (clearJobsButton) clearJobsButton.addEventListener('click', handleClearJobs);
    if (generateScheduleButton) generateScheduleButton.addEventListener('click', handleGenerateSchedule);
    if (printScheduleButton) printScheduleButton.addEventListener('click', () => window.print());
    if (screenshotScheduleButton) screenshotScheduleButton.addEventListener('click', handleScreenshotSchedule);

    if (contactLink && contactModal) {
        contactLink.addEventListener('click', (e) => {
            e.preventDefault(); contactModal.style.display = 'flex';
            setTimeout(() => { contactModal.classList.add('active'); }, 10);
        });
    }
    if (closeContactModalButton && contactModal) {
        closeContactModalButton.addEventListener('click', closeContactModal);
    }
    if (contactModal) {
        contactModal.addEventListener('click', (e) => {
            if (e.target === contactModal) closeContactModal();
        });
    }
    function closeContactModal() {
        if (contactModal) {
             contactModal.classList.remove('active');
             setTimeout(() => {
                 contactModal.style.display = 'none';
                 if (formStatusDiv) { formStatusDiv.textContent = ''; formStatusDiv.className = ''; formStatusDiv.style.display = 'none';}
             }, 300);
        }
    }
    if (contactForm && formStatusDiv) {
        contactForm.addEventListener('submit', function(event) {
            event.preventDefault(); const formData = new FormData(contactForm);
            formStatusDiv.textContent = '正在發送...'; formStatusDiv.className = ''; formStatusDiv.style.display = 'block';
            fetch(contactForm.action, { method: 'POST', body: formData, headers: { 'Accept': 'application/json' }
            }).then(response => {
                if (response.ok) {
                    formStatusDiv.textContent = '感謝您的訊息，已成功發送！'; formStatusDiv.className = 'success'; contactForm.reset(); setTimeout(closeContactModal, 3000);
                } else {
                    response.json().then(data => {
                        formStatusDiv.textContent = '發送失敗：' + (data.errors ? data.errors.map(e => e.message).join(', ') : '請檢查輸入或稍後再試。');
                        formStatusDiv.className = 'error';
                    }).catch(() => { formStatusDiv.textContent = '發送失敗，無法解析錯誤信息。'; formStatusDiv.className = 'error'; })
                }
            }).catch(error => { formStatusDiv.textContent = '發送時發生網絡錯誤。'; formStatusDiv.className = 'error'; console.error('Form submission error:', error); });
        });
    }

    function toggleMandatoryBreakSettings() {
        if (mandatoryBreakSettingsDiv && enableMandatoryBreakCheckbox) {
            mandatoryBreakSettingsDiv.style.display = enableMandatoryBreakCheckbox.checked ? 'block' : 'none';
        }
    }
    function handleAddJobTime() {
        const start = jobTimeStartSelect.value; const end = jobTimeEndSelect.value;
        if (!start || !end) { alert('請選擇崗位需求的開始和結束時間。'); return; }
        const startSlot = jsTimeToSlot(start); const endSlot = jsTimeToSlot(end);
        if (startSlot === null || endSlot === null || endSlot <= startSlot) { alert('崗位需求的結束時間必須晚於開始時間。'); return; }
        const timeRange = `${start}–${end}`;
        if (!currentJobTimeRanges.includes(timeRange)) { currentJobTimeRanges.push(timeRange); currentJobTimeRanges.sort(); renderCurrentJobTimes(); }
        else { alert('該崗位時段已添加。'); }
    }
    function renderCurrentJobTimes() {
        if (!currentJobTimesDiv) return; currentJobTimesDiv.innerHTML = '';
        currentJobTimeRanges.forEach((range, index) => {
            const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = range;
            const deleteBtn = document.createElement('span'); deleteBtn.className = 'delete-chip'; deleteBtn.innerHTML = '×'; deleteBtn.title = '刪除此時段';
            deleteBtn.onclick = (event) => { event.stopPropagation(); currentJobTimeRanges.splice(index, 1); renderCurrentJobTimes(); };
            chip.appendChild(deleteBtn); currentJobTimesDiv.appendChild(chip);
        });
    }
    function handleAddJobDefinition() {
        if (!jobCodeInput) { alert('崗位代碼輸入框未找到。'); return; } const code = jobCodeInput.value.trim().toUpperCase();
        if (!code) { alert('請輸入崗位名稱/代碼。'); return; } if (currentJobTimeRanges.length === 0) { alert('請至少為此崗位添加一個需求時段。'); return; }
        const existingJobIndex = allJobDefinitions.findIndex(job => job.code === code);
        if (existingJobIndex !== -1) {
            const existingTimes = allJobDefinitions[existingJobIndex].times; const newTimes = currentJobTimeRanges.filter(t => !existingTimes.includes(t));
            allJobDefinitions[existingJobIndex].times.push(...newTimes); allJobDefinitions[existingJobIndex].times.sort(); alert(`崗位 '${code}' 的時段已更新。`);
        } else { allJobDefinitions.push({ code: code, times: [...currentJobTimeRanges] }); }
        allJobDefinitions.sort((a, b) => a.code.localeCompare(b.code));
        jobCodeInput.value = ''; currentJobTimeRanges = []; renderCurrentJobTimes(); renderAllJobDefinitions();
    }
    function handleClearJobs() { if (confirm('確定要清空所有已定義的崗位嗎？')) { allJobDefinitions = []; renderAllJobDefinitions(); } }
    function renderAllJobDefinitions() { if (!jobDefinitionsDisplay) return; jobDefinitionsDisplay.value = allJobDefinitions.map(job => `${job.code} ${job.times.join(',')}`).join('\n'); }

    async function handleGenerateSchedule() {
        console.log("handleGenerateSchedule called");
        if (scheduleTimer) { clearTimeout(scheduleTimer); scheduleTimer = null; }

        const k = parseInt(kSelect.value);
        const scheduleStart = scheduleStartSelect.value;
        const scheduleEnd = scheduleEndSelect.value;
        const schedulePeriod = `${scheduleStart}–${scheduleEnd}`;
        window.lastSchedulePeriod = schedulePeriod;

        const maxConsecutiveMinutes = parseInt(maxWorkMinutesSelect.value);
        const restDurationAfterWork = parseInt(restAfterWorkMinutesSelect.value);
        const enableBreak = enableMandatoryBreakCheckbox.checked;
        let designatedBreakPeriod = ""; let minBreakMinutesVal = 0;
        if (enableBreak) {
            const breakStart = breakPeriodStartSelect.value; const breakEnd = breakPeriodEndSelect.value;
            designatedBreakPeriod = `${breakStart}–${breakEnd}`; minBreakMinutesVal = parseInt(minBreakMinutesSelect.value);
        }
        const jobDefinitionsText = jobDefinitionsDisplay.value;
        const jobRequirementsArray = jobDefinitionsText.split('\n').map(line => line.trim()).filter(line => line && line.includes(' '));

        if (isNaN(k) || k <= 0) { showError('員工人數必須是有效的正整數。'); return; }
        const startSlotVal = jsTimeToSlot(scheduleStart); const endSlotVal = jsTimeToSlot(scheduleEnd);
        if (startSlotVal === null || endSlotVal === null || endSlotVal <= startSlotVal) { showError('排班總時段的結束時間必須晚於開始時間。'); return; }
        if (isNaN(maxConsecutiveMinutes) || maxConsecutiveMinutes <= 0) { showError('最大連續工作時間選擇無效。'); return; }
        if (isNaN(restDurationAfterWork) || (restDurationAfterWork !== 30 && restDurationAfterWork !== 60)) { showError('連續工作後的休息時間選擇無效。'); return; }
        if (enableBreak) {
            const breakStartSlot = jsTimeToSlot(breakPeriodStartSelect.value); const breakEndSlot = jsTimeToSlot(breakPeriodEndSelect.value);
            if (breakStartSlot === null || breakEndSlot === null || breakEndSlot <= breakStartSlot) { showError('全局落場時段的結束時間必須晚於開始時間。'); return; }
            if (isNaN(minBreakMinutesVal) || minBreakMinutesVal <= 0) { showError('最小落場休息時間選擇無效。'); return; }
        }
        if (jobRequirementsArray.length === 0 && allJobDefinitions.length === 0) { showError('請至少定義一個有效的崗位需求。'); return; }

        const requestData = {
            k_employees: k, schedule_period: schedulePeriod, max_consecutive_work_minutes: maxConsecutiveMinutes,
            rest_duration_minutes_after_work: restDurationAfterWork, enable_mandatory_break: enableBreak,
            designated_global_break_period: designatedBreakPeriod, min_mandatory_break_minutes: minBreakMinutesVal,
            job_requirements: jobRequirementsArray
        };

        if (errorMessageDiv) { errorMessageDiv.textContent = ''; errorMessageDiv.style.display = 'none'; }
        if (scheduleResultsSection) scheduleResultsSection.style.display = 'none';
        clearResultContainers();

        let secondsElapsed = 0;
        const timerDisplayInterval = setInterval(() => {
            secondsElapsed++;
            if (loadingIndicator) loadingIndicator.innerHTML = `正在計算排班 (${secondsElapsed}/${MAX_SOLVE_TIME_SECONDS}秒)...`;
        }, 1000);
        if (loadingIndicator) {
            loadingIndicator.innerHTML = `正在計算排班 (0/${MAX_SOLVE_TIME_SECONDS}秒)...`;
            loadingIndicator.style.display = 'block';
        }

        scheduleTimer = setTimeout(() => {
            clearInterval(timerDisplayInterval);
            if (loadingIndicator) loadingIndicator.style.display = 'none';
            showError(`排班計算超時 (${MAX_SOLVE_TIME_SECONDS}秒)。請嘗試簡化需求或放寬約束條件後重試。`);
        }, MAX_SOLVE_TIME_SECONDS * 1000);

        try {
            console.log("Sending payload to /schedule:", JSON.stringify(requestData, null, 2));
            const response = await fetch('/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestData) });
            clearTimeout(scheduleTimer); scheduleTimer = null; clearInterval(timerDisplayInterval);
            if (loadingIndicator) loadingIndicator.style.display = 'none';

            const result = await response.json();
            window.lastGeneratedReport = result.report;

            if (!response.ok) {
                showError(`API 請求失敗 (${response.status}): ${result.error || response.statusText || '未知後端錯誤'}`);
                if (result.report && scheduleResultsSection) { scheduleResultsSection.style.display = 'block'; displayReportOnly(result.report); }
            } else {
                if (scheduleResultsSection) scheduleResultsSection.style.display = 'block';
                displayResults(result.solution_grid, result.report, schedulePeriod);
            }
        } catch (error) {
            clearTimeout(scheduleTimer); scheduleTimer = null; clearInterval(timerDisplayInterval);
            if (loadingIndicator) loadingIndicator.style.display = 'none';
            showError(`網絡或請求錯誤: ${error.message}。如果問題持續，請嘗試放寬約束條件。`);
            console.error("Fetch error:", error);
        }
    }

    function clearResultContainers() {
        if (resultStatusDiv) resultStatusDiv.textContent = '';
        if (gridContainer) gridContainer.innerHTML = '';
        if (employeeStatsContainer) employeeStatsContainer.innerHTML = '';
        if (jobStatsContainer) jobStatsContainer.innerHTML = '';
        if (unfilledDetailsContainer) unfilledDetailsContainer.innerHTML = '';
        if (unfilledSection) unfilledSection.style.display = 'none';
    }

    function displayResults(solutionGrid, report, schedulePeriodStr) {
         const status = report.status || "未知";
         if (resultStatusDiv) {
            resultStatusDiv.textContent = `求解狀態: ${status}`; resultStatusDiv.className = '';
            if (status === "OPTIMAL" || status === "FEASIBLE") resultStatusDiv.classList.add('optimal');
            else if (status.includes("INFEASIBLE")) resultStatusDiv.classList.add('infeasible');
         }
         const isSuccess = status === "OPTIMAL" || status === "FEASIBLE";
         const gridHtml = formatGridAsTable(solutionGrid, report.unfilled_job_slots || [], schedulePeriodStr, status);
         if (gridContainer) gridContainer.innerHTML = gridHtml;

         if (report.employee_stats && report.employee_stats.length > 0 && employeeStatsContainer) {
             employeeStatsContainer.innerHTML = generateHtmlTable( report.employee_stats.filter(s => s), ["employee", "W_count", "R_count"], {"employee": "員工", "W_count": "工作格數", "R_count": "休息格數"} );
         } else if (employeeStatsContainer) { employeeStatsContainer.innerHTML = "<p>無員工統計數據。</p>"; }

         if (jobStatsContainer) displayJobStats(report);

         if (unfilledDetailsContainer && unfilledSection) {
            if (report.unfilled_job_slots && report.unfilled_job_slots.length > 0) {
                const sortedUnfilledSlots = [...report.unfilled_job_slots].sort((a, b) => {
                    const slotA = jsTimeToSlot(a.time_slot); const slotB = jsTimeToSlot(b.time_slot);
                    if (slotA === null && slotB === null) return 0; if (slotA === null) return 1; if (slotB === null) return -1;
                    if (slotA === slotB) return a.job_code.localeCompare(b.job_code);
                    return slotA - slotB;
                });
                unfilledDetailsContainer.innerHTML = generateHtmlTable( sortedUnfilledSlots, ["time_slot", "job_code"], {"time_slot": "時段", "job_code": "崗位代碼"} );
                unfilledSection.style.display = 'block';
            } else if (isSuccess) {
                 unfilledDetailsContainer.innerHTML = "<p>所有崗位需求均已成功編配。</p>";
                 unfilledSection.style.display = 'block';
            } else {
                 unfilledDetailsContainer.innerHTML = "<p>無詳細未填補崗位信息。</p>";
                 unfilledSection.style.display = 'block';
            }
         }
         if (!isSuccess && report.infeasible_reason && errorMessageDiv) { showError(report.infeasible_reason); }
    }

    function displayReportOnly(report) {
         if (scheduleResultsSection) scheduleResultsSection.style.display = 'block';
         const status = report.status || "API錯誤/報告不完整";
         if (resultStatusDiv) { resultStatusDiv.textContent = `狀態: ${status}`; resultStatusDiv.className = ''; if (status.includes("INFEASIBLE")) resultStatusDiv.classList.add('infeasible'); }
         if (gridContainer) gridContainer.innerHTML = "<p>無排班網格數據。</p>";
         if (jobStatsContainer) displayJobStats(report);

         if (unfilledDetailsContainer && unfilledSection) {
            if (report.unfilled_job_slots && report.unfilled_job_slots.length > 0) {
                const sortedUnfilledSlots = [...report.unfilled_job_slots].sort((a, b) => {
                    const slotA = jsTimeToSlot(a.time_slot); const slotB = jsTimeToSlot(b.time_slot);
                    if (slotA === null && slotB === null) return 0; if (slotA === null) return 1; if (slotB === null) return -1;
                    if (slotA === slotB) return a.job_code.localeCompare(b.job_code);
                    return slotA - slotB;
                });
                unfilledDetailsContainer.innerHTML = generateHtmlTable( sortedUnfilledSlots, ["time_slot", "job_code"], {"time_slot": "時段", "job_code": "崗位代碼"} );
                unfilledSection.style.display = 'block';
            } else {
                unfilledDetailsContainer.innerHTML = "<p>無詳細未填補崗位信息。</p>";
                unfilledSection.style.display = 'block';
            }
         }
          if (report.infeasible_reason && errorMessageDiv) { showError(`報告附帶信息: ${report.infeasible_reason}`); }
    }

    function displayJobStats(report) {
        if (!jobStatsContainer) return;
        if (report.job_assignments_count) {
             const jobData = []; const assignedJobs = report.job_assignments_count; const unfilledJobsMap = {};
             if (report.unfilled_job_slots) { report.unfilled_job_slots.forEach(j => { unfilledJobsMap[j.job_code] = (unfilledJobsMap[j.job_code] || 0) + 1; }); }
             const allJobCodesInReport = new Set([...Object.keys(assignedJobs), ...Object.keys(unfilledJobsMap)]);
             allJobCodesInReport.forEach(jobCode => {
                  const assignedCount = assignedJobs[jobCode] || 0; const unfilledCount = unfilledJobsMap[jobCode] || 0; const estimatedDemand = assignedCount + unfilledCount;
                  jobData.push({"崗位": jobCode, "已指派格數": assignedCount, "預估需求": estimatedDemand > 0 ? estimatedDemand : "未知"});
             });
              if (jobData.length > 0) { jobData.sort((a, b) => a['崗位'].localeCompare(b['崗位'])); jobStatsContainer.innerHTML = generateHtmlTable(jobData, ["崗位", "已指派格數", "預估需求"]); }
              else { jobStatsContainer.innerHTML = "<p>無崗位指派數據。</p>"; }
         } else { jobStatsContainer.innerHTML = "<p>無崗位指派數據。</p>"; }
    }

    function handleScreenshotSchedule() {
       const gridToCapture = document.getElementById('schedule-grid-container');
       const printButton = document.getElementById('print-schedule-button');
       const screenshotButtonItself = document.getElementById('screenshot-schedule-button');
       if (!gridToCapture || gridToCapture.innerHTML.trim() === "") { alert("沒有排班網格可以截圖，請先生成排班。"); return; }
       const elementsToHideTemporarily = [printButton, screenshotButtonItself];
       elementsToHideTemporarily.forEach(el => { if (el) el.style.visibility = 'hidden'; });
       let gridBackgroundColor = getComputedStyle(gridToCapture).backgroundColor;
       if (gridBackgroundColor === 'rgba(0, 0, 0, 0)' || gridBackgroundColor === 'transparent') {
           gridBackgroundColor = getComputedStyle(document.body).backgroundColor;
       }
       html2canvas(gridToCapture, {
           allowTaint: true, useCORS: true, backgroundColor: gridBackgroundColor,
           scale: window.devicePixelRatio || 2, logging: false,
       }).then(canvas => {
           const link = document.createElement("a"); link.download = "排班網格.png";
           link.href = canvas.toDataURL("image/png"); link.click();
       }).catch(err => {
           console.error("截圖失敗:", err); alert("抱歉，截圖失敗。");
       }).finally(() => {
           elementsToHideTemporarily.forEach(el => { if (el) el.style.visibility = 'visible'; });
       });
   }

}); // End of DOMContentLoaded