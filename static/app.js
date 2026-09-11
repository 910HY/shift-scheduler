const STORAGE_KEY = "shift-mobile-v1";
const SLOT_MIN = 30;

const $ = (id) => document.getElementById(id);

function pad(n) { return String(n).padStart(2, "0"); }
function timeToSlot(timeStr) {
    const [h, m] = String(timeStr).split(":").map(Number);
    return h * 2 + Math.floor(m / 30);
}
function slotToTime(slot) {
    return `${pad(Math.floor(slot / 2))}:${pad((slot % 2) * 30)}`;
}
function weekdayZh(date) {
    return ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][date.getDay()];
}
function formatLongDate(date) {
    return `${date.getMonth() + 1}月${date.getDate()}日${weekdayZh(date)}`;
}
function staffInitial(name) {
    return name.replace(/^阿/, "").slice(0, 1) || name.slice(0, 1);
}
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function createDemoState() {
    return {
        version: 1,
        scheduleStart: "09:00",
        scheduleEnd: "13:00",
        nowMode: "demo",
        nowOverride: "09:45",
        staff: [
            { id: "ming", name: "阿明", color: "#2f6fed" },
            { id: "wah", name: "小華", color: "#1b9e4b" },
            { id: "keung", name: "阿強", color: "#e67e22" },
            { id: "mei", name: "阿美", color: "#e84a7f" },
        ],
        jobs: [
            { id: "a1", code: "A1", name: "A1", demand: 2, tint: "#e8f1ff", accent: "#2f6fed", ranges: [{ start: "09:00", end: "13:00" }] },
            { id: "a2", code: "A2", name: "A2", demand: 2, tint: "#e7f8ee", accent: "#1b9e4b", ranges: [{ start: "09:30", end: "10:30" }, { start: "11:00", end: "13:00" }] },
            { id: "gate", code: "閘口", name: "閘口", demand: 3, tint: "#f3e8ff", accent: "#7c3aed", ranges: [{ start: "09:30", end: "13:00" }] },
            { id: "floor", code: "場內", name: "場內", demand: 2, tint: "#fff6e5", accent: "#d97706", ranges: [{ start: "09:00", end: "10:30" }, { start: "11:00", end: "13:00" }] },
        ],
        cells: {},
        unavailable: {},
        constraints: {
            maxConsecutiveWorkMinutes: 90,
            restAfterWorkMinutes: 30,
            workTargetMinutes: 240,
            restTargetMinutes: 90,
            enableMandatoryBreak: false,
            breakStart: "12:00",
            breakEnd: "13:00",
            minBreakMinutes: 60,
        },
        lastSolve: null,
    };
}

function seedAssignments(state) {
    const put = (jobId, start, end, staffId, confirmed = false) => {
        const a = timeToSlot(start);
        const b = timeToSlot(end);
        for (let s = a; s < b; s += 1) {
            state.cells[cellKey(jobId, s)] = { staffId, confirmed };
        }
    };
    put("a1", "09:00", "10:00", "ming", true);
    put("a1", "11:00", "12:00", "wah");
    put("a1", "12:00", "13:00", "ming");
    put("a2", "09:30", "10:30", "keung");
    put("a2", "12:00", "13:00", "keung");
    put("gate", "09:30", "10:30", "wah");
    put("gate", "11:00", "12:00", "ming");
    put("floor", "09:00", "09:30", "keung");
    put("floor", "11:00", "12:00", "mei");
    return state;
}

function cellKey(jobId, absSlot) {
    return `${jobId}:${absSlot}`;
}

