# backend_api.py
from flask import Flask, request, jsonify
from ortools.sat.python import cp_model
import collections
import math # 用於向上取整

# --- 輔助函數 (time_to_slot, slot_to_time_str, parse_time_range) ---
# (假設這些函數已存在且功能正確，特別是 parse_time_range 支持 HH:MM-HH:MM 或 HH:MM–HH:MM)
def time_to_slot(time_str):
    try:
        h, m = map(int, time_str.split(':'))
        # 允許小時 >= 24
        return h * 2 + m // 30
    except ValueError:
        # 在 API 層面不直接調用 st.error，而是返回錯誤或記錄日誌
        print(f"時間格式錯誤: '{time_str}'")
        return None

def slot_to_time_str(slot_index):
    h = slot_index // 2
    m = (slot_index % 2) * 30
    return f"{h:02d}:{m:02d}"

def parse_time_range(range_str, context_for_error="時段"):
    try:
        separator = None
        if '–' in range_str: # EN DASH
            separator = '–'
        elif '-' in range_str: # HYPHEN
            separator = '-'

        if separator is None:
            raise ValueError("範圍中未找到有效的分隔符 ('–' 或 '-')。")

        start_str, end_str = range_str.split(separator)
        start_slot = time_to_slot(start_str.strip())
        end_slot = time_to_slot(end_str.strip())

        if start_slot is None or end_slot is None:
             # time_to_slot 返回 None 時已打印錯誤
             raise ValueError(f"'{start_str if start_slot is None else end_str}' 時間格式不正確。")
        return start_slot, end_slot
    except Exception as e:
        print(f"{context_for_error} '{range_str}' 解析錯誤: {e}")
        # 在 API 層拋出異常，讓上層處理
        raise ValueError(f"{context_for_error} '{range_str}' 格式錯誤或解析失敗: {e}")


# --- 常量 ---
REST_R_CODE = 0
FIRST_JOB_CODE = 1

