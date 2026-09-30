# backend_api.py
from ortools.sat.python import cp_model
import collections
import math


def time_to_slot(time_str):
    try:
        h, m = map(int, time_str.split(':'))
        return h * 2 + m // 30
    except ValueError:
        print(f"時間格式錯誤: '{time_str}'")
        return None


def slot_to_time_str(slot_index):
    h = slot_index // 2
    m = (slot_index % 2) * 30
    return f"{h:02d}:{m:02d}"


def parse_time_range(range_str, context_for_error="時段"):
    try:
        separator = None
        if '–' in range_str:
            separator = '–'
        elif '-' in range_str:
            separator = '-'

        if separator is None:
            raise ValueError("範圍中未找到有效的分隔符 ('–' 或 '-')。")

        start_str, end_str = range_str.split(separator, 1)
        start_slot = time_to_slot(start_str.strip())
        end_slot = time_to_slot(end_str.strip())

        if start_slot is None or end_slot is None:
            raise ValueError(f"'{start_str if start_slot is None else end_str}' 時間格式不正確。")
        return start_slot, end_slot
    except Exception as e:
        print(f"{context_for_error} '{range_str}' 解析錯誤: {e}")
        raise ValueError(f"{context_for_error} '{range_str}' 格式錯誤或解析失敗: {e}")


REST_R_CODE = 0
FIRST_JOB_CODE = 1

# Constraint packs used by solve fallbacks.
# full     = original hard rules (consecutive work, continuity, mandatory break)
# relaxed  = skip windows that overlap locked slots (locks may already violate day-of reality)
# fill     = skip consecutive-work / same-job continuity / mandatory break; minimise 空缺
# locks    = same constraint pack as fill (kept as an explicit last CP-SAT pass name)
LEVEL_FULL = "full"
LEVEL_RELAXED = "relaxed"
LEVEL_FILL = "fill"
LEVEL_LOCKS = "locks"
GAP_PENALTY = 100000


