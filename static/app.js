const STORAGE_KEY = "shift-mobile-v4";
const PREV_STORAGE_KEYS = ["shift-mobile-v3", "shift-mobile-v2"];
const SLOT_MIN = 30;
const MIN_TRACKS = 1;
const MAX_TRACKS = 6;
const MAX_STAFF_NUMBER = 99;

const CATEGORY_DEFS = [
    { id: "arr", solverCode: "ARR", name: "ARR", short: "到", tint: "#e8f1ff", accent: "#2f6fed" },
    { id: "dep", solverCode: "DEP", name: "DEP", short: "離", tint: "#e7f8ee", accent: "#1b9e4b" },
    { id: "kiosk_a", solverCode: "KIOSK-A", name: "KIOSK (A)", short: "KA", tint: "#f3e8ff", accent: "#7c3aed" },
    { id: "kiosk_d", solverCode: "KIOSK-D", name: "KIOSK (D)", short: "KD", tint: "#fff6e5", accent: "#d97706" },
];

function trackId(categoryId, n) {
    return `${categoryId}:${n}`;
}

function expandJobs(categories) {
    return (categories || []).flatMap((cat) =>
        Array.from({ length: cat.count }, (_, i) => {
            const n = i + 1;
            return {
                id: trackId(cat.id, n),
                categoryId: cat.id,
                track: n,
                code: `${cat.solverCode}-${n}`,
                name: `${cat.name}-${n}`,
                ranges: cat.ranges,
                tint: cat.tint,
                accent: cat.accent,
                demand: cat.count,
            };
        })
    );
}

const $ = (id) => document.getElementById(id);

function pad(n) { return String(n).padStart(2, "0"); }
function timeToSlot(timeStr) {
    const [h, m] = String(timeStr).split(":").map(Number);
    return h * 2 + Math.floor(m / 30);
}
function slotToTime(slot) {
    return `${pad(Math.floor(slot / 2))}:${pad((slot % 2) * 30)}`;
}
function normalizeClock(timeStr) {
    const [h, m] = String(timeStr || "").split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return "06:30";
    return `${pad(Math.min(23, Math.max(0, h)))}:${pad(Math.min(59, Math.max(0, m)))}`;
}
function weekdayZh(date) {
    return ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][date.getDay()];
}
function formatLongDate(date) {
    return `${date.getMonth() + 1}月${date.getDate()}日${weekdayZh(date)}`;
}
const STAFF_COLORS = ["#2f6fed", "#1b9e4b", "#e67e22", "#e84a7f", "#5856d6", "#32ade6", "#af52de", "#d97706"];

function isNumericName(name) {
    return /^\d+$/.test(String(name).trim());
}
function staffInitial(name) {
    const t = String(name).trim();
    if (isNumericName(t)) return t;
    return t.replace(/^阿/, "").slice(0, 1) || t.slice(0, 1);
}
function staffColorFor(indexOrNumber) {
    const n = Number(indexOrNumber);
    const idx = Number.isFinite(n) && n > 0 ? n - 1 : indexOrNumber;
    return STAFF_COLORS[Math.abs(idx) % STAFF_COLORS.length];
}
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function normJobCode(code) {
    return String(code || "").replace(/\s+/g, "").replace(/[()]/g, "").toUpperCase();
}