# --- 排班核心邏輯類 (ShiftSchedulerWithConstraints) ---
# (將之前的 ShiftSchedulerGlobalBreak 類的邏輯放在這裡，並進行修改)
class ShiftSchedulerWithConstraints:
    def __init__(self,
                 K_employees,
                 schedule_period_str,
                 job_requirements_raw,
                 max_consecutive_work_minutes,
                 # break_after_consecutive_work_minutes, # 這個參數我們之前討論過，可能未使用或有其他用途
                                                         # 現在我們明確引入新的參數
                 rest_duration_minutes_after_work, # <--- 新增參數
                 enable_mandatory_break,
                 designated_global_break_period_str,
                 min_mandatory_break_minutes
                ):
        self.num_employees = K_employees

        # 1. 解析排班總時段 (這部分不變)
        # ... (你已有的代碼) ...
        parsed_schedule_start_slot, parsed_schedule_end_slot = parse_time_range(schedule_period_str, "排班總時段")
        self.schedule_start_slot, self.schedule_end_slot = parsed_schedule_start_slot, parsed_schedule_end_slot
        self.num_slots = self.schedule_end_slot - self.schedule_start_slot
        if self.num_slots <= 0:
            raise ValueError(f"排班時段 '{schedule_period_str}' 無效。結束時間的小時數在跨天時應 >=24。")

        # 2. 處理排班約束條件轉換 (這部分不變，除了新增的)
        self.slot_duration_minutes = 30
        self.max_consecutive_work_slots = math.ceil(max_consecutive_work_minutes / self.slot_duration_minutes)
        if self.max_consecutive_work_slots <= 0:
             raise ValueError("最大連續工作時間必須大於0分鐘。")

        # --- 新增：計算連續工作達到上限後的強制休息格數 ---
        if rest_duration_minutes_after_work == 30:
            self.rest_slots_after_consecutive_work = 1
        elif rest_duration_minutes_after_work == 60:
            self.rest_slots_after_consecutive_work = 2
        else:
            # API 層面應該已經驗證了，但作為備份，可以設置一個默認值或再次拋出錯誤
            # 根據題目要求，值只會是 30 或 60
            # 假設如果傳入無效值，默認為30分鐘/1格 (或者更嚴格地拋出ValueError)
            print(f"警告: 無效的 rest_duration_minutes_after_work ({rest_duration_minutes_after_work})，"
                  f"將默認為1格 (30分鐘)。API應確保此值有效。")
            self.rest_slots_after_consecutive_work = 1
        
        print(f"調試信息: max_consecutive_work_slots = {self.max_consecutive_work_slots}, "
              f"rest_slots_after_consecutive_work = {self.rest_slots_after_consecutive_work}")

        # 3. 處理強制落場規定
        self.enable_mandatory_break = enable_mandatory_break
        self.min_consecutive_rest_slots = 0
        self.global_consecutive_break_start_rel = -1 # 初始值設為無效
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
            # if abs_break_start is None or abs_break_end is None:
            #      raise ValueError(f"必要參數錯誤：全局落場時段 '{designated_global_break_period_str}'。")

            self.global_consecutive_break_start_rel = max(0, abs_break_start - self.schedule_start_slot)
            self.global_consecutive_break_end_rel = min(self.num_slots, abs_break_end - self.schedule_start_slot)

            if self.global_consecutive_break_end_rel - self.global_consecutive_break_start_rel < self.min_consecutive_rest_slots:
                self.model_definitely_infeasible = True
                self.infeasible_reason = (f"錯誤: 全局指定落場時段 '{designated_global_break_period_str}' "
                                          f"(排班表內相對時段 {self.global_consecutive_break_start_rel} 至 "
                                          f"{self.global_consecutive_break_end_rel-1}) "
                                          f"有效長度不足以安排 {self.min_consecutive_rest_slots} 格連續休息 ({min_mandatory_break_minutes}分鐘)。")

        # 4. 處理崗位需求 (與之前相同)
        self.job_code_to_int = {}
        self.int_to_job_code = {}
        current_job_int = FIRST_JOB_CODE
        self.job_demands = collections.defaultdict(lambda: [False] * self.num_slots)
        self.all_demanded_job_slots = []
        # ... (崗位解析邏輯，與上一個版本相同) ...
        for req_line_idx, req_line in enumerate(job_requirements_raw):
            req_line_stripped = req_line.strip()
            if not req_line_stripped: continue
            parts = req_line_stripped.split(" ", 1)
            if len(parts) < 2: raise ValueError(f"崗位需求第 {req_line_idx+1} 行 '{req_line_stripped}' 格式錯誤: 應為 '代碼 時段1,...'")
            job_code_str = parts[0]; time_ranges_str = parts[1]
            if job_code_str not in self.job_code_to_int:
                self.job_code_to_int[job_code_str] = current_job_int; self.int_to_job_code[current_job_int] = job_code_str; current_job_int += 1
            job_int_val = self.job_code_to_int[job_code_str]
            for time_range_idx, time_range in enumerate(time_ranges_str.split(',')):
                time_range_stripped = time_range.strip(); 
                if not time_range_stripped: continue
                context = f"崗位 '{job_code_str}' 的第 {time_range_idx+1} 個時段"
                start_abs, end_abs = parse_time_range(time_range_stripped, context)
                # if start_abs is None or end_abs is None: raise ValueError(f"必要參數錯誤：{context} '{time_range_stripped}'。")
                if end_abs <= start_abs: raise ValueError(f"{context} '{time_range_stripped}'：結束時間必須晚於開始時間。")
                for s_abs in range(start_abs, end_abs):
                    if self.schedule_start_slot <= s_abs < self.schedule_end_slot:
                        s_relative = s_abs - self.schedule_start_slot
                        if not self.job_demands[job_int_val][s_relative]:
                            self.job_demands[job_int_val][s_relative] = True; self.all_demanded_job_slots.append((job_int_val, s_relative))
        self.all_job_ints = sorted(list(self.job_code_to_int.values()))

    def solve(self):
        # ... (變量定義 tasks = {}, is_work = {} 等，這些不變) ...
        model = cp_model.CpModel()
        tasks = {}
        is_work = {}
        for e in range(self.num_employees):
            for s in range(self.num_slots):
                domain_values = [REST_R_CODE] + self.all_job_ints
                tasks[e, s] = model.NewIntVarFromDomain(cp_model.Domain.FromValues(domain_values), f'task_e{e}_s{s}')
                is_work[e, s] = model.NewBoolVar(f'is_work_e{e}_s{s}')
                model.Add(tasks[e, s] != REST_R_CODE).OnlyEnforceIf(is_work[e, s])
                model.Add(tasks[e, s] == REST_R_CODE).OnlyEnforceIf(is_work[e, s].Not())

        # ... (防止超額分配的規則，這部分不變) ...
        for e in range(self.num_employees):
            for s in range(self.num_slots):
                for job_int_val in self.all_job_ints:
                    if not self.job_demands[job_int_val][s]:
                        model.Add(tasks[e,s] != job_int_val)


        # --- 硬性規則 1: 連續工作限制 與 強制後續休息 ---
        # (替換或修改你現有的規則1部分)
        print(f"應用硬性規則1: 最大連續工作 {self.max_consecutive_work_slots} 格, "
              f"之後強制休息 {self.rest_slots_after_consecutive_work} 格。")

        for e in range(self.num_employees):
            # A. 原有的最大連續工作限制：不允許連續工作超過 max_consecutive_work_slots
            #    即：任何 (max_consecutive_work_slots + 1) 長度的窗口內，工作數不能為 (max_consecutive_work_slots + 1)
            #    這可以通過 sum <= max_consecutive_work_slots 來實現
            for s in range(self.num_slots - self.max_consecutive_work_slots):
                model.Add(sum(is_work[e, s + i] for i in range(self.max_consecutive_work_slots + 1)) <= self.max_consecutive_work_slots)

            # B. 新增：如果在達到 max_consecutive_work_slots 後，強制休息 rest_slots_after_consecutive_work
            #    這個條件是：如果從 s 到 s + max_consecutive_work_slots - 1 這段時間都是工作，
            #    那麼從 s + max_consecutive_work_slots 到 s + max_consecutive_work_slots + rest_slots_after_consecutive_work - 1
            #    這段時間必須是休息 (is_work 為 False)。
            if self.rest_slots_after_consecutive_work > 0:
                # 遍歷所有可能的起始時隙 s，使得一個完整的工作塊和隨後的休息塊能放入總時隙內
                # 工作塊長度: self.max_consecutive_work_slots
                # 休息塊長度: self.rest_slots_after_consecutive_work
                # 因此，最後一個休息格的索引是 s + self.max_consecutive_work_slots + self.rest_slots_after_consecutive_work - 1
                # 這個索引必須 < self.num_slots
                # 所以 s < self.num_slots - self.max_consecutive_work_slots - self.rest_slots_after_consecutive_work + 1
                limit = self.num_slots - self.max_consecutive_work_slots - self.rest_slots_after_consecutive_work + 1
                
                for s in range(limit):
                    # 創建一個布爾變量 B，表示從 s 開始是否連續工作了 max_consecutive_work_slots
                    # B is true IF AND ONLY IF is_work[e, s+i] is true for all i in range(max_consecutive_work_slots)
                    b_consecutive_work = model.NewBoolVar(f'emp{e}_consec_work_at_s{s}')
                    
                    work_literals = [is_work[e, s + i] for i in range(self.max_consecutive_work_slots)]
                    model.AddBoolAnd(work_literals).OnlyEnforceIf(b_consecutive_work)
                    model.AddBoolOr([lit.Not() for lit in work_literals]).OnlyEnforceIf(b_consecutive_work.Not())

                    # 如果 b_consecutive_work 為 True，則接下來的 rest_slots_after_consecutive_work 必須為休息
                    # (is_work 為 False，或者說 tasks == REST_R_CODE)
                    for j in range(self.rest_slots_after_consecutive_work):
                        rest_slot_index = s + self.max_consecutive_work_slots + j
                        # model.Add(is_work[e, rest_slot_index] == False).OnlyEnforceIf(b_consecutive_work)
                        # 或者更直接地，如果 tasks[e, rest_slot_index] 必須是 REST_R_CODE
                        model.Add(tasks[e, rest_slot_index] == REST_R_CODE).OnlyEnforceIf(b_consecutive_work)
                        # 為了確保 is_work 也同步更新 (雖然理論上 task==REST_R_CODE 就意味著 is_work==False)
                        # model.Add(is_work[e, rest_slot_index] == False).OnlyEnforceIf(b_consecutive_work)

        # --- 硬性規則 2: 工作連續性 (同崗或休息) ---
        for e in range(self.num_employees): # (同前)
            for s in range(1, self.num_slots): model.Add(tasks[e,s-1] == tasks[e,s]).OnlyEnforceIf([is_work[e,s-1], is_work[e,s]])

        # --- 硬性規則 3: 強制落場 (如果啟用) ---
        if self.enable_mandatory_break:
            if self.model_definitely_infeasible: # 已在 __init__ 中判斷
                 pass # 將在 pre-solve 檢查中處理
            elif self.global_consecutive_break_end_rel - self.global_consecutive_break_start_rel < self.min_consecutive_rest_slots:
                 self.model_definitely_infeasible = True # 再次確保標記
                 if not self.infeasible_reason: self.infeasible_reason = "全局落場時段長度不足。"
            else:
                # --- (強制連續休息的邏輯，同上一個版本，使用 self.min_consecutive_rest_slots) ---
                for e in range(self.num_employees):
                    possible_consecutive_rest_starts = []
                    search_len = self.global_consecutive_break_end_rel - self.global_consecutive_break_start_rel
                    for offset in range(search_len - self.min_consecutive_rest_slots + 1):
                        start_rel = self.global_consecutive_break_start_rel + offset
                        b_rest = model.NewBoolVar(f'emp{e}_consec_R_at_s{start_rel}')
                        literals = []
                        for i in range(self.min_consecutive_rest_slots):
                            s_is_rest = model.NewBoolVar(f'emp{e}_s{start_rel+i}_isR_for_b{b_rest.Name()}_{i}')
                            model.Add(tasks[e, start_rel + i] == REST_R_CODE).OnlyEnforceIf(s_is_rest)
                            model.Add(tasks[e, start_rel + i] != REST_R_CODE).OnlyEnforceIf(s_is_rest.Not())
                            literals.append(s_is_rest)
                        model.AddMinEquality(b_rest, literals)
                        possible_consecutive_rest_starts.append(b_rest)
                    if possible_consecutive_rest_starts: model.AddBoolOr(possible_consecutive_rest_starts)
                    else: self.model_definitely_infeasible = True; self.infeasible_reason = f"員工 {e+1} 在落場時段內無有效休息起始點。"; break

        # --- 硬性規則 4: 崗位需求覆蓋 (需求人數始終為1) ---
        unfilled_demands_penalties = []; self.demand_met_vars = {} 
        if not self.model_definitely_infeasible: # (同前)
             for job_int, s_rel in self.all_demanded_job_slots:
                assigned_employees = []; 
                for e_idx in range(self.num_employees): b_is_assigned = model.NewBoolVar(f'emp{e_idx}_j{job_int}_s{s_rel}'); model.Add(tasks[e_idx,s_rel] == job_int).OnlyEnforceIf(b_is_assigned); model.Add(tasks[e_idx,s_rel] != job_int).OnlyEnforceIf(b_is_assigned.Not()); assigned_employees.append(b_is_assigned)
                current_demand_met = model.NewBoolVar(f'demand_met_j{job_int}_s{s_rel}'); model.Add(sum(assigned_employees) == 1).OnlyEnforceIf(current_demand_met); model.Add(sum(assigned_employees) != 1).OnlyEnforceIf(current_demand_met.Not()); unfilled_demands_penalties.append(current_demand_met.Not()); self.demand_met_vars[(job_int, s_rel)] = current_demand_met

        # --- 軟性規則 5: 工作量平衡 (+-1) ---
        if not self.model_definitely_infeasible and self.num_employees > 0: # (同前)
            work_slots = [model.NewIntVar(0, self.num_slots, f'ws_e{e}') for e in range(self.num_employees)]
            for e in range(self.num_employees): model.Add(work_slots[e] == sum(is_work[e, s] for s in range(self.num_slots)))
            min_w = model.NewIntVar(0, self.num_slots, 'min_w'); max_w = model.NewIntVar(0, self.num_slots, 'max_w'); model.AddMinEquality(min_w, work_slots); model.AddMaxEquality(max_w, work_slots); diff_w = model.NewIntVar(0, self.num_slots, 'diff_w'); model.Add(diff_w == max_w - min_w); model.Add(diff_w <= 1) 

        # --- 目標函數 ---
        if unfilled_demands_penalties: # (同前)
            model.Minimize(sum(unfilled_demands_penalties))

        # --- 提前檢查是否無解 ---
        if self.model_definitely_infeasible: # (同前)
            report = {"status": "INFEASIBLE_PRE_SOLVE", "employee_stats": [], "unfilled_job_slots": [], "job_assignments_count": collections.defaultdict(int), "infeasible_reason": self.infeasible_reason}
            for job_int_val, s_rel_val in self.all_demanded_job_slots: job_name_val = self.int_to_job_code.get(job_int_val, f"JOB_{job_int_val}"); slot_time_str_val = slot_to_time_str(s_rel_val + self.schedule_start_slot); report["unfilled_job_slots"].append({"job_code": job_name_val, "time_slot": slot_time_str_val, "reason": "模型因先決條件不滿足而無解"})
            return {}, report

        # --- 求解 ---
        solver = cp_model.CpSolver() # (同前)
        solver.parameters.max_time_in_seconds = 115.0
        status = solver.Solve(model)

        # --- 報告生成 ---
        solution_grid = {}; report = {"status": solver.StatusName(status), "employee_stats": [], "unfilled_job_slots": [], "job_assignments_count": collections.defaultdict(int)} # (同前)
        if status == cp_model.OPTIMAL or status == cp_model.FEASIBLE: # (報告生成邏輯同前)
            for e in range(self.num_employees):
                emp_name = f'K{e+1}'; solution_grid[emp_name] = [""] * self.num_slots; work_count = 0; rest_count = 0; current_schedule_display = []
                for s_idx in range(self.num_slots): 
                    task_val = solver.Value(tasks[e, s_idx]); actual_slot_abs = s_idx + self.schedule_start_slot; slot_time_str_display = slot_to_time_str(actual_slot_abs)
                    if task_val == REST_R_CODE: solution_grid[emp_name][s_idx] = "R"; current_schedule_display.append((slot_time_str_display, "R")); rest_count += 1
                    else: job_name = self.int_to_job_code.get(task_val, f"JOB_{task_val}"); solution_grid[emp_name][s_idx] = job_name; current_schedule_display.append((slot_time_str_display, job_name)); work_count += 1; report["job_assignments_count"][job_name] += 1
                report["employee_stats"].append({"employee": emp_name, "W_count": work_count, "R_count": rest_count, "schedule_details": current_schedule_display})
            if hasattr(self, 'demand_met_vars') and self.demand_met_vars : 
                for (job_int, s_rel), met_var in self.demand_met_vars.items():
                    if not solver.Value(met_var): job_name = self.int_to_job_code.get(job_int, f"JOB_{job_int}"); slot_time_str_display = slot_to_time_str(s_rel + self.schedule_start_slot); report["unfilled_job_slots"].append({"job_code": job_name, "time_slot": slot_time_str_display, "reason": "未能為此崗位時段找到合適員工"})
        elif status == cp_model.INFEASIBLE: report["infeasible_reason"] = "求解器判定模型不可行。" # (同前)
        else: report["infeasible_reason"] = f"求解失敗，狀態: {solver.StatusName(status)}" # (同前)
        if status == cp_model.INFEASIBLE or status == cp_model.UNKNOWN or status == cp_model.MODEL_INVALID: # Populate unfilled jobs for failure cases
            for job_int_val, s_rel_val in self.all_demanded_job_slots: job_name_val = self.int_to_job_code.get(job_int_val, f"JOB_{job_int_val}"); slot_time_str_val = slot_to_time_str(s_rel_val + self.schedule_start_slot); report["unfilled_job_slots"].append({"job_code": job_name_val, "time_slot": slot_time_str_val,"reason": f"模型求解失敗或不可行 ({solver.StatusName(status)})"})

        return solution_grid, report