class ShiftSchedulerWithConstraints:
    """CP-SAT same-day scheduler.

    Mobile re-solve additions (backward compatible with the desktop /schedule payload):
    - employee_names: display names instead of K1..Kn
    - locked_assignments: past + 已確認 cells the solver must keep
    - unavailable: staff who 走咗 / 請假 from a given time (forced rest)
    - soften_workload_balance: balance is an objective penalty, not a hard lock
    - max_solve_seconds: shorter cap for phone 重算

    Infeasibility is softened: if a level is INFEASIBLE we retry a looser pack.
    If a pack is only FEASIBLE but still has 空缺, we continue to fill-first
    (skip consecutive-work / same-job continuity) and keep the grid with fewer gaps.
    """

    def __init__(self,
                 K_employees,
                 schedule_period_str,
                 job_requirements_raw,
                 max_consecutive_work_minutes,
                 rest_duration_minutes_after_work,
                 enable_mandatory_break,
                 designated_global_break_period_str,
                 min_mandatory_break_minutes,
                 employee_names=None,
                 locked_assignments=None,
                 unavailable=None,
                 soften_workload_balance=True,
                 max_solve_seconds=115.0):
        names = employee_names or []
        cleaned_names = [str(n).strip() for n in names if str(n).strip()]
        if cleaned_names:
            self.employee_names = cleaned_names
            self.num_employees = len(cleaned_names)
        else:
            self.num_employees = int(K_employees)
            self.employee_names = [f'K{i + 1}' for i in range(self.num_employees)]
        if self.num_employees <= 0:
            raise ValueError("員工人數必須大於0。")
        self.name_to_idx = {name: idx for idx, name in enumerate(self.employee_names)}

        parsed_schedule_start_slot, parsed_schedule_end_slot = parse_time_range(
            schedule_period_str, "排班總時段"
        )
        self.schedule_start_slot, self.schedule_end_slot = parsed_schedule_start_slot, parsed_schedule_end_slot
        self.num_slots = self.schedule_end_slot - self.schedule_start_slot
        if self.num_slots <= 0:
            raise ValueError(f"排班時段 '{schedule_period_str}' 無效。結束時間的小時數在跨天時應 >=24。")

        self.slot_duration_minutes = 30
        self.max_consecutive_work_slots = math.ceil(max_consecutive_work_minutes / self.slot_duration_minutes)
        if self.max_consecutive_work_slots <= 0:
            raise ValueError("最大連續工作時間必須大於0分鐘。")

        if rest_duration_minutes_after_work == 30:
            self.rest_slots_after_consecutive_work = 1
        elif rest_duration_minutes_after_work == 60:
            self.rest_slots_after_consecutive_work = 2
        else:
            print(f"警告: 無效的 rest_duration_minutes_after_work ({rest_duration_minutes_after_work})，將默認為1格 (30分鐘)。")
            self.rest_slots_after_consecutive_work = 1

        self.enable_mandatory_break = enable_mandatory_break
        self.min_consecutive_rest_slots = 0
        self.global_consecutive_break_start_rel = -1
        self.global_consecutive_break_end_rel = -1
        self.model_definitely_infeasible = False
        self.infeasible_reason = ""

        if self.enable_mandatory_break:
            self.min_consecutive_rest_slots = math.ceil(min_mandatory_break_minutes / self.slot_duration_minutes)
            if self.min_consecutive_rest_slots <= 0:
                raise ValueError("啟用強制落場時，最小落場休息時間必須大於0分鐘。")
            if not designated_global_break_period_str or not designated_global_break_period_str.strip():
                raise ValueError("啟用強制落場時，必須指定全局落場時段。")

            abs_break_start, abs_break_end = parse_time_range(designated_global_break_period_str, "全局落場時段")
            self.global_consecutive_break_start_rel = max(0, abs_break_start - self.schedule_start_slot)
            self.global_consecutive_break_end_rel = min(self.num_slots, abs_break_end - self.schedule_start_slot)

            if self.global_consecutive_break_end_rel - self.global_consecutive_break_start_rel < self.min_consecutive_rest_slots:
                self.model_definitely_infeasible = True
                self.infeasible_reason = (
                    f"錯誤: 全局指定落場時段 '{designated_global_break_period_str}' "
                    f"有效長度不足以安排 {self.min_consecutive_rest_slots} 格連續休息 ({min_mandatory_break_minutes}分鐘)。"
                )

        self.job_code_to_int = {}
        self.int_to_job_code = {}
        current_job_int = FIRST_JOB_CODE
        self.job_demands = collections.defaultdict(lambda: [False] * self.num_slots)
        self.all_demanded_job_slots = []
        for req_line_idx, req_line in enumerate(job_requirements_raw):
            req_line_stripped = req_line.strip()
            if not req_line_stripped:
                continue
            parts = req_line_stripped.split(" ", 1)
            if len(parts) < 2:
                raise ValueError(f"崗位需求第 {req_line_idx + 1} 行 '{req_line_stripped}' 格式錯誤: 應為 '代碼 時段1,...'")
            job_code_str = parts[0]
            time_ranges_str = parts[1]
            if job_code_str not in self.job_code_to_int:
                self.job_code_to_int[job_code_str] = current_job_int
                self.int_to_job_code[current_job_int] = job_code_str
                current_job_int += 1
            job_int_val = self.job_code_to_int[job_code_str]
            for time_range_idx, time_range in enumerate(time_ranges_str.split(',')):
                time_range_stripped = time_range.strip()
                if not time_range_stripped:
                    continue
                context = f"崗位 '{job_code_str}' 的第 {time_range_idx + 1} 個時段"
                start_abs, end_abs = parse_time_range(time_range_stripped, context)
                if end_abs <= start_abs:
                    raise ValueError(f"{context} '{time_range_stripped}'：結束時間必須晚於開始時間。")
                for s_abs in range(start_abs, end_abs):
                    if self.schedule_start_slot <= s_abs < self.schedule_end_slot:
                        s_relative = s_abs - self.schedule_start_slot
                        if not self.job_demands[job_int_val][s_relative]:
                            self.job_demands[job_int_val][s_relative] = True
                            self.all_demanded_job_slots.append((job_int_val, s_relative))
        self.all_job_ints = sorted(list(self.job_code_to_int.values()))

        self.locked_assignments = locked_assignments or []
        self.unavailable = unavailable or []
        self.soften_workload_balance = bool(soften_workload_balance)
        self.max_solve_seconds = float(max_solve_seconds) if max_solve_seconds else 115.0
        self.locked_emp_slots, self.lock_conflicts = self._normalize_locks()

    def _rel_slot_from_time(self, time_str):
        s_abs = time_to_slot(time_str)
        if s_abs is None:
            return None
        return s_abs - self.schedule_start_slot

    def _normalize_locks(self):
        """Map locks / unavailable onto (employee_idx, rel_slot) -> job int or REST.

        Later entries win. Unavailable (走咗) forces REST on unlocked future slots
        but never overrides an explicit lock (已確認 / 過去).
        """
        locked = {}
        conflicts = []
        for raw in self.locked_assignments:
            name = str(raw.get("employee", "")).strip()
            time_str = str(raw.get("time_slot", "")).strip()
            job_code = raw.get("job_code")
            if name not in self.name_to_idx:
                conflicts.append(f"鎖定員工「{name}」不在名單內")
                continue
            s_rel = self._rel_slot_from_time(time_str)
            if s_rel is None or not (0 <= s_rel < self.num_slots):
                conflicts.append(f"鎖定時段「{time_str}」超出排班範圍")
                continue
            e_idx = self.name_to_idx[name]
            if job_code in (None, "", "R", "r", "."):
                locked[(e_idx, s_rel)] = REST_R_CODE
            else:
                job_int = self.job_code_to_int.get(str(job_code))
                if job_int is None:
                    conflicts.append(f"鎖定崗位「{job_code}」未定義，改為休息")
                    locked[(e_idx, s_rel)] = REST_R_CODE
                else:
                    locked[(e_idx, s_rel)] = job_int

        for raw in self.unavailable:
            name = str(raw.get("employee", "")).strip()
            from_time = str(raw.get("from_time", "")).strip()
            if name not in self.name_to_idx:
                conflicts.append(f"離開員工「{name}」不在名單內")
                continue
            from_rel = self._rel_slot_from_time(from_time)
            if from_rel is None:
                conflicts.append(f"離開時間「{from_time}」無效")
                continue
            e_idx = self.name_to_idx[name]
            for s_rel in range(max(0, from_rel), self.num_slots):
                if (e_idx, s_rel) not in locked:
                    locked[(e_idx, s_rel)] = REST_R_CODE
        return locked, conflicts

    def _empty_report(self, status, reason=""):
        report = {
            "status": status,
            "employee_stats": [],
            "unfilled_job_slots": [],
            "job_assignments_count": collections.defaultdict(int),
            "infeasible_reason": reason,
            "lock_conflicts": list(self.lock_conflicts),
            "solve_level": None,
        }
        return report

    def _locks_only_grid(self, reason):
        """Last-resort merge: keep locks, leave everyone else resting, list 空缺."""
        solution_grid = {}
        report = self._empty_report("FEASIBLE_LOCKS_ONLY", reason)
        report["solve_level"] = "locks_only_merge"
        report["status_note"] = (
            "OR-Tools 未能在約束下求出可行解。已保留已確認／過去時段，"
            "其餘未鎖定格留空，請睇返剩餘空缺。"
        )
        assigned = collections.defaultdict(list)
        for e in range(self.num_employees):
            emp_name = self.employee_names[e]
            row = ["R"] * self.num_slots
            work_count = 0
            rest_count = 0
            details = []
            for s_idx in range(self.num_slots):
                task_val = self.locked_emp_slots.get((e, s_idx), REST_R_CODE)
                slot_time = slot_to_time_str(s_idx + self.schedule_start_slot)
                if task_val == REST_R_CODE:
                    row[s_idx] = "R"
                    rest_count += 1
                    details.append((slot_time, "R"))
                else:
                    job_name = self.int_to_job_code.get(task_val, f"JOB_{task_val}")
                    row[s_idx] = job_name
                    work_count += 1
                    details.append((slot_time, job_name))
                    report["job_assignments_count"][job_name] += 1
                    assigned[(task_val, s_idx)].append(e)
            solution_grid[emp_name] = row
            report["employee_stats"].append({
                "employee": emp_name,
                "W_count": work_count,
                "R_count": rest_count,
                "schedule_details": details,
            })
        for job_int, s_rel in self.all_demanded_job_slots:
            if len(assigned.get((job_int, s_rel), [])) != 1:
                job_name = self.int_to_job_code.get(job_int, f"JOB_{job_int}")
                slot_time = slot_to_time_str(s_rel + self.schedule_start_slot)
                report["unfilled_job_slots"].append({
                    "job_code": job_name,
                    "time_slot": slot_time,
                    "reason": "重算後仍未填補（已鎖定／離開人手限制）",
                })
        return solution_grid, report

    def _solve_once(self, level, time_limit):
        model = cp_model.CpModel()
        tasks = {}
        is_work = {}
        domain_values = [REST_R_CODE] + self.all_job_ints
        if not domain_values:
            domain_values = [REST_R_CODE]

        for e in range(self.num_employees):
            for s in range(self.num_slots):
                tasks[e, s] = model.NewIntVarFromDomain(
                    cp_model.Domain.FromValues(domain_values), f'task_e{e}_s{s}'
                )
                is_work[e, s] = model.NewBoolVar(f'is_work_e{e}_s{s}')
                model.Add(tasks[e, s] != REST_R_CODE).OnlyEnforceIf(is_work[e, s])
                model.Add(tasks[e, s] == REST_R_CODE).OnlyEnforceIf(is_work[e, s].Not())

        # Locks (已確認 / 過去 / 走咗後不可用)
        for (e, s), job_val in self.locked_emp_slots.items():
            model.Add(tasks[e, s] == job_val)

        # Do not assign a job in a slot with no demand, unless that cell is locked.
        for e in range(self.num_employees):
            for s in range(self.num_slots):
                if (e, s) in self.locked_emp_slots:
                    continue
                for job_int_val in self.all_job_ints:
                    if not self.job_demands[job_int_val][s]:
                        model.Add(tasks[e, s] != job_int_val)

        apply_work_rules = level in (LEVEL_FULL, LEVEL_RELAXED)
        skip_locked_windows = level == LEVEL_RELAXED

        if apply_work_rules:
            for e in range(self.num_employees):
                for s in range(self.num_slots - self.max_consecutive_work_slots):
                    window = range(self.max_consecutive_work_slots + 1)
                    if skip_locked_windows and any((e, s + i) in self.locked_emp_slots for i in window):
                        continue
                    model.Add(sum(is_work[e, s + i] for i in window) <= self.max_consecutive_work_slots)

                if self.rest_slots_after_consecutive_work > 0:
                    limit = self.num_slots - self.max_consecutive_work_slots - self.rest_slots_after_consecutive_work + 1
                    for s in range(max(0, limit)):
                        work_range = range(self.max_consecutive_work_slots)
                        rest_range = range(self.rest_slots_after_consecutive_work)
                        if skip_locked_windows and (
                            any((e, s + i) in self.locked_emp_slots for i in work_range)
                            or any((e, s + self.max_consecutive_work_slots + j) in self.locked_emp_slots for j in rest_range)
                        ):
                            continue
                        b_consecutive_work = model.NewBoolVar(f'emp{e}_consec_work_at_s{s}_{level}')
                        work_literals = [is_work[e, s + i] for i in work_range]
                        model.AddBoolAnd(work_literals).OnlyEnforceIf(b_consecutive_work)
                        model.AddBoolOr([lit.Not() for lit in work_literals]).OnlyEnforceIf(b_consecutive_work.Not())
                        for j in rest_range:
                            rest_slot_index = s + self.max_consecutive_work_slots + j
                            model.Add(tasks[e, rest_slot_index] == REST_R_CODE).OnlyEnforceIf(b_consecutive_work)

            # Same job if two consecutive slots are both work
            for e in range(self.num_employees):
                for s in range(1, self.num_slots):
                    if skip_locked_windows and (
                        (e, s - 1) in self.locked_emp_slots or (e, s) in self.locked_emp_slots
                    ):
                        continue
                    model.Add(tasks[e, s - 1] == tasks[e, s]).OnlyEnforceIf([is_work[e, s - 1], is_work[e, s]])

            if self.enable_mandatory_break and not self.model_definitely_infeasible:
                span = self.global_consecutive_break_end_rel - self.global_consecutive_break_start_rel
                if span >= self.min_consecutive_rest_slots:
                    for e in range(self.num_employees):
                        possible_consecutive_rest_starts = []
                        for offset in range(span - self.min_consecutive_rest_slots + 1):
                            start_rel = self.global_consecutive_break_start_rel + offset
                            b_rest = model.NewBoolVar(f'emp{e}_consec_R_at_s{start_rel}_{level}')
                            literals = []
                            for i in range(self.min_consecutive_rest_slots):
                                s_is_rest = model.NewBoolVar(f'emp{e}_s{start_rel + i}_isR_{level}_{i}')
                                model.Add(tasks[e, start_rel + i] == REST_R_CODE).OnlyEnforceIf(s_is_rest)
                                model.Add(tasks[e, start_rel + i] != REST_R_CODE).OnlyEnforceIf(s_is_rest.Not())
                                literals.append(s_is_rest)
                            model.AddMinEquality(b_rest, literals)
                            possible_consecutive_rest_starts.append(b_rest)
                        if possible_consecutive_rest_starts:
                            model.AddBoolOr(possible_consecutive_rest_starts)

        unfilled_demands_penalties = []
        demand_met_vars = {}
        for job_int, s_rel in self.all_demanded_job_slots:
            assigned_employees = []
            for e_idx in range(self.num_employees):
                b_is_assigned = model.NewBoolVar(f'emp{e_idx}_j{job_int}_s{s_rel}_{level}')
                model.Add(tasks[e_idx, s_rel] == job_int).OnlyEnforceIf(b_is_assigned)
                model.Add(tasks[e_idx, s_rel] != job_int).OnlyEnforceIf(b_is_assigned.Not())
                assigned_employees.append(b_is_assigned)
            current_demand_met = model.NewBoolVar(f'demand_met_j{job_int}_s{s_rel}_{level}')
            # One person per track-slot: never double-book a job cell.
            model.Add(sum(assigned_employees) <= 1)
            model.Add(sum(assigned_employees) == 1).OnlyEnforceIf(current_demand_met)
            model.Add(sum(assigned_employees) == 0).OnlyEnforceIf(current_demand_met.Not())
            unfilled_demands_penalties.append(current_demand_met.Not())
            demand_met_vars[(job_int, s_rel)] = current_demand_met

        work_slots = []
        diff_w = None
        if self.num_employees > 0:
            work_slots = [model.NewIntVar(0, self.num_slots, f'ws_e{e}_{level}') for e in range(self.num_employees)]
            for e in range(self.num_employees):
                model.Add(work_slots[e] == sum(is_work[e, s] for s in range(self.num_slots)))
            min_w = model.NewIntVar(0, self.num_slots, f'min_w_{level}')
            max_w = model.NewIntVar(0, self.num_slots, f'max_w_{level}')
            model.AddMinEquality(min_w, work_slots)
            model.AddMaxEquality(max_w, work_slots)
            diff_w = model.NewIntVar(0, self.num_slots, f'diff_w_{level}')
            model.Add(diff_w == max_w - min_w)
            if not self.soften_workload_balance and level == LEVEL_FULL:
                model.Add(diff_w <= 1)

        # Primary objective: minimise unfilled demand. Workload spread is tiny.
        obj_terms = []
        if unfilled_demands_penalties:
            gap_count = model.NewIntVar(0, len(unfilled_demands_penalties), f'gap_count_{level}')
            model.Add(gap_count == sum(unfilled_demands_penalties))
            obj_terms.append(gap_count * GAP_PENALTY)
        if diff_w is not None and self.soften_workload_balance and level != LEVEL_FILL:
            obj_terms.append(diff_w)
        if obj_terms:
            model.Minimize(sum(obj_terms))

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = float(time_limit)
        status = solver.Solve(model)

        report = self._empty_report(solver.StatusName(status))
        report["solve_level"] = level
        solution_grid = {}

        if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            for e in range(self.num_employees):
                emp_name = self.employee_names[e]
                solution_grid[emp_name] = [""] * self.num_slots
                work_count = 0
                rest_count = 0
                current_schedule_display = []
                for s_idx in range(self.num_slots):
                    task_val = solver.Value(tasks[e, s_idx])
                    slot_time_str_display = slot_to_time_str(s_idx + self.schedule_start_slot)
                    if task_val == REST_R_CODE:
                        solution_grid[emp_name][s_idx] = "R"
                        current_schedule_display.append((slot_time_str_display, "R"))
                        rest_count += 1
                    else:
                        job_name = self.int_to_job_code.get(task_val, f"JOB_{task_val}")
                        solution_grid[emp_name][s_idx] = job_name
                        current_schedule_display.append((slot_time_str_display, job_name))
                        work_count += 1
                        report["job_assignments_count"][job_name] += 1
                report["employee_stats"].append({
                    "employee": emp_name,
                    "W_count": work_count,
                    "R_count": rest_count,
                    "schedule_details": current_schedule_display,
                })
            for (job_int, s_rel), met_var in demand_met_vars.items():
                if not solver.Value(met_var):
                    job_name = self.int_to_job_code.get(job_int, f"JOB_{job_int}")
                    slot_time_str_display = slot_to_time_str(s_rel + self.schedule_start_slot)
                    report["unfilled_job_slots"].append({
                        "job_code": job_name,
                        "time_slot": slot_time_str_display,
                        "reason": "未能為此崗位時段找到合適員工",
                    })
            return True, solution_grid, report

        if status == cp_model.INFEASIBLE:
            report["infeasible_reason"] = f"求解器判定模型不可行（約束級別: {level}）。"
        else:
            report["infeasible_reason"] = f"求解失敗，狀態: {solver.StatusName(status)}"
        for job_int_val, s_rel_val in self.all_demanded_job_slots:
            job_name_val = self.int_to_job_code.get(job_int_val, f"JOB_{job_int_val}")
            slot_time_str_val = slot_to_time_str(s_rel_val + self.schedule_start_slot)
            report["unfilled_job_slots"].append({
                "job_code": job_name_val,
                "time_slot": slot_time_str_val,
                "reason": f"模型求解失敗或不可行 ({solver.StatusName(status)})",
            })
        return False, {}, report

    def solve(self):
        if self.model_definitely_infeasible:
            grid, report = self._locks_only_grid(self.infeasible_reason)
            report["status"] = "INFEASIBLE_PRE_SOLVE"
            # Still attempt CP-SAT locks-only so 重算 always hits the solver.
            ok, solved_grid, solved_report = self._solve_once(LEVEL_LOCKS, min(self.max_solve_seconds, 20.0))
            if ok:
                solved_report["status_note"] = "先決條件不足，已用鎖定格求近似解，剩餘空缺見列表。"
                return solved_grid, solved_report
            return grid, report

        remaining = max(8.0, self.max_solve_seconds)
        spent = 0.0
        last_report = None
        best = None  # (gap_count, grid, report)

        def take(ok, grid, report):
            nonlocal best, last_report
            last_report = report
            if not ok:
                return None
            gaps = len(report.get("unfilled_job_slots") or [])
            if best is None or gaps < best[0]:
                best = (gaps, grid, report)
            return gaps

        def next_budget(share, floor=8.0):
            nonlocal spent
            left = max(4.0, remaining - spent)
            budget = min(left, max(floor, remaining * share))
            spent += budget
            return budget

        def run_level(level, share, floor):
            budget = next_budget(share, floor)
            print(f"CP-SAT 重算：level={level}, budget={budget:.1f}s, locks={len(self.locked_emp_slots)}")
            ok, grid, report = self._solve_once(level, budget)
            return ok, grid, report, take(ok, grid, report)

        ok, grid, report, gaps = run_level(LEVEL_FULL, 0.35, 8.0)
        if gaps == 0:
            return grid, report

        # Only spend time on relaxed if the hard pack was infeasible (locks may already
        # violate consecutive-work). If FULL was feasible-but-gappy, skip to fill-first.
        if not ok:
            ok_r, grid_r, report_r, gaps_r = run_level(LEVEL_RELAXED, 0.2, 6.0)
            if gaps_r == 0:
                report_r["status_note"] = (
                    "完整約束無解，已放寬與鎖定格重疊的連續工時／連崗規則。已確認同過去時段維持不變。"
                )
                return grid_r, report_r

        if best is None or best[0] > 0:
            ok_f, grid_f, report_f, gaps_f = run_level(LEVEL_FILL, 0.55, 10.0)
            if ok_f:
                n = 0 if gaps_f is None else gaps_f
                report_f["status_note"] = (
                    "優先填滿空缺：已放寬連續工時／同一崗位連續，先盡量填晒需求。"
                    + ("崗位需求已填滿。" if n == 0 else f"仍剩 {n} 格未填（人手或鎖定限制）。")
                )

        if best:
            _gaps, grid, report = best
            level = report.get("solve_level")
            if level == LEVEL_FILL and not report.get("status_note"):
                report["status_note"] = (
                    "優先填滿空缺：已放寬連續工時／同一崗位連續。"
                    + (f"仍剩 {_gaps} 格未填。" if _gaps else "崗位需求已填滿。")
                )
            elif level == LEVEL_RELAXED and not report.get("status_note"):
                report["status_note"] = (
                    "完整約束無解，已放寬與鎖定格重疊的連續工時／連崗規則。已確認同過去時段維持不變。"
                )
            return grid, report

        grid, report = self._locks_only_grid(
            last_report.get("infeasible_reason") if last_report else "求解失敗"
        )
        if last_report:
            report["solver_last_status"] = last_report.get("status")
        return grid, report