function createDemoState() {
    const categories = [
        { ...CATEGORY_DEFS[0], count: 2, ranges: [{ start: "09:00", end: "13:00" }] },
        { ...CATEGORY_DEFS[1], count: 2, ranges: [{ start: "09:30", end: "10:30" }, { start: "11:00", end: "13:00" }] },
        { ...CATEGORY_DEFS[2], count: 2, ranges: [{ start: "09:30", end: "13:00" }] },
        { ...CATEGORY_DEFS[3], count: 2, ranges: [{ start: "09:00", end: "10:30" }, { start: "11:00", end: "13:00" }] },
    ];
    return {
        version: 4,
        scheduleStart: "09:00",
        scheduleEnd: "13:00",
        nowMode: "demo",
        nowOverride: "09:45",
        staff: Array.from({ length: 8 }, (_, i) => {
            const n = i + 1;
            return { id: `n${n}`, name: String(n), color: staffColorFor(n) };
        }),
        categories,
        jobs: expandJobs(categories),
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
    put("arr:1", "09:00", "10:00", "n1", true);
    put("arr:1", "11:00", "12:00", "n2");
    put("arr:1", "12:00", "13:00", "n1");
    put("dep:1", "09:30", "10:30", "n3");
    put("dep:1", "12:00", "13:00", "n3");
    put("kiosk_a:1", "09:30", "10:30", "n2");
    put("kiosk_a:1", "11:00", "12:00", "n1");
    put("kiosk_d:1", "09:00", "09:30", "n3");
    put("kiosk_d:1", "11:00", "12:00", "n4");
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
        this.syncJobs();
        if (this.clampDemoNow({ snapIfOutside: true, snapIfAllPast: true })) {
            this.toast(`示範而家已設為開始時間 ${this.state.nowOverride}`);
        }
        this.bind();
        this.render();
        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.register("/sw.js").then((reg) => reg.update()).catch(() => {});
        }
    },

    load() {
        const keys = [STORAGE_KEY, ...PREV_STORAGE_KEYS];
        for (const key of keys) {
            try {
                const raw = localStorage.getItem(key);
                if (!raw) continue;
                const data = JSON.parse(raw);
                if (!data || !data.staff || !data.categories) continue;
                if (data.version !== 3 && data.version !== 4) continue;
                data.version = 4;
                if (data.nowMode !== "live") {
                    const nowSlot = timeToSlot(data.nowOverride || data.scheduleStart || "09:00");
                    const startSlot = timeToSlot(data.scheduleStart || "09:00");
                    const endSlot = timeToSlot(data.scheduleEnd || "13:00");
                    if (nowSlot < startSlot || nowSlot >= endSlot) {
                        data.nowOverride = data.scheduleStart;
                    } else if (String(data.nowOverride) === "09:45" && startSlot < timeToSlot("09:00")) {
                        data.nowOverride = data.scheduleStart;
                    }
                }
                return data;
            } catch {
                /* try next key */
            }
        }
        return null;
    },

    save() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    },

    bind() {
        document.querySelectorAll(".tab").forEach((btn) => {
            btn.addEventListener("click", () => this.setTab(btn.dataset.tab));
        });
        $("btn-calendar").addEventListener("click", () => this.toast("MVP 而家只編今日"));
        $("today-now-chip").addEventListener("click", () => this.openNowSheet());
        $("today-now-to-start").addEventListener("click", () => this.snapDemoNowToStart());
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
    sortedStaff() {
        return [...this.state.staff].sort((a, b) => {
            const an = isNumericName(a.name);
            const bn = isNumericName(b.name);
            if (an && bn) return Number(a.name) - Number(b.name);
            if (an !== bn) return an ? -1 : 1;
            return a.name.localeCompare(b.name, "zh-Hant");
        });
    },
    addStaffNamed(name, { silent = false } = {}) {
        const trimmed = String(name || "").trim();
        if (!trimmed) {
            if (!silent) this.toast("輸入個名或編號先");
            return false;
        }
        if (this.state.staff.some((s) => s.name === trimmed)) {
            if (!silent) this.toast("已經有呢位");
            return false;
        }
        const num = isNumericName(trimmed) ? Number(trimmed) : this.state.staff.length + 1;
        this.state.staff.push({
            id: isNumericName(trimmed) ? `n${trimmed}` : `s${Date.now()}-${trimmed}`,
            name: trimmed,
            color: staffColorFor(num),
        });
        return true;
    },
    purgeNamedStaff() {
        const named = this.state.staff.filter((s) => !isNumericName(s.name));
        if (!named.length) return 0;
        const ids = new Set(named.map((s) => s.id));
        Object.keys(this.state.cells).forEach((key) => {
            if (ids.has(this.state.cells[key]?.staffId)) {
                this.state.cells[key] = { staffId: null, confirmed: false };
            }
        });
        named.forEach((s) => { delete this.state.unavailable[s.id]; });
        this.state.staff = this.state.staff.filter((s) => !ids.has(s.id));
        return named.length;
    },
    bulkAddStaff(fromRaw, toRaw) {
        const from = Number.parseInt(String(fromRaw).trim(), 10);
        const to = Number.parseInt(String(toRaw).trim(), 10);
        if (!Number.isInteger(from) || !Number.isInteger(to)) {
            this.toast("由／至要填整數");
            return;
        }
        if (from < 1 || to > MAX_STAFF_NUMBER) {
            this.toast(`編號必須係 1–${MAX_STAFF_NUMBER}`);
            return;
        }
        if (from > to) {
            this.toast("「由」不能大於「至」");
            return;
        }
        const purged = this.purgeNamedStaff();
        let added = 0;
        let skipped = 0;
        for (let n = from; n <= to; n += 1) {
            if (this.addStaffNamed(String(n), { silent: true })) added += 1;
            else skipped += 1;
        }
        this.render();
        const bits = [];
        if (purged) bits.push(`已清 ${purged} 個舊名`);
        if (added) bits.push(`加入 ${added} 人（${from}–${to}）`);
        if (skipped) bits.push(`已有編號跳過 ${skipped} 個`);
        this.toast(bits.join("，") || `${from}–${to} 已經全部有咗`);
    },
    removeStaff(id) {
        const person = this.staffById(id);
        if (!person) return;
        Object.keys(this.state.cells).forEach((key) => {
            if (this.state.cells[key]?.staffId === id) {
                this.state.cells[key] = { staffId: null, confirmed: false };
            }
        });
        delete this.state.unavailable[id];
        this.state.staff = this.state.staff.filter((s) => s.id !== id);
        this.render();
        this.toast(`已刪 ${person.name}`);
    },
    clearStaff() {
        if (!this.state.staff.length) return this.toast("名單已經空");
        if (!window.confirm(`清空全部 ${this.state.staff.length} 位人手？編更入面嘅指派都會變空缺。`)) return;
        this.state.staff = [];
        this.state.unavailable = {};
        Object.keys(this.state.cells).forEach((key) => {
            this.state.cells[key] = { staffId: null, confirmed: false };
        });
        this.render();
        this.toast("已清空人手");
    },
    jobById(id) { return this.state.jobs.find((j) => j.id === id); },
    jobByCode(code) { return this.state.jobs.find((j) => j.code === code); },
    categoryById(id) { return this.state.categories.find((c) => c.id === id); },

    syncJobs() {
        this.state.jobs = expandJobs(this.state.categories);
    },

    trackHasLockedCells(jobId) {
        return this.absSlots().some((abs) => {
            const cell = this.cell(jobId, abs);
            return Boolean(cell?.staffId) && this.isLocked(jobId, abs);
        });
    },

    pruneTrackCells(jobId) {
        Object.keys(this.state.cells).forEach((key) => {
            if (key.startsWith(`${jobId}:`)) delete this.state.cells[key];
        });
    },

    setCategoryCount(categoryId, nextCount) {
        const cat = this.categoryById(categoryId);
        if (!cat) return;
        const wanted = clamp(Number(nextCount), MIN_TRACKS, MAX_TRACKS);
        if (wanted === cat.count) return;
        if (wanted > cat.count) {
            cat.count = wanted;
            this.syncJobs();
            this.render();
            this.toast(`${cat.name} 而家 ${cat.count} 個崗`);
            return;
        }
        while (cat.count > wanted) {
            const id = trackId(cat.id, cat.count);
            if (this.trackHasLockedCells(id)) {
                this.toast(`${cat.name}-${cat.count} 有已確認／已過時段，減唔到`);
                break;
            }
            this.pruneTrackCells(id);
            cat.count -= 1;
        }
        this.syncJobs();
        this.render();
        if (cat.count === wanted) this.toast(`${cat.name} 而家 ${cat.count} 個崗`);
    },

    addCategoryRange(categoryId) {
        const cat = this.categoryById(categoryId);
        if (!cat) return;
        const last = cat.ranges[cat.ranges.length - 1];
        const start = last ? last.end : this.state.scheduleStart;
        const end = this.state.scheduleEnd;
        if (timeToSlot(start) >= timeToSlot(end)) {
            return this.toast("冇多餘時段可以再加");
        }
        cat.ranges.push({ start, end });
        this.syncJobs();
        this.ensureScheduleCoversRanges();
        this.clampDemoNow({ snapIfAllPast: true });
        this.render();
    },

    removeCategoryRange(categoryId, index) {
        const cat = this.categoryById(categoryId);
        if (!cat || cat.ranges.length <= 1) return this.toast("至少留一段需求時段");
        cat.ranges.splice(index, 1);
        this.syncJobs();
        this.clampDemoNow({ snapIfAllPast: true });
        this.render();
    },

    updateCategoryRange(categoryId, index, field, value) {
        const cat = this.categoryById(categoryId);
        if (!cat || !cat.ranges[index]) return;
        const next = { ...cat.ranges[index], [field]: value };
        if (timeToSlot(next.start) >= timeToSlot(next.end)) {
            return this.toast("結束時間要遲過開始");
        }
        cat.ranges[index] = next;
        this.syncJobs();
        this.ensureScheduleCoversRanges();
        this.clampDemoNow({ snapIfAllPast: true });
        this.render();
    },

    ensureScheduleCoversRanges() {
        const prevStart = this.state.scheduleStart;
        let minS = this.startAbs();
        let maxE = this.endAbs();
        this.state.categories.forEach((cat) => {
            (cat.ranges || []).forEach((r) => {
                minS = Math.min(minS, timeToSlot(r.start));
                maxE = Math.max(maxE, timeToSlot(r.end));
            });
        });
        if (minS < this.startAbs()) this.state.scheduleStart = slotToTime(minS);
        if (maxE > this.endAbs()) this.state.scheduleEnd = slotToTime(maxE);
        if (this.state.scheduleStart !== prevStart && timeToSlot(this.state.scheduleStart) < timeToSlot(prevStart)) {
            this.state.nowMode = "demo";
            this.state.nowOverride = this.state.scheduleStart;
        }
    },

    clampDemoNow({ snapIfOutside = true, snapIfAllPast = false } = {}) {
        if (this.state.nowMode !== "demo") return false;
        const start = this.startAbs();
        const end = this.endAbs();
        if (end <= start) return false;
        const now = timeToSlot(this.state.nowOverride || this.state.scheduleStart);
        let snap = false;
        if (snapIfOutside && (now < start || now >= end)) snap = true;
        if (snapIfAllPast) {
            const demanded = this.demandedAbsSlots();
            if (demanded.length && demanded.every((abs) => abs < now)) snap = true;
        }
        if (!snap) return false;
        this.state.nowOverride = this.state.scheduleStart;
        return true;
    },

    demandedAbsSlots() {
        const slots = [];
        this.state.jobs.forEach((job) => {
            this.absSlots().forEach((abs) => {
                if (this.hasDemand(job, abs)) slots.push(abs);
            });
        });
        return slots;
    },

    allDemandPastLocked() {
        const slots = this.demandedAbsSlots();
        return slots.length > 0 && slots.every((abs) => this.isPast(abs));
    },

    nowLabel() {
        return this.state.nowMode === "demo"
            ? `示範而家 ${this.state.nowOverride} · 撳呢度改`
            : `而家 ${slotToTime(this.nowAbsSlot())} · 撳呢度改`;
    },

    syncNowUi() {
        const chip = $("today-now-chip");
        if (chip) {
            chip.hidden = false;
            chip.textContent = this.nowLabel();
        }
        const preview = $("more-now-preview");
        if (preview) preview.textContent = `今日會顯示：${this.nowLabel()}`;
        this.renderLockBanner("today-lock-banner");
        this.renderLockBanner("resolve-lock-banner");
        const startBtn = $("today-now-to-start");
        if (startBtn) {
            const show = this.state.nowMode === "demo"
                && timeToSlot(this.state.nowOverride) > this.startAbs();
            startBtn.hidden = !show;
            startBtn.textContent = `將而家設為開始時間（${this.state.scheduleStart}）`;
        }
    },

    setDemoNow(timeStr, { silent = false } = {}) {
        const next = normalizeClock(timeStr);
        this.state.nowMode = "demo";
        this.state.nowOverride = next;
        const startBefore = this.state.scheduleStart;
        if (timeToSlot(next) < this.startAbs()) {
            this.state.scheduleStart = next;
        }
        if (timeToSlot(next) >= this.endAbs()) {
            this.state.nowOverride = this.state.scheduleStart;
        }
        this.save();
        if (!silent) this.toast(`示範而家已設為 ${this.state.nowOverride}`);
        if (this.state.scheduleStart !== startBefore) this.render();
        else {
            this.syncNowUi();
            if (this.ui.tab === "today") this.renderToday();
            if (this.ui.tab === "resolve") this.renderResolve();
        }
        return true;
    },

    snapDemoNowToStart() {
        this.state.nowMode = "demo";
        this.state.nowOverride = this.state.scheduleStart;
        this.save();
        this.toast(`示範而家已設為開始時間 ${this.state.nowOverride}`);
        this.closeOverlay("sheet");
        this.render();
    },

    setScheduleStart(v) {
        if (timeToSlot(v) >= this.endAbs()) return;
        const prev = this.state.scheduleStart;
        this.state.scheduleStart = v;
        if (prev !== v) {
            this.state.nowMode = "demo";
            this.state.nowOverride = v;
            this.toast(`排班開始已改，示範而家設為 ${v}`);
        }
    },

    setScheduleEnd(v) {
        if (timeToSlot(v) <= this.startAbs()) return;
        this.state.scheduleEnd = v;
        if (this.state.nowMode === "demo" && this.nowAbsSlot() >= this.endAbs()) {
            this.state.nowOverride = this.state.scheduleStart;
        }
    },

    lockBannerCopy() {
        if (this.state.nowMode === "demo") {
            return "示範時間太遲，可見時段全部已鎖，重算唔會填。請把「示範而家」調去開始時間，或撳生成草稿。";
        }
        return "而家已經過咗可見時段，全部需求格當已過鎖定。請去更多改排班／示範時間，或撳生成草稿。";
    },

    renderLockBanner(targetId) {
        const el = $(targetId);
        if (!el) return;
        if (!this.allDemandPastLocked()) {
            el.hidden = true;
            el.innerHTML = "";
            return;
        }
        el.hidden = false;
        el.innerHTML = `<p>${this.lockBannerCopy()}</p>
            <button type="button" class="btn-primary" data-snap-now>將而家設為開始時間</button>
            <button type="button" class="btn-secondary" data-go-more>去更多</button>`;
        el.querySelector("[data-snap-now]")?.addEventListener("click", () => this.snapDemoNowToStart());
        el.querySelector("[data-go-more]")?.addEventListener("click", () => this.setTab("more"));
    },

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
        this.syncNowUi();
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
        const labelW = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--label-w"), 10) || 108;
        const trackW = Math.max(count * slotW, slotW);
        const totalW = labelW + trackW;
        const now = this.nowDate();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const startMin = start * SLOT_MIN;
        const nowPct = ((nowMin - startMin) / (count * SLOT_MIN)) * 100;
        const times = this.absSlots().map((abs) => `<span class="tl-time">${slotToTime(abs)}</span>`).join("");

        const nowLine = (nowPct >= 0 && nowPct <= 100)
            ? `<div class="now-line" style="left:${nowPct}%"></div>`
            : "";
        const renderTrack = (job, compact) => {
            const demandBlocks = this.blocksForJob(job);
            const onAxis = demandBlocks.length > 0;
            const blocks = demandBlocks.map((block) => {
                const left = ((block.start - start) / count) * 100;
                const w = ((block.end - block.start) / count) * 100;
                const locked = block.slots.every((s) => this.isLocked(job.id, s));
                const staff = this.staffById(block.staffId);
                const cls = [
                    "block",
                    block.staffId ? "is-assigned" : "is-gap",
                    locked ? "is-locked" : "",
                    block.confirmed ? "is-confirmed" : "",
                    staff && isNumericName(staff.name) ? "is-num" : "",
                ].filter(Boolean).join(" ");
                const style = block.staffId
                    ? `left:${left}%;width:${w}%;background:${job.tint};color:${job.accent}`
                    : `left:${left}%;width:${w}%`;
                const label = block.staffId
                    ? `<span>${staff ? staff.name : block.staffId}</span>`
                    : `<span class="gap-ico">👤</span><span>空缺</span>`;
                return `<button type="button" class="${cls}" style="${style}" data-job="${job.id}" data-start="${block.start}" data-end="${block.end}">${label}</button>`;
            }).join("");
            const emptyNote = !onAxis && job.ranges?.[0]
                ? `<div class="tl-empty-note">需求由 ${job.ranges[0].start} 起，向右滑</div>`
                : "";
            const title = compact ? `${job.track}` : job.name;
            return `<div class="tl-row${compact ? " is-track" : ""}">
                <div class="tl-label">
                    <div class="tl-job-top">
                        <span class="job-badge" style="background:${job.accent}">${compact ? job.track : job.categoryId === "arr" ? "到" : job.name.slice(0, 2)}</span>${title}
                    </div>
                    ${compact ? "" : `<div class="tl-job-sub">崗位需求：${job.demand}</div>`}
                </div>
                <div class="tl-track" style="width:${trackW}px">${nowLine}${blocks}${emptyNote}</div>
            </div>`;
        };
        const rows = this.state.categories.map((cat) => {
            const tracks = this.state.jobs.filter((j) => j.categoryId === cat.id);
            const earliest = (cat.ranges || []).reduce((min, r) => (!min || r.start < min ? r.start : min), "");
            const lateNote = earliest && earliest > this.state.scheduleStart ? ` · 由 ${earliest} 起，向右滑` : "";
            const head = `<div class="tl-row tl-group-head">
                <div class="tl-label">
                    <div class="tl-job-top">
                        <span class="job-badge" style="background:${cat.accent}">${cat.short}</span>${cat.name}
                    </div>
                    <div class="tl-job-sub">崗位需求：${cat.count}${lateNote}</div>
                </div>
                <div class="tl-track" style="width:${trackW}px">${nowLine}</div>
            </div>`;
            return `<div class="tl-group">${head}${tracks.map((job) => renderTrack(job, true)).join("")}</div>`;
        }).join("");

        $("timeline-root").innerHTML = `<div class="tl-scroll"><div class="tl" style="width:${totalW}px;min-width:${totalW}px">
            <div class="tl-times">
                <div class="tl-corner"></div>
                <div class="tl-time-track" style="width:${trackW}px;grid-template-columns:repeat(${count},${slotW}px)">${times}</div>
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
        this.bindTimelineScroll();
    },

    bindTimelineScroll() {
        const scroller = $("timeline-root");
        const hint = $("tl-scroll-hint");
        if (!scroller || !hint) return;
        const update = () => {
            const overflow = scroller.scrollWidth > scroller.clientWidth + 12;
            hint.hidden = !overflow || scroller.scrollLeft > 28;
        };
        scroller.onscroll = update;
        requestAnimationFrame(update);
    },

    openNowSheet() {
        this.ui.sheet = { kind: "now" };
        const current = this.state.nowMode === "demo"
            ? normalizeClock(this.state.nowOverride || this.state.scheduleStart)
            : slotToTime(this.nowAbsSlot());
        $("sheet-title").textContent = "設定而家幾點";
        $("sheet-actions").innerHTML = `
            <p class="hint" style="text-align:left;margin:0 0 10px;">今日 chip 顯示嘅時間。改呢度會即時存檔，唔會彈返 09:45。</p>
            <button type="button" class="sheet-btn ${this.state.nowMode === "demo" ? "is-on" : ""}" data-act="mode-demo">示範時間</button>
            <button type="button" class="sheet-btn ${this.state.nowMode === "live" ? "is-on" : ""}" data-act="mode-live">用電話真實時間</button>
            <label class="field-label" for="now-time-input">示範而家</label>
            <input id="now-time-input" class="now-time-input" type="time" step="300" value="${current}">
            <button type="button" class="sheet-btn" data-act="to-start">將而家設為開始時間（${this.state.scheduleStart}）</button>
            <button type="button" class="sheet-btn sheet-btn-primary" data-act="apply">套用呢個時間</button>
            <button type="button" class="sheet-btn is-cancel" data-act="cancel">取消</button>`;
        $("sheet-actions").onclick = (e) => {
            const act = e.target.closest("[data-act]")?.dataset.act;
            if (!act) return;
            if (act === "cancel") return this.closeOverlay("sheet");
            if (act === "mode-live") {
                this.state.nowMode = "live";
                this.save();
                this.closeOverlay("sheet");
                this.render();
                this.toast("已改用電話真實時間");
                return;
            }
            if (act === "mode-demo") {
                this.state.nowMode = "demo";
                const input = $("now-time-input");
                if (input?.value) this.state.nowOverride = normalizeClock(input.value);
                this.save();
                this.syncNowUi();
                return;
            }
            if (act === "to-start") {
                this.snapDemoNowToStart();
                return;
            }
            if (act === "apply") {
                const input = $("now-time-input");
                const value = input && input.value ? input.value : this.state.scheduleStart;
                this.closeOverlay("sheet");
                this.setDemoNow(value);
                if (this.ui.tab === "more") this.render();
            }
        };
        $("sheet").hidden = false;
        const input = $("now-time-input");
        if (input) {
            const commit = () => {
                if (!input.value) return;
                this.state.nowMode = "demo";
                this.state.nowOverride = normalizeClock(input.value);
                this.save();
                this.syncNowUi();
            };
            input.addEventListener("change", commit);
            input.addEventListener("input", commit);
            input.addEventListener("blur", commit);
        }
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
        const rows = this.sortedStaff().map((s) => {
            const gone = this.state.unavailable[s.id] !== undefined && this.state.unavailable[s.id] <= block.start;
            const label = gone ? `${s.name}（已走咗）` : s.name;
            const numClass = isNumericName(s.name) ? " is-num" : "";
            return `<button type="button" class="sheet-btn${numClass}" data-staff="${s.id}" ${s.id === current || gone ? "disabled" : ""}>${label}</button>`;
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
        const cards = this.sortedStaff().map((s) => {
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
            const numClass = isNumericName(s.name) ? " is-num" : "";
            return `<article class="staff-card">
                <div class="staff-top">
                    <span class="avatar${numClass}" style="background:${s.color}">${staffInitial(s.name)}</span>
                    <div class="staff-name${numClass}">${s.name}</div>
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

    hasAnyAssignment() {
        return this.state.jobs.some((job) =>
            this.absSlots().some((abs) => this.hasDemand(job, abs) && this.cell(job.id, abs)?.staffId)
        );
    },

    hasDemandSlots() {
        return this.state.jobs.some((job) => this.absSlots().some((abs) => this.hasDemand(job, abs)));
    },

    renderResolve() {
        const gaps = this.unfilledGaps();
        const last = this.state.lastSolve;
        const emptyRoster = this.hasDemandSlots() && !this.hasAnyAssignment();
        const allPast = this.allDemandPastLocked();
        const lead = $("resolve-lead");
        const btnResolve = $("btn-resolve");
        const btnDraft = $("btn-draft");
        if (lead && btnResolve && btnDraft) {
            if (emptyRoster || allPast) {
                lead.textContent = allPast
                    ? this.lockBannerCopy()
                    : "未有編更。撳「生成草稿」用 OR-Tools 按編號人手同崗位需求填格。";
                btnDraft.className = "btn-primary btn-xl";
                btnResolve.className = "btn-secondary btn-xl";
            } else {
                lead.textContent = "每一次重算都會呼叫後端 OR-Tools CP-SAT。已確認同已過時段會鎖住；「生成草稿」會忽略示範「而家」，重新填晒需求格。";
                btnResolve.className = "btn-primary btn-xl";
                btnDraft.className = "btn-secondary btn-xl";
            }
        }
        this.renderLockBanner("resolve-lock-banner");
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
                    : emptyRoster
                        ? "<p class='hint'>未有編更。設定人手同崗位之後，撳「生成草稿」填格。</p>"
                        : "<p class='hint'>未重算過。示範數據已可直接改，唔使等求解器。</p>"}
            </div>`;
    },

    buildJobRequirements() {
        return this.state.jobs.map((job) => {
            const ranges = job.ranges.map((r) => `${r.start}–${r.end}`).join(",");
            return `${job.code} ${ranges}`;
        }).filter((line) => line.includes("–"));
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

    applySolveGrid(grid, { asDraft = false } = {}) {
        const start = this.startAbs();
        const byCell = new Map();
        Object.entries(grid || {}).forEach(([name, row]) => {
            const list = Array.isArray(row) ? row : Object.values(row || {});
            list.forEach((code, rel) => {
                if (!code || code === "R") return;
                byCell.set(`${start + rel}:${normJobCode(code)}`, String(name));
            });
        });
        this.state.jobs.forEach((job) => {
            this.absSlots().forEach((abs) => {
                if (!this.hasDemand(job, abs)) return;
                const existing = this.cell(job.id, abs);
                if (!asDraft) {
                    if (this.isConfirmed(job.id, abs)) return;
                    if (this.isPast(abs) && existing?.staffId) return;
                }
                const found = byCell.get(`${abs}:${normJobCode(job.code)}`) || null;
                const staff = this.state.staff.find((s) => String(s.name) === String(found));
                this.state.cells[cellKey(job.id, abs)] = {
                    staffId: staff ? staff.id : null,
                    confirmed: asDraft ? false : Boolean(existing?.confirmed),
                };
            });
        });
    },

    async resolve(asDraft) {
        if (this.ui.resolving) return;
        if (!this.state.staff.length) {
            this.toast("請先加入人手（例如批量 1–10）");
            this.setTab("more");
            return;
        }
        if (!this.hasDemandSlots()) {
            this.toast("請先設定崗位需求時段");
            this.setTab("more");
            return;
        }
        this.ui.resolving = true;
        this.setTab("resolve");
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
            employee_names: this.state.staff.map((s) => String(s.name)),
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
            max_solve_seconds: Math.min(90, 20 + this.state.staff.length),
        };
        try {
            const res = await fetch("/schedule", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            this.applySolveGrid(data.solution_grid || {}, { asDraft });
            const report = data.report || {};
            this.state.lastSolve = {
                status: report.status || "未知",
                note: report.status_note || report.infeasible_reason || "",
                unfilled: (report.unfilled_job_slots || []).length,
                level: report.solve_level || "",
                at: new Date().toLocaleTimeString("zh-HK", { hour: "2-digit", minute: "2-digit" }),
            };
            this.setTab("today");
            if (!asDraft && this.allDemandPastLocked() && !this.hasAnyAssignment()) {
                this.toast("示範時間太遲，可見時段全部已鎖，重算唔會填");
            } else {
                this.toast(asDraft ? "草稿已由 OR-Tools 生成" : `重算完成：${report.status}，空缺 ${(report.unfilled_job_slots || []).length} 格`);
            }
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
        const rangeEditor = (cat) => cat.ranges.map((r, idx) => `
            <div class="range-row">
                <select data-cat="${cat.id}" data-idx="${idx}" data-field="start">${opt(times, r.start)}</select>
                <span>–</span>
                <select data-cat="${cat.id}" data-idx="${idx}" data-field="end">${opt(times, r.end)}</select>
                <button type="button" class="range-del" data-cat="${cat.id}" data-idx="${idx}" ${cat.ranges.length <= 1 ? "disabled" : ""}>刪</button>
            </div>`).join("");
        const jobCards = this.state.categories.map((cat) => `
            <div class="job-edit">
                <div class="job-edit-top">
                    <span class="job-badge" style="background:${cat.accent}">${cat.short}</span>
                    <strong>${cat.name}</strong>
                    <span class="job-edit-sub">會展開成 ${Array.from({ length: cat.count }, (_, i) => `${cat.solverCode}-${i + 1}`).join("、")}</span>
                </div>
                <div class="stepper-row">
                    <span>崗位數</span>
                    <div class="stepper">
                        <button type="button" class="step-btn" data-cat="${cat.id}" data-delta="-1" ${cat.count <= MIN_TRACKS ? "disabled" : ""}>−</button>
                        <strong class="step-val">${cat.count}</strong>
                        <button type="button" class="step-btn" data-cat="${cat.id}" data-delta="1" ${cat.count >= MAX_TRACKS ? "disabled" : ""}>+</button>
                    </div>
                </div>
                <label class="field-label">需求時段</label>
                ${rangeEditor(cat)}
                <button type="button" class="btn-secondary range-add" data-cat="${cat.id}">加時段</button>
            </div>`).join("");
        $("more-root").innerHTML = `
            <div class="more-card">
                <h3>而家幾點</h3>
                <p id="more-now-preview" class="now-preview">${this.nowLabel()}</p>
                <button type="button" class="btn-primary" id="more-pick-now">改示範而家</button>
                <button type="button" class="btn-secondary" id="more-now-to-start">將而家設為開始時間（${this.state.scheduleStart}）</button>
                <div class="field"><label>時間來源</label>
                    <select id="more-now-mode">
                        <option value="demo" ${this.state.nowMode === "demo" ? "selected" : ""}>示範時間（方便試鎖定）</option>
                        <option value="live" ${this.state.nowMode === "live" ? "selected" : ""}>用電話真實時間</option>
                    </select>
                </div>
                <p class="hint">唔好用舊嘅下拉選單（iPhone 會食咗變更）。撳上面掣或今日藍色 chip，用系統時間選擇器。改排班開始會自動把「而家」設成開始時間。</p>
            </div>
            <div class="more-card">
                <h3>崗位要求</h3>
                <p class="hint">得呢四類：ARR、DEP、KIOSK (A)、KIOSK (D)。改崗位數會加／減軌道（例如 ARR-1、ARR-2），每軌道每格仍然只派一人。已確認／已過時段唔會因為減崗洗走。需求時段如果早過而家嘅排班開始，會自動拉闊時間軸。</p>
                ${jobCards}
                <button type="button" class="btn-primary" id="more-generate-draft" style="margin-top:12px;">用 OR-Tools 生成草稿</button>
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
                <h3>人手名單（${this.state.staff.length}）</h3>
                <p class="hint">批量加入用純編號，例如 1–20，最高 99。會清走舊中文示範名同佢哋嘅編更，只留編號。已有編號會跳過。</p>
                <div class="bulk-row">
                    <div class="field"><label for="more-bulk-from">由</label><input id="more-bulk-from" type="number" min="1" max="99" inputmode="numeric" value="1"></div>
                    <div class="field"><label for="more-bulk-to">至</label><input id="more-bulk-to" type="number" min="1" max="99" inputmode="numeric" value="20" placeholder="最高 99"></div>
                </div>
                <button type="button" class="btn-primary" id="more-bulk-add">批量加入</button>
                <div id="staff-mini-list" class="staff-mini-list">
                ${this.sortedStaff().map((s) => {
                    const numClass = isNumericName(s.name) ? " is-num" : "";
                    return `<div class="staff-mini">
                        <span class="avatar${numClass}" style="background:${s.color}">${staffInitial(s.name)}</span>
                        <span class="staff-mini-name${numClass}">${s.name}</span>
                        <button type="button" class="staff-del" data-del="${s.id}" aria-label="刪 ${s.name}">刪</button>
                    </div>`;
                }).join("")}
                </div>
                <div class="field"><label>加一位（名或編號）</label><input id="more-new-name" maxlength="8" placeholder="例如：21 或 阿樂"></div>
                <button type="button" class="btn-secondary" id="more-add">新增同事</button>
                <button type="button" class="btn-danger" id="more-clear-staff" style="margin-top:8px;">清空人手</button>
            </div>
            <div class="more-card">
                <button type="button" class="btn-secondary" id="more-reset">重設示範數據</button>
                <a class="more-link" href="/desktop">開啟舊版電腦介面</a>
                <p class="hint">即時對調／走咗只改本地編更。每一次「重算」或「生成草稿」先會行 CP-SAT。「生成草稿」會忽略示範「而家」嘅過去鎖定，填晒需求格；「重算」會保留已確認同已過時段。無解時會列出剩餘空缺，唔會卡住你。</p>
            </div>`;

        const bindVal = (id, fn) => {
            const el = $(id);
            if (el) el.addEventListener("change", () => { fn(el.value); this.render(); });
        };
        bindVal("more-now-mode", (v) => { this.state.nowMode = v; this.save(); });
        $("more-pick-now").addEventListener("click", () => this.openNowSheet());
        $("more-now-to-start").addEventListener("click", () => this.snapDemoNowToStart());
        bindVal("more-start", (v) => {
            this.setScheduleStart(v);
        });
        bindVal("more-end", (v) => {
            this.setScheduleEnd(v);
            if (this.clampDemoNow({ snapIfOutside: true, snapIfAllPast: true })) {
                this.toast(`示範而家已設為開始時間 ${this.state.nowOverride}`);
            }
        });
        bindVal("more-maxw", (v) => { this.state.constraints.maxConsecutiveWorkMinutes = Number(v); });
        bindVal("more-rest", (v) => { this.state.constraints.restAfterWorkMinutes = Number(v); });
        bindVal("more-wt", (v) => { this.state.constraints.workTargetMinutes = Number(v); });
        bindVal("more-rt", (v) => { this.state.constraints.restTargetMinutes = Number(v); });
        $("more-add").addEventListener("click", () => {
            if (this.addStaffNamed($("more-new-name").value)) this.render();
        });
        $("more-bulk-add").addEventListener("click", () => {
            this.bulkAddStaff($("more-bulk-from").value, $("more-bulk-to").value);
        });
        $("more-clear-staff").addEventListener("click", () => this.clearStaff());
        $("more-generate-draft").addEventListener("click", () => this.resolve(true));
        $("more-root").querySelectorAll("[data-del]").forEach((btn) => {
            btn.addEventListener("click", () => this.removeStaff(btn.dataset.del));
        });
        $("more-reset").addEventListener("click", () => {
            this.state = seedAssignments(createDemoState());
            this.render();
            this.toast("已重設示範編更");
        });
        $("more-root").querySelectorAll(".step-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                const cat = this.categoryById(btn.dataset.cat);
                if (!cat) return;
                this.setCategoryCount(cat.id, cat.count + Number(btn.dataset.delta));
            });
        });
        $("more-root").querySelectorAll(".range-add").forEach((btn) => {
            btn.addEventListener("click", () => this.addCategoryRange(btn.dataset.cat));
        });
        $("more-root").querySelectorAll(".range-del").forEach((btn) => {
            btn.addEventListener("click", () => this.removeCategoryRange(btn.dataset.cat, Number(btn.dataset.idx)));
        });
        $("more-root").querySelectorAll(".range-row select").forEach((sel) => {
            sel.addEventListener("change", () => {
                this.updateCategoryRange(sel.dataset.cat, Number(sel.dataset.idx), sel.dataset.field, sel.value);
            });
        });
    },
};

document.addEventListener("DOMContentLoaded", () => App.init());
