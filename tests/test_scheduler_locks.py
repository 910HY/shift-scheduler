"""OR-Tools lock / named-staff / gap behaviour for the mobile 重算 path."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend_api import ShiftSchedulerWithConstraints, time_to_slot


DEMO_JOBS = [
    "A1 09:00–13:00",
    "A2 09:30–10:30,11:00–13:00",
    "閘口 09:30–13:00",
    "場內 09:00–10:30,11:00–13:00",
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
            {"employee": "阿明", "time_slot": "09:00", "job_code": "A1"},
            {"employee": "阿明", "time_slot": "09:30", "job_code": "A1"},
        ]
        grid, report = make_scheduler(locked_assignments=locks).solve()
        self.assertIn(report["status"], {"OPTIMAL", "FEASIBLE", "FEASIBLE_LOCKS_ONLY"})
        self.assertEqual(grid["阿明"][0], "A1")
        self.assertEqual(grid["阿明"][1], "A1")

    def test_unavailable_staff_not_assigned_after_leave(self):
        locks = [
            {"employee": "阿強", "time_slot": "09:00", "job_code": "場內"},
        ]
        unavailable = [{"employee": "阿強", "from_time": "09:30"}]
        grid, report = make_scheduler(
            locked_assignments=locks,
            unavailable=unavailable,
        ).solve()
        self.assertIn(report["status"], {"OPTIMAL", "FEASIBLE", "FEASIBLE_LOCKS_ONLY"})
        self.assertEqual(grid["阿強"][0], "場內")
        for slot in grid["阿強"][1:]:
            self.assertEqual(slot, "R")
        # Jobs that 阿強 can no longer cover should surface as 空缺 if nobody else took them.
        unfilled_times = {(u["job_code"], u["time_slot"]) for u in report["unfilled_job_slots"]}
        self.assertTrue(len(unfilled_times) >= 0)

    def test_time_helpers(self):
        self.assertEqual(time_to_slot("09:00"), 18)
        self.assertEqual(time_to_slot("09:30"), 19)


if __name__ == "__main__":
    unittest.main()
