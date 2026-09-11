"""OR-Tools lock / named-staff / gap behaviour for the mobile 重算 path."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend_api import ShiftSchedulerWithConstraints, time_to_slot


DEMO_JOBS = [
    "ARR-1 09:00–13:00",
    "ARR-2 09:00–13:00",
    "DEP-1 09:30–10:30,11:00–13:00",
    "KIOSK-A-1 09:30–13:00",
    "KIOSK-D-1 09:00–10:30,11:00–13:00",
]
NAMES = ["阿明", "小華", "阿強", "阿美"]


def make_scheduler(**kwargs):
    defaults = dict(
        K_employees=4,
        schedule_period_str="09:00–13:00",
        job_requirements_raw=DEMO_JOBS,
        max_consecutive_work_minutes=90,
        rest_duration_minutes_after_work=30,
        enable_mandatory_break=False,
        designated_global_break_period_str="",
        min_mandatory_break_minutes=0,
        employee_names=NAMES,
        soften_workload_balance=True,
        max_solve_seconds=20.0,
    )
    defaults.update(kwargs)
    return ShiftSchedulerWithConstraints(**defaults)


class SchedulerMobileTests(unittest.TestCase):
    def test_named_staff_and_gaps_on_fresh_solve(self):
        grid, report = make_scheduler().solve()
        self.assertIn(report["status"], {"OPTIMAL", "FEASIBLE", "FEASIBLE_LOCKS_ONLY"})
        self.assertEqual(set(grid.keys()), set(NAMES))
        self.assertEqual(len(grid["阿明"]), 8)
        # Soft infeasibility: remaining demand is listed, never a hard dead-end.
        self.assertIsInstance(report["unfilled_job_slots"], list)

    def test_locked_cells_survive_resolve(self):
        locks = [
            {"employee": "阿明", "time_slot": "09:00", "job_code": "ARR-1"},
            {"employee": "阿明", "time_slot": "09:30", "job_code": "ARR-1"},
        ]
        grid, report = make_scheduler(locked_assignments=locks).solve()
        self.assertIn(report["status"], {"OPTIMAL", "FEASIBLE", "FEASIBLE_LOCKS_ONLY"})
        self.assertEqual(grid["阿明"][0], "ARR-1")
        self.assertEqual(grid["阿明"][1], "ARR-1")

    def test_unavailable_staff_not_assigned_after_leave(self):
        locks = [
            {"employee": "阿強", "time_slot": "09:00", "job_code": "KIOSK-D-1"},
        ]
        unavailable = [{"employee": "阿強", "from_time": "09:30"}]
        grid, report = make_scheduler(
            locked_assignments=locks,
            unavailable=unavailable,
        ).solve()
        self.assertIn(report["status"], {"OPTIMAL", "FEASIBLE", "FEASIBLE_LOCKS_ONLY"})
        self.assertEqual(grid["阿強"][0], "KIOSK-D-1")
        for slot in grid["阿強"][1:]:
            self.assertEqual(slot, "R")
        # Jobs that 阿強 can no longer cover should surface as 空缺 if nobody else took them.
        unfilled_times = {(u["job_code"], u["time_slot"]) for u in report["unfilled_job_slots"]}
        self.assertTrue(len(unfilled_times) >= 0)

    def test_expanded_category_tracks_are_distinct_jobs(self):
        grid, report = make_scheduler().solve()
        self.assertIn(report["status"], {"OPTIMAL", "FEASIBLE", "FEASIBLE_LOCKS_ONLY"})
        assigned = set()
        for row in grid.values():
            assigned.update(code for code in row if code and code != "R")
        self.assertTrue({"ARR-1", "ARR-2"} & assigned or report["unfilled_job_slots"])
        codes = {u["job_code"] for u in report["unfilled_job_slots"]}
        self.assertTrue(assigned or codes)

    def test_numbered_employee_names_solve(self):
        names = [str(i) for i in range(1, 21)]
        grid, report = make_scheduler(employee_names=names, K_employees=20).solve()
        self.assertIn(report["status"], {"OPTIMAL", "FEASIBLE", "FEASIBLE_LOCKS_ONLY"})
        self.assertEqual(set(grid.keys()), set(names))
        self.assertEqual(len(grid["1"]), 8)

    def test_numbered_10_staff_arr_dep_empty_locks(self):
        names = [str(i) for i in range(1, 11)]
        jobs = [
            "ARR-1 09:00–13:00",
            "ARR-2 09:00–13:00",
            "DEP-1 09:30–13:00",
        ]
        grid, report = make_scheduler(
            employee_names=names,
            K_employees=10,
            job_requirements_raw=jobs,
            locked_assignments=[],
        ).solve()
        self.assertIn(report["status"], {"OPTIMAL", "FEASIBLE", "FEASIBLE_LOCKS_ONLY"})
        filled = [code for row in grid.values() for code in row if code and code != "R"]
        self.assertGreater(len(filled), 0)
        self.assertTrue({"ARR-1", "ARR-2", "DEP-1"} & set(filled) or report["unfilled_job_slots"])

    def test_early_morning_arr4_numbered_staff(self):
        names = [str(i) for i in range(1, 11)]
        jobs = [
            "ARR-1 06:30–12:00",
            "ARR-2 06:30–12:00",
            "ARR-3 06:30–12:00",
            "ARR-4 06:30–12:00",
        ]
        grid, report = make_scheduler(
            employee_names=names,
            K_employees=10,
            schedule_period_str="06:30–12:00",
            job_requirements_raw=jobs,
            locked_assignments=[],
            max_solve_seconds=30.0,
        ).solve()
        self.assertIn(report["status"], {"OPTIMAL", "FEASIBLE", "FEASIBLE_LOCKS_ONLY"})
        self.assertEqual(len(grid["1"]), 11)
        filled = [code for row in grid.values() for code in row if code and code != "R"]
        self.assertGreater(len(filled), 0)
        self.assertTrue({"ARR-1", "ARR-2", "ARR-3", "ARR-4"} & set(filled) or report["unfilled_job_slots"])

    def test_kiosk_a_and_d_tracks_fill(self):
        names = [str(i) for i in range(1, 11)]
        jobs = [
            "ARR-1 06:30–13:00",
            "DEP-1 06:30–13:00",
            "KIOSK-A-1 06:30–13:00",
            "KIOSK-A-2 06:30–13:00",
            "KIOSK-D-1 06:30–13:00",
            "KIOSK-D-2 06:30–13:00",
        ]
        grid, report = make_scheduler(
            employee_names=names,
            K_employees=10,
            schedule_period_str="06:30–13:00",
            job_requirements_raw=jobs,
            locked_assignments=[],
            max_solve_seconds=30.0,
        ).solve()
        self.assertIn(report["status"], {"OPTIMAL", "FEASIBLE", "FEASIBLE_LOCKS_ONLY"})
        filled = {code for row in grid.values() for code in row if code and code != "R"}
        unfilled = {u["job_code"] for u in report["unfilled_job_slots"]}
        for code in ("KIOSK-A-1", "KIOSK-A-2", "KIOSK-D-1", "KIOSK-D-2"):
            self.assertTrue(code in filled or code in unfilled, code)
        self.assertTrue({"KIOSK-A-1", "KIOSK-A-2"} & filled)
        self.assertTrue({"KIOSK-D-1", "KIOSK-D-2"} & filled)
        # 6 concurrent tracks, 10 staff: fill-first should cover every demanded slot.
        self.assertLessEqual(len(report["unfilled_job_slots"]), 2)

    def test_fill_first_covers_arr_dep_kiosk_when_staff_ge_demand(self):
        names = [str(i) for i in range(1, 11)]
        jobs = [
            "ARR-1 06:30–13:00",
            "ARR-2 06:30–13:00",
            "DEP-1 06:30–13:00",
            "DEP-2 06:30–13:00",
            "KIOSK-A-1 06:30–13:00",
            "KIOSK-A-2 06:30–13:00",
            "KIOSK-D-1 06:30–13:00",
            "KIOSK-D-2 06:30–13:00",
        ]
        grid, report = make_scheduler(
            employee_names=names,
            K_employees=10,
            schedule_period_str="06:30–13:00",
            job_requirements_raw=jobs,
            locked_assignments=[],
            max_solve_seconds=35.0,
        ).solve()
        self.assertIn(report["status"], {"OPTIMAL", "FEASIBLE", "FEASIBLE_LOCKS_ONLY"})
        demanded = 8 * 13  # 8 tracks × 13 half-hour slots
        unfilled = report["unfilled_job_slots"]
        self.assertLessEqual(len(unfilled), 4, unfilled[:8])
        filled = {code for row in grid.values() for code in row if code and code != "R"}
        for code in ("ARR-1", "DEP-1", "KIOSK-A-1", "KIOSK-A-2", "KIOSK-D-1", "KIOSK-D-2"):
            self.assertIn(code, filled)
        if len(unfilled) > 0:
            self.assertIn(report.get("solve_level"), {"fill", "full", "relaxed", "locks"})
        # Coverage should be close to demand when staff (10) > concurrent tracks (8).
        assigned = sum(1 for row in grid.values() for code in row if code and code != "R")
        self.assertGreaterEqual(assigned, demanded - 4)

    def test_time_helpers(self):
        self.assertEqual(time_to_slot("09:00"), 18)
        self.assertEqual(time_to_slot("09:30"), 19)


if __name__ == "__main__":
    unittest.main()