const App = {
    state: null,
    ui: {
        tab: "today",
        staffFilter: "all",
        sheet: null,
        swap: { a: null, b: null },
        picker: null,
        resolving: false,
    },

    init() {
        this.state = this.load() || seedAssignments(createDemoState());
        this.bind();
        this.render();
        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.register("/sw.js").catch(() => {});
        }
    },

    load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!data || data.version !== 1 || !data.staff || !data.jobs) return null;
            return data;
        } catch {
            return null;
        }
    },

    save() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    },

    bind() {
        document.querySelectorAll(".tab").forEach((btn) => {
            btn.addEventListener("click", () => this.setTab(btn.dataset.tab));
        });
        $("btn-calendar").addEventListener("click", () => this.toast("MVP 而家只編今日"));
        $("btn-staff-filter").addEventListener("click", () => {
            $("staff-filter-bar").hidden = !$("staff-filter-bar").hidden;
        });
        $("staff-filter-bar").addEventListener("click", (e) => {
            const chip = e.target.closest("[data-filter]");
            if (!chip) return;
            this.ui.staffFilter = chip.dataset.filter;
            this.renderStaff();
        });
        $("btn-staff-menu").addEventListener("click", () => this.setTab("more"));
        $("btn-resolve").addEventListener("click", () => this.resolve(false));
        $("btn-draft").addEventListener("click", () => this.resolve(true));
        document.querySelectorAll("[data-close]").forEach((el) => {
            el.addEventListener("click", () => this.closeOverlay(el.dataset.close));
        });
        $("btn-swap-back").addEventListener("click", () => this.closeOverlay("swap"));
        $("btn-swap-cancel").addEventListener("click", () => this.closeOverlay("swap"));
        $("btn-swap-confirm").addEventListener("click", () => this.confirmSwap());
    },

    setTab(tab) {
        this.ui.tab = tab;
        document.querySelectorAll(".tab").forEach((btn) => btn.classList.toggle("is-on", btn.dataset.tab === tab));
        document.querySelectorAll(".view").forEach((view) => {
            const on = view.dataset.view === tab;
            view.hidden = !on;
            view.classList.toggle("is-active", on);
        });
        this.render();
    },

    startAbs() { return timeToSlot(this.state.scheduleStart); },
    endAbs() { return timeToSlot(this.state.scheduleEnd); },
    slotCount() { return this.endAbs() - this.startAbs(); },
    absSlots() {
        const out = [];
        for (let s = this.startAbs(); s < this.endAbs(); s += 1) out.push(s);
        return out;
    },
    staffById(id) { return this.state.staff.find((s) => s.id === id); },
    jobById(id) { return this.state.jobs.find((j) => j.id === id); },
    jobByCode(code) { return this.state.jobs.find((j) => j.code === code); },

    nowDate() {
        if (this.state.nowMode === "demo" && this.state.nowOverride) {
            const [h, m] = this.state.nowOverride.split(":").map(Number);
            const d = new Date();
            d.setHours(h, m, 0, 0);
            return d;
        }
        return new Date();
    },

    nowAbsSlot() {
        const d = this.nowDate();
        return d.getHours() * 2 + Math.floor(d.getMinutes() / 30);
    },

    isPast(absSlot) {
        return absSlot < this.nowAbsSlot();
    },

    cell(jobId, absSlot) {
        return this.state.cells[cellKey(jobId, absSlot)] || null;
    },

    hasDemand(job, absSlot) {
        return job.ranges.some((r) => {
            const a = timeToSlot(r.start);
            const b = timeToSlot(r.end);
            return absSlot >= a && absSlot < b;
        });
    },

    isConfirmed(jobId, absSlot) {
        return Boolean(this.cell(jobId, absSlot)?.confirmed);
    },

    isLocked(jobId, absSlot) {
        return this.isPast(absSlot) || this.isConfirmed(jobId, absSlot);
    },

    toast(msg) {
        const el = $("toast");
        el.textContent = msg;
        el.hidden = false;
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
    },

    closeOverlay(name) {
        if (name === "sheet") { $("sheet").hidden = true; this.ui.sheet = null; }
        if (name === "picker") { $("picker").hidden = true; this.ui.picker = null; }
        if (name === "swap") { $("swap").hidden = true; this.ui.swap = { a: null, b: null }; }
    },

    render() {
        $("today-date").textContent = formatLongDate(new Date());
        const chip = $("today-now-chip");
        chip.hidden = false;
        chip.textContent = this.state.nowMode === "demo"
            ? `示範而家 ${this.state.nowOverride} · 過去已鎖`
            : `而家 ${slotToTime(this.nowAbsSlot())}`;
        if (this.ui.tab === "today") this.renderToday();
        if (this.ui.tab === "staff") this.renderStaff();
        if (this.ui.tab === "resolve") this.renderResolve();
        if (this.ui.tab === "more") this.renderMore();
        this.save();
    },

    blocksForJob(job) {
        const blocks = [];
        let current = null;
        this.absSlots().forEach((abs) => {
            if (!this.hasDemand(job, abs)) {
                if (current) { blocks.push(current); current = null; }
                return;
            }
            const cell = this.cell(job.id, abs);
            const staffId = cell?.staffId || null;
            const confirmed = Boolean(cell?.confirmed);
            if (current && current.staffId === staffId && current.confirmed === confirmed) {
                current.end = abs + 1;
                current.slots.push(abs);
                return;
            }
            if (current) blocks.push(current);
            current = { jobId: job.id, staffId, confirmed, start: abs, end: abs + 1, slots: [abs] };
        });
        if (current) blocks.push(current);
        return blocks;
    },

    renderToday() {
        const start = this.startAbs();
        const count = this.slotCount();
        const slotW = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--slot-w"), 10) || 86;
        const width = count * slotW;
        const now = this.nowDate();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const startMin = start * SLOT_MIN;
        const nowPct = ((nowMin - startMin) / (count * SLOT_MIN)) * 100;
        const times = this.absSlots().map((abs) => `<span class="tl-time">${slotToTime(abs)}</span>`).join("");

        const rows = this.state.jobs.map((job) => {
            const blocks = this.blocksForJob(job).map((block) => {
                const left = ((block.start - start) / count) * 100;
                const w = ((block.end - block.start) / count) * 100;
                const locked = block.slots.every((s) => this.isLocked(job.id, s));
                const staff = this.staffById(block.staffId);
                const cls = [
                    "block",
                    block.staffId ? "is-assigned" : "is-gap",
                    locked ? "is-locked" : "",
                    block.confirmed ? "is-confirmed" : "",
                ].filter(Boolean).join(" ");
                const style = block.staffId
                    ? `left:${left}%;width:${w}%;background:${job.tint};color:${job.accent}`
                    : `left:${left}%;width:${w}%`;
                const label = block.staffId
                    ? `<span>${staff ? staff.name : block.staffId}</span>`
                    : `<span class="gap-ico">👤</span><span>空缺</span>`;
                return `<button type="button" class="${cls}" style="${style}" data-job="${job.id}" data-start="${block.start}" data-end="${block.end}">${label}</button>`;
            }).join("");
            const nowLine = (nowPct >= 0 && nowPct <= 100)
                ? `<div class="now-line" style="left:${nowPct}%"></div>`
                : "";
            return `<div class="tl-row">
                <div class="tl-label">
                    <div class="tl-job-top">
                        <span class="job-badge" style="background:${job.accent}">${job.code.slice(0, 2)}</span>${job.name}
                    </div>
                    <div class="tl-job-sub">崗位需求：${job.demand}</div>
                </div>
                <div class="tl-track" style="width:${width}px">${nowLine}${blocks}</div>
            </div>`;
        }).join("");

        $("timeline-root").innerHTML = `<div class="tl-scroll"><div class="tl">
            <div class="tl-times">
                <div class="tl-corner"></div>
                <div class="tl-time-track" style="width:${width}px;grid-template-columns:repeat(${count},1fr)">${times}</div>
            </div>
            ${rows}
        </div></div>`;

        $("timeline-root").querySelectorAll(".block").forEach((btn) => {
            btn.addEventListener("click", () => this.openSheet({
                jobId: btn.dataset.job,
                start: Number(btn.dataset.start),
                end: Number(btn.dataset.end),
            }));
        });
    },

    openSheet(block) {
        this.ui.sheet = block;
        const job = this.jobById(block.jobId);
        const staff = this.staffById(this.cell(job.id, block.start)?.staffId);
        const locked = this.absRange(block.start, block.end).every((s) => this.isLocked(job.id, s));
        $("sheet-title").textContent = staff
            ? `${staff.name} 走咗／請假`
            : `${job.name} ${slotToTime(block.start)} 空缺`;
        const actions = [];
        if (staff && !locked) {
            actions.push(["left", "標記之後空缺"]);
            actions.push(["cover", "搵人頂替"]);
            actions.push(["swap", "對調給其他人"]);
            if (!this.isConfirmed(job.id, block.start)) actions.push(["confirm", "確認此班"]);
        } else if (!staff && !locked) {
            actions.push(["cover", "派人頂呢格"]);
        } else {
            actions.push(["info", locked ? "已過時段或已確認，唔會改動" : "呢格而家唔可以改"]);
        }
        actions.push(["cancel", "取消"]);
        $("sheet-actions").innerHTML = actions.map(([id, label]) =>
            `<button type="button" class="sheet-btn${id === "cancel" ? " is-cancel" : ""}" data-act="${id}">${label}</button>`
        ).join("");
        $("sheet-actions").onclick = (e) => {
            const act = e.target.closest("[data-act]")?.dataset.act;
            if (!act) return;
            if (act === "cancel") return this.closeOverlay("sheet");
            if (act === "info") return this.toast("已確認／已過時段鎖住咗");
            if (act === "left") this.markLeft(block);
            if (act === "cover") this.openPicker(block);
            if (act === "swap") this.openSwap(block);
            if (act === "confirm") this.confirmBlock(block);
        };
        $("sheet").hidden = false;
    },

    absRange(start, end) {
        const out = [];
        for (let s = start; s < end; s += 1) out.push(s);
        return out;
    },

    markLeft(block) {
        const staffId = this.cell(block.jobId, block.start)?.staffId;
        if (!staffId) return;
        const from = block.start;
        this.state.jobs.forEach((job) => {
            this.absSlots().forEach((abs) => {
                if (abs < from || this.isLocked(job.id, abs)) return;
                const cell = this.cell(job.id, abs);
                if (cell?.staffId === staffId) {
                    this.state.cells[cellKey(job.id, abs)] = { staffId: null, confirmed: false };
                }
            });
        });
        const prev = this.state.unavailable[staffId];
        this.state.unavailable[staffId] = prev === undefined ? from : Math.min(prev, from);
        this.closeOverlay("sheet");
        this.render();
        this.toast("已標記之後空缺，重算時會避開呢位同事");
    },

    openPicker(block) {
        this.closeOverlay("sheet");
        this.ui.picker = block;
        const current = this.cell(block.jobId, block.start)?.staffId;
        const rows = this.state.staff.map((s) => {
            const gone = this.state.unavailable[s.id] !== undefined && this.state.unavailable[s.id] <= block.start;
            const label = gone ? `${s.name}（已走咗）` : s.name;
            return `<button type="button" class="sheet-btn" data-staff="${s.id}" ${s.id === current || gone ? "disabled" : ""}>${label}</button>`;
        }).join("");
        $("picker-actions").innerHTML = `${rows}<button type="button" class="sheet-btn is-cancel" data-staff="">取消</button>`;
        $("picker-actions").onclick = (e) => {
            const btn = e.target.closest("[data-staff]");
            if (!btn) return;
            if (!btn.dataset.staff) return this.closeOverlay("picker");
            this.replaceBlock(block, btn.dataset.staff);
        };
        $("picker").hidden = false;
    },

    replaceBlock(block, newStaffId) {
        this.absRange(block.start, block.end).forEach((abs) => {
            if (this.isLocked(block.jobId, abs)) return;
            this.state.jobs.forEach((job) => {
                const other = this.cell(job.id, abs);
                if (other?.staffId === newStaffId && !this.isLocked(job.id, abs)) {
                    this.state.cells[cellKey(job.id, abs)] = { staffId: null, confirmed: false };
                }
            });
            this.state.cells[cellKey(block.jobId, abs)] = { staffId: newStaffId, confirmed: false };
        });
        this.closeOverlay("picker");
        this.render();
        this.toast("已即時頂替，未呼叫求解器");
    },

    confirmBlock(block) {
        this.absRange(block.start, block.end).forEach((abs) => {
            const cell = this.cell(block.jobId, abs) || { staffId: null, confirmed: false };
            this.state.cells[cellKey(block.jobId, abs)] = { ...cell, confirmed: true };
        });
        this.closeOverlay("sheet");
        this.render();
        this.toast("已確認，之後重算唔會改呢格");
    },

    openSwap(firstBlock) {
        this.closeOverlay("sheet");
        this.ui.swap = { a: firstBlock || null, b: null };
        $("swap").hidden = false;
        this.renderSwap();
    },

    renderSwap() {
        const card = (key, block) => {
            if (!block) return `<button type="button" class="swap-card is-empty" data-slot="${key}">撳下面選一項班</button>`;
            const job = this.jobById(block.jobId);
            const staff = this.staffById(this.cell(block.jobId, block.start)?.staffId);
            return `<div class="swap-card">
                <div class="kicker">${key.toUpperCase()} 崗位 ${job.name}</div>
                <div class="meta">🕒 ${slotToTime(block.start)}–${slotToTime(block.end)}</div>
                <div class="meta">👤 ${staff ? staff.name : "空缺"}</div>
            </div>`;
        };
        $("swap-cards").innerHTML = `${card("a", this.ui.swap.a)}<div class="swap-icon">⇄</div>${card("b", this.ui.swap.b)}`;
        const picks = [];
        this.state.jobs.forEach((job) => {
            this.blocksForJob(job).forEach((block) => {
                const locked = block.slots.every((s) => this.isLocked(job.id, s));
                const staff = this.staffById(block.staffId);
                const sameA = this.sameBlock(this.ui.swap.a, block);
                picks.push(`<button type="button" class="pick-row" ${locked || sameA ? "disabled" : ""} data-job="${job.id}" data-start="${block.start}" data-end="${block.end}">
                    <span>${job.name}　${slotToTime(block.start)}–${slotToTime(block.end)}</span>
                    <strong>${staff ? staff.name : "空缺"}${locked ? " · 已鎖" : ""}</strong>
                </button>`);
            });
        });
        $("swap-pick-list").innerHTML = picks.join("");
        $("swap-pick-list").onclick = (e) => {
            const btn = e.target.closest(".pick-row");
            if (!btn || btn.disabled) return;
            const block = { jobId: btn.dataset.job, start: Number(btn.dataset.start), end: Number(btn.dataset.end) };
            if (!this.ui.swap.a) this.ui.swap.a = block;
            else this.ui.swap.b = block;
            this.renderSwap();
        };
        $("btn-swap-confirm").disabled = !(this.ui.swap.a && this.ui.swap.b);
    },

    sameBlock(a, b) {
        return a && b && a.jobId === b.jobId && a.start === b.start && a.end === b.end;
    },

    confirmSwap() {
        const { a, b } = this.ui.swap;
        if (!a || !b) return;
        const staffA = this.cell(a.jobId, a.start)?.staffId || null;
        const staffB = this.cell(b.jobId, b.start)?.staffId || null;
        let changed = 0;
        let skipped = 0;
        const apply = (block, staffId) => {
            this.absRange(block.start, block.end).forEach((abs) => {
                if (this.isLocked(block.jobId, abs)) { skipped += 1; return; }
                this.state.cells[cellKey(block.jobId, abs)] = { staffId, confirmed: false };
                changed += 1;
            });
        };
        apply(a, staffB);
        apply(b, staffA);
        this.closeOverlay("swap");
        this.render();
        this.toast(skipped ? `已對調 ${changed} 格，${skipped} 格已鎖所以冇改` : "已即時對調");
    },

    staffMinutes(staffId) {
        let work = 0;
        this.absSlots().forEach((abs) => {
            const busy = this.state.jobs.some((job) => this.cell(job.id, abs)?.staffId === staffId);
            if (busy) work += SLOT_MIN;
        });
        const total = this.slotCount() * SLOT_MIN;
        return { work, rest: total - work };
    },

    consecutiveWorkMinutes(staffId) {
        let best = 0;
        let cur = 0;
        this.absSlots().forEach((abs) => {
            const busy = this.state.jobs.some((job) => this.cell(job.id, abs)?.staffId === staffId);
            if (busy) { cur += SLOT_MIN; best = Math.max(best, cur); }
            else cur = 0;
        });
        return best;
    },

    staffStatus(staffId) {
        const goneFrom = this.state.unavailable[staffId];
        if (goneFrom !== undefined && goneFrom <= this.nowAbsSlot()) return { label: "已走咗", on: false };
        const on = this.state.jobs.some((job) => this.cell(job.id, this.nowAbsSlot())?.staffId === staffId);
        return on ? { label: "在崗", on: true } : { label: "休息中", on: false };
    },

    renderStaff() {
        document.querySelectorAll("#staff-filter-bar .seg-chip").forEach((c) => {
            c.classList.toggle("is-on", c.dataset.filter === this.ui.staffFilter);
        });
        const { workTargetMinutes, restTargetMinutes, maxConsecutiveWorkMinutes } = this.state.constraints;
        const cards = this.state.staff.map((s) => {
            const mins = this.staffMinutes(s.id);
            const status = this.staffStatus(s.id);
            if (this.ui.staffFilter === "on" && !status.on) return "";
            if (this.ui.staffFilter === "rest" && status.on) return "";
            const consec = this.consecutiveWorkMinutes(s.id);
            const warn = consec >= maxConsecutiveWorkMinutes
                ? "已達連續工時上限"
                : consec >= maxConsecutiveWorkMinutes - SLOT_MIN
                    ? "連續工時將滿"
                    : "";
            const workPct = clamp((mins.work / workTargetMinutes) * 100, 0, 100);
            const restPct = clamp((mins.rest / restTargetMinutes) * 100, 0, 100);
            return `<article class="staff-card">
                <div class="staff-top">
                    <span class="avatar" style="background:${s.color}">${staffInitial(s.name)}</span>
                    <div class="staff-name">${s.name}</div>
                    <div class="staff-status"><span class="dot ${status.on ? "" : "is-off"}"></span>${status.label}</div>
                </div>
                <div class="meter"><span>工作</span><div class="bar is-work"><span style="width:${workPct}%"></span></div><span class="meter-val">${mins.work}／${workTargetMinutes} 分鐘</span></div>
                <div class="meter"><span>休息</span><div class="bar is-rest"><span style="width:${restPct}%"></span></div><span class="meter-val">${mins.rest}／${restTargetMinutes} 分鐘</span></div>
                ${warn ? `<div class="warn">⚠ ${warn}</div>` : ""}
            </article>`;
        }).join("");
        $("staff-root").innerHTML = cards || "<p class='hint'>呢個篩選冇人。</p>";
    },

    unfilledGaps() {
        const gaps = [];
        this.state.jobs.forEach((job) => {
            this.absSlots().forEach((abs) => {
                if (!this.hasDemand(job, abs)) return;
                if (!this.cell(job.id, abs)?.staffId) {
                    gaps.push({ job: job.name, time: slotToTime(abs) });
                }
            });
        });
        return gaps;
    },

    renderResolve() {
        const gaps = this.unfilledGaps();
        const last = this.state.lastSolve;
        const gapHtml = gaps.length
            ? gaps.map((g) => `<div class="gap-row"><span>${g.time}</span><strong class="err-text">${g.job} 空缺</strong></div>`).join("")
            : `<p class="ok-text">而家冇未填空缺。</p>`;
        $("resolve-report").innerHTML = `
            <div class="report-card">
                <h3>而家空缺 ${gaps.length} 格</h3>
                ${gapHtml}
            </div>
            <div class="report-card">
                <h3>上次 OR-Tools 結果</h3>
                ${last ? `<p>狀態：<strong>${last.status}</strong></p>
                    ${last.note ? `<p class="hint">${last.note}</p>` : ""}
                    <p class="hint">時間：${last.at}</p>
                    <p>求解器回報未填：${last.unfilled} 格　級別：${last.level || "—"}</p>`
                    : "<p class='hint'>未重算過。示範數據已可直接改，唔使等求解器。</p>"}
            </div>`;
    },

    buildJobRequirements() {
        return this.state.jobs.map((job) => {
            const ranges = job.ranges.map((r) => `${r.start}–${r.end}`).join(",");
            return `${job.code} ${ranges}`;
        });
    },

    buildLocksAndUnavailable() {
        const locked = [];
        this.state.jobs.forEach((job) => {
            this.absSlots().forEach((abs) => {
                const cell = this.cell(job.id, abs);
                if (!cell?.staffId) return;
                if (!this.isLocked(job.id, abs)) return;
                const staff = this.staffById(cell.staffId);
                if (!staff) return;
                locked.push({ employee: staff.name, time_slot: slotToTime(abs), job_code: job.code });
            });
        });
        const unavailable = Object.entries(this.state.unavailable).map(([id, from]) => ({
            employee: this.staffById(id)?.name,
            from_time: slotToTime(from),
        })).filter((x) => x.employee);
        return { locked, unavailable };
    },

    applySolveGrid(grid) {
        const start = this.startAbs();
        this.state.jobs.forEach((job) => {
            this.absSlots().forEach((abs) => {
                if (!this.hasDemand(job, abs)) return;
                if (this.isLocked(job.id, abs)) return;
                let found = null;
                Object.entries(grid || {}).forEach(([name, row]) => {
                    const rel = abs - start;
                    if (row && row[rel] === job.code) found = name;
                });
                const staff = this.state.staff.find((s) => s.name === found);
                this.state.cells[cellKey(job.id, abs)] = { staffId: staff ? staff.id : null, confirmed: false };
            });
        });
    },

    async resolve(asDraft) {
        if (this.ui.resolving) return;
        this.ui.resolving = true;
        const progress = $("resolve-progress");
        let secs = 0;
        progress.hidden = false;
        progress.textContent = "正在呼叫 OR-Tools CP-SAT… 0 秒";
        const timer = setInterval(() => {
            secs += 1;
            progress.textContent = `正在呼叫 OR-Tools CP-SAT… ${secs} 秒`;
        }, 1000);
        const { locked, unavailable } = this.buildLocksAndUnavailable();
        const payload = {
            employee_names: this.state.staff.map((s) => s.name),
            schedule_period: `${this.state.scheduleStart}–${this.state.scheduleEnd}`,
            job_requirements: this.buildJobRequirements(),
            max_consecutive_work_minutes: this.state.constraints.maxConsecutiveWorkMinutes,
            rest_duration_minutes_after_work: this.state.constraints.restAfterWorkMinutes,
            enable_mandatory_break: this.state.constraints.enableMandatoryBreak,
            designated_global_break_period: `${this.state.constraints.breakStart}–${this.state.constraints.breakEnd}`,
            min_mandatory_break_minutes: this.state.constraints.minBreakMinutes,
            locked_assignments: asDraft ? [] : locked,
            unavailable: asDraft ? [] : unavailable,
            soften_workload_balance: true,
            max_solve_seconds: 25,
        };
        try {
            const res = await fetch("/schedule", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            this.applySolveGrid(data.solution_grid || {});
            const report = data.report || {};
            this.state.lastSolve = {
                status: report.status || "未知",
                note: report.status_note || report.infeasible_reason || "",
                unfilled: (report.unfilled_job_slots || []).length,
                level: report.solve_level || "",
                at: new Date().toLocaleTimeString("zh-HK", { hour: "2-digit", minute: "2-digit" }),
            };
            this.setTab("today");
            this.toast(asDraft ? "草稿已由 OR-Tools 生成" : `重算完成：${report.status}，空缺 ${(report.unfilled_job_slots || []).length} 格`);
        } catch (err) {
            this.toast(`重算失敗：${err.message}`);
            this.state.lastSolve = {
                status: "ERROR",
                note: err.message,
                unfilled: this.unfilledGaps().length,
                level: "",
                at: new Date().toLocaleTimeString("zh-HK", { hour: "2-digit", minute: "2-digit" }),
            };
            this.renderResolve();
        } finally {
            clearInterval(timer);
            progress.hidden = true;
            this.ui.resolving = false;
            this.save();
        }
    },

    renderMore() {
        const c = this.state.constraints;
        const times = [];
        for (let s = 0; s < 48; s += 1) times.push(slotToTime(s));
        const opt = (list, selected) => list.map((v) => `<option value="${v}" ${String(v) === String(selected) ? "selected" : ""}>${v}</option>`).join("");
        $("more-root").innerHTML = `
            <div class="more-card">
                <h3>而家幾點</h3>
                <div class="field"><label>時間來源</label>
                    <select id="more-now-mode">
                        <option value="demo" ${this.state.nowMode === "demo" ? "selected" : ""}>示範時間（方便試鎖定）</option>
                        <option value="live" ${this.state.nowMode === "live" ? "selected" : ""}>用電話真實時間</option>
                    </select>
                </div>
                <div class="field"><label>示範而家</label>
                    <select id="more-now">${opt(times.filter((t) => t >= this.state.scheduleStart && t < this.state.scheduleEnd), this.state.nowOverride)}</select>
                </div>
            </div>
            <div class="more-card">
                <h3>排班時段</h3>
                <div class="field"><label>開始</label><select id="more-start">${opt(times.slice(0, 36), this.state.scheduleStart)}</select></div>
                <div class="field"><label>結束</label><select id="more-end">${opt(times.slice(1), this.state.scheduleEnd)}</select></div>
            </div>
            <div class="more-card">
                <h3>約束（重算時交俾 OR-Tools）</h3>
                <div class="field"><label>最大連續工作</label>
                    <select id="more-maxw">${opt([60, 90, 120, 150, 180, 210, 240], c.maxConsecutiveWorkMinutes)}</select>
                </div>
                <div class="field"><label>連續做滿之後休息</label>
                    <select id="more-rest">${opt([30, 60], c.restAfterWorkMinutes)}</select>
                </div>
                <div class="field"><label>工作目標（人手頁）</label>
                    <select id="more-wt">${opt([120, 180, 240, 300], c.workTargetMinutes)}</select>
                </div>
                <div class="field"><label>休息目標（人手頁）</label>
                    <select id="more-rt">${opt([60, 90, 120], c.restTargetMinutes)}</select>
                </div>
            </div>
            <div class="more-card">
                <h3>人手名單</h3>
                ${this.state.staff.map((s) => `<div class="staff-mini"><span class="avatar" style="background:${s.color}">${staffInitial(s.name)}</span>${s.name}</div>`).join("")}
                <div class="field"><label>加同事（少少字）</label><input id="more-new-name" maxlength="8" placeholder="例如：阿樂"></div>
                <button type="button" class="btn-secondary" id="more-add">新增同事</button>
            </div>
            <div class="more-card">
                <button type="button" class="btn-secondary" id="more-reset">重設示範數據</button>
                <a class="more-link" href="/desktop">開啟舊版電腦介面</a>
                <p class="hint">即時對調／走咗只改本地編更。每一次「重算」或「生成草稿」先會行 CP-SAT。已確認同已過時段唔會被求解器改寫；無解時會保留鎖定格並列出剩餘空缺，唔會卡住你。</p>
            </div>`;

        const bindVal = (id, fn) => {
            const el = $(id);
            if (el) el.addEventListener("change", () => { fn(el.value); this.render(); });
        };
        bindVal("more-now-mode", (v) => { this.state.nowMode = v; });
        bindVal("more-now", (v) => { this.state.nowOverride = v; });
        bindVal("more-start", (v) => { if (timeToSlot(v) < this.endAbs()) this.state.scheduleStart = v; });
        bindVal("more-end", (v) => { if (timeToSlot(v) > this.startAbs()) this.state.scheduleEnd = v; });
        bindVal("more-maxw", (v) => { this.state.constraints.maxConsecutiveWorkMinutes = Number(v); });
        bindVal("more-rest", (v) => { this.state.constraints.restAfterWorkMinutes = Number(v); });
        bindVal("more-wt", (v) => { this.state.constraints.workTargetMinutes = Number(v); });
        bindVal("more-rt", (v) => { this.state.constraints.restTargetMinutes = Number(v); });
        $("more-add").addEventListener("click", () => {
            const name = $("more-new-name").value.trim();
            if (!name) return this.toast("輸入個名先");
            if (this.state.staff.some((s) => s.name === name)) return this.toast("已經有呢位");
            const colors = ["#5856d6", "#32ade6", "#af52de", "#64d2ff"];
            this.state.staff.push({ id: `s${Date.now()}`, name, color: colors[this.state.staff.length % colors.length] });
            this.render();
        });
        $("more-reset").addEventListener("click", () => {
            this.state = seedAssignments(createDemoState());
            this.render();
            this.toast("已重設示範編更");
        });
    },
};

document.addEventListener("DOMContentLoaded", () => App.init());
