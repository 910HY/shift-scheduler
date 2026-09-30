"""當日渣板的崗位指派。

鎖定格子是硬限制，不是加分項。求解結束時，鎖定崗位上的人必須跟輸入相同，
這些人也不會出現在別的崗位。人不夠就留下未鎖定空位，不會為了補滿而去改鎖定。
"""

from __future__ import annotations

from ortools.sat.python import cp_model

FILL_WEIGHT = 10000
MOVE_COST = 10


def solve(posts: list[dict], staff: list[dict]) -> dict:
    post_by_id = {post["id"]: post for post in posts}
    fixed: dict[str, str | None] = {}

    for post in posts:
        if post.get("locked"):
            fixed[post["id"]] = post.get("assignee_id")

    for person in staff:
        if not person.get("locked"):
            continue
        post_id = person.get("post_id")
        if not post_id:
            continue
        post = post_by_id.get(post_id)
        if not post or post.get("assignee_id") != person["id"]:
            continue
        fixed.setdefault(post_id, person["id"])

    frozen: set[str] = {person_id for person_id in fixed.values() if person_id}
    for person in staff:
        if person.get("locked") and person["id"] not in frozen:
            frozen.add(person["id"])

    open_posts = [post for post in posts if post["id"] not in fixed]
    candidates = [
        person
        for person in staff
        if person.get("available", True) and person["id"] not in frozen
    ]

    assignments: dict[str, str | None] = {post["id"]: None for post in posts}
    for post_id, person_id in fixed.items():
        assignments[post_id] = person_id

    if open_posts and candidates:
        _fill_open_posts(open_posts, candidates, assignments)

    _restore_fixed(assignments, fixed)

    vacancies = [
        post["id"]
        for post in posts
        if post["id"] not in fixed and assignments.get(post["id"]) is None
    ]
    held_empty = [post_id for post_id, person_id in fixed.items() if person_id is None]
    assigned = {person_id for person_id in assignments.values() if person_id}
    idle_staff = [
        person["id"]
        for person in staff
        if person.get("available", True)
        and person["id"] not in frozen
        and person["id"] not in assigned
    ]
    return {
        "assignments": assignments,
        "vacancies": vacancies,
        "held_empty": held_empty,
        "idle_staff": idle_staff,
    }


def _fill_open_posts(open_posts: list[dict], candidates: list[dict], assignments: dict[str, str | None]) -> None:
    model = cp_model.CpModel()
    chosen: dict[tuple[str, str], cp_model.IntVar] = {}
    for person in candidates:
        for post in open_posts:
            chosen[(person["id"], post["id"])] = model.new_bool_var(f"a_{person['id']}_{post['id']}")

    for person in candidates:
        model.add(sum(chosen[(person["id"], post["id"])] for post in open_posts) <= 1)
    for post in open_posts:
        model.add(sum(chosen[(person["id"], post["id"])] for person in candidates) <= 1)

    fill_terms = []
    cost_terms = []
    for person in candidates:
        penalty = max(0, min(int(person.get("assign_penalty", 0) or 0), 100))
        for post in open_posts:
            var = chosen[(person["id"], post["id"])]
            fill_terms.append(var)
            moved = 0 if person.get("post_id") == post["id"] else 1
            coefficient = moved * MOVE_COST + penalty
            if coefficient:
                cost_terms.append(var * coefficient)

    objective = sum(fill_terms) * FILL_WEIGHT
    if cost_terms:
        objective -= sum(cost_terms)
    model.maximize(objective)

    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = 1
    solver.parameters.max_time_in_seconds = 2.0
    status = solver.solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return

    for post in open_posts:
        for person in candidates:
            if solver.value(chosen[(person["id"], post["id"])]) == 1:
                assignments[post["id"]] = person["id"]
                break


def _restore_fixed(assignments: dict[str, str | None], fixed: dict[str, str | None]) -> None:
    """鎖定結果最後再寫一次，避免搜尋結果覆蓋。同一個人只留在鎖定的那一格。"""
    owners = {person_id: post_id for post_id, person_id in fixed.items() if person_id}
    for post_id, person_id in list(assignments.items()):
        if person_id and person_id in owners and owners[person_id] != post_id:
            assignments[post_id] = None
    for post_id, person_id in fixed.items():
        assignments[post_id] = person_id
