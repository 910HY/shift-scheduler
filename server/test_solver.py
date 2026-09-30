from copy import deepcopy

from fastapi.testclient import TestClient

from server.app import app
from server.solver import solve


def test_locked_person_is_not_moved_to_cover_a_vacancy():
    posts = [
        {"id": "P1", "locked": True, "assignee_id": "S1"},
        {"id": "P2", "locked": False, "assignee_id": None},
    ]
    staff = [{"id": "S1", "locked": False, "available": True, "post_id": "P1"}]
    result = solve(posts, staff)
    assert result["assignments"]["P1"] == "S1"
    assert result["assignments"]["P2"] is None
    assert result["vacancies"] == ["P2"]
    assert "P1" not in result["vacancies"]


def test_locked_empty_cell_is_not_filled():
    posts = [{"id": "P1", "locked": True, "assignee_id": None}]
    staff = [{"id": "S1", "locked": False, "available": True, "post_id": None}]
    result = solve(posts, staff)
    assert result["assignments"]["P1"] is None
    assert result["vacancies"] == []
    assert result["held_empty"] == ["P1"]
    assert result["idle_staff"] == ["S1"]


def test_rest_lock_is_not_pulled_onto_an_open_post():
    posts = [{"id": "P1", "locked": False, "assignee_id": None}]
    staff = [{"id": "S1", "locked": True, "available": True, "post_id": None}]
    result = solve(posts, staff)
    assert result["assignments"]["P1"] is None
    assert result["vacancies"] == ["P1"]
    assert result["idle_staff"] == []


def test_staff_lock_keeps_the_current_seat_even_if_the_post_flag_is_open():
    posts = [
        {"id": "P1", "locked": False, "assignee_id": "S1"},
        {"id": "P2", "locked": False, "assignee_id": None},
    ]
    staff = [{"id": "S1", "locked": True, "available": True, "post_id": "P1"}]
    result = solve(posts, staff)
    assert result["assignments"]["P1"] == "S1"
    assert result["assignments"]["P2"] is None


def test_unavailable_person_on_unlocked_post_is_backfilled_and_lock_stays():
    posts = [
        {"id": "LOCK", "locked": True, "assignee_id": "KEEP"},
        {"id": "OPEN", "locked": False, "assignee_id": "GONE"},
    ]
    staff = [
        {"id": "KEEP", "locked": False, "available": True, "post_id": "LOCK"},
        {"id": "GONE", "locked": False, "available": False, "post_id": "OPEN"},
        {"id": "REST", "locked": False, "available": True, "post_id": None},
    ]
    result = solve(posts, staff)
    assert result["assignments"]["LOCK"] == "KEEP"
    assert result["assignments"]["OPEN"] == "REST"
    assert "GONE" not in result["assignments"].values()


def test_locked_cell_keeps_an_unavailable_assignee():
    posts = [
        {"id": "P1", "locked": True, "assignee_id": "LEFT"},
        {"id": "P2", "locked": False, "assignee_id": None},
    ]
    staff = [
        {"id": "LEFT", "locked": False, "available": False, "post_id": "P1"},
        {"id": "IDLE", "locked": False, "available": True, "post_id": None},
    ]
    result = solve(posts, staff)
    assert result["assignments"]["P1"] == "LEFT"
    assert result["assignments"]["P2"] == "IDLE"


def test_does_not_shuffle_unlocked_people_when_the_board_is_already_full():
    posts = [
        {"id": "P1", "locked": False, "assignee_id": "S1"},
        {"id": "P2", "locked": False, "assignee_id": "S2"},
    ]
    staff = [
        {"id": "S1", "locked": False, "available": True, "post_id": "P1"},
        {"id": "S2", "locked": False, "available": True, "post_id": "P2"},
    ]
    result = solve(posts, staff)
    assert result["assignments"] == {"P1": "S1", "P2": "S2"}
    assert result["vacancies"] == []


def test_lower_penalty_staff_is_chosen_for_the_open_seat():
    posts = [{"id": "P", "locked": False, "assignee_id": None}]
    staff = [
        {"id": "HIGH", "locked": False, "available": True, "post_id": None, "assign_penalty": 3},
        {"id": "LOW", "locked": False, "available": True, "post_id": None, "assign_penalty": 0},
    ]
    result = solve(posts, staff)
    assert result["assignments"]["P"] == "LOW"


def test_short_staff_reports_leftover_vacancies_without_touching_locks():
    posts = [
        {"id": "LOCK", "locked": True, "assignee_id": "KEEP"},
        {"id": "A", "locked": False, "assignee_id": None},
        {"id": "B", "locked": False, "assignee_id": None},
        {"id": "C", "locked": False, "assignee_id": None},
    ]
    staff = [
        {"id": "KEEP", "locked": False, "available": True, "post_id": "LOCK"},
        {"id": "ONLY", "locked": False, "available": True, "post_id": None},
    ]
    result = solve(posts, staff)
    assert result["assignments"]["LOCK"] == "KEEP"
    assert list(result["assignments"].values()).count("ONLY") == 1
    assert len(result["vacancies"]) == 2
    assert "LOCK" not in result["vacancies"]
    assert set(result["vacancies"]).issubset({"A", "B", "C"})


def test_seed_shaped_board_keeps_placed_people_and_one_vacancy():
    posts = [
        {"id": "p-a1", "locked": True, "assignee_id": "s03"},
        {"id": "p-a2", "locked": False, "assignee_id": "s04"},
        {"id": "p-a3", "locked": False, "assignee_id": None},
        {"id": "p-a4", "locked": False, "assignee_id": None},
        {"id": "p-d1", "locked": False, "assignee_id": "s01"},
        {"id": "p-d2", "locked": False, "assignee_id": "s06"},
        {"id": "p-d3", "locked": False, "assignee_id": "s02"},
        {"id": "p-k1", "locked": False, "assignee_id": "s05"},
        {"id": "p-k2", "locked": False, "assignee_id": None},
        {"id": "p-g1", "locked": False, "assignee_id": "s09"},
        {"id": "p-g2", "locked": False, "assignee_id": "s08"},
    ]
    staff = [
        {"id": "s01", "locked": False, "available": True, "post_id": "p-d1", "assign_penalty": 0},
        {"id": "s02", "locked": False, "available": True, "post_id": "p-d3", "assign_penalty": 0},
        {"id": "s03", "locked": False, "available": True, "post_id": "p-a1", "assign_penalty": 0},
        {"id": "s04", "locked": False, "available": True, "post_id": "p-a2", "assign_penalty": 0},
        {"id": "s05", "locked": False, "available": True, "post_id": "p-k1", "assign_penalty": 0},
        {"id": "s06", "locked": False, "available": False, "post_id": "p-d2", "assign_penalty": 0},
        {"id": "s07", "locked": False, "available": True, "post_id": None, "assign_penalty": 3},
        {"id": "s08", "locked": False, "available": True, "post_id": "p-g2", "assign_penalty": 0},
        {"id": "s09", "locked": False, "available": False, "post_id": "p-g1", "assign_penalty": 0},
        {"id": "s10", "locked": False, "available": True, "post_id": None, "assign_penalty": 3},
        {"id": "s11", "locked": False, "available": True, "post_id": None, "assign_penalty": 0},
        {"id": "s12", "locked": False, "available": True, "post_id": None, "assign_penalty": 0},
    ]
    snapshot = deepcopy({"posts": posts, "staff": staff})
    result = solve(posts, staff)
    assert posts == snapshot["posts"]
    assert staff == snapshot["staff"]
    assert result["assignments"]["p-a1"] == "s03"
    assert result["assignments"]["p-a2"] == "s04"
    assert result["assignments"]["p-d1"] == "s01"
    assert result["assignments"]["p-d3"] == "s02"
    assert result["assignments"]["p-k1"] == "s05"
    assert result["assignments"]["p-g2"] == "s08"
    assert result["assignments"]["p-d2"] != "s06"
    assert result["assignments"]["p-g1"] != "s09"
    assert "s06" not in result["assignments"].values()
    assert "s09" not in result["assignments"].values()
    assert len(result["vacancies"]) == 1
    assert "p-a1" not in result["vacancies"]


def test_http_health_reports_ortools():
    client = TestClient(app)
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True, "solver": "ortools"}
    head = client.head("/api/health")
    assert head.status_code == 200


def test_root_serves_spa_or_explains_missing_build():
    from server.app import DIST

    client = TestClient(app)
    response = client.get("/", headers={"Accept": "text/html"})
    assert "渣板" in response.text
    if (DIST / "index.html").is_file():
        assert response.status_code == 200
    else:
        assert response.status_code == 503


def test_unknown_api_is_not_the_spa():
    client = TestClient(app)
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404
    assert "text/html" not in response.headers.get("content-type", "")


def test_http_solve_does_not_move_a_locked_cell():
    client = TestClient(app)
    response = client.post(
        "/api/solve",
        json={
            "posts": [
                {"id": "P1", "locked": True, "assignee_id": "S1"},
                {"id": "P2", "locked": False, "assignee_id": None},
            ],
            "staff": [
                {"id": "S1", "locked": False, "available": True, "post_id": "P1"},
                {"id": "S2", "locked": False, "available": True, "post_id": None},
            ],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["assignments"]["P1"] == "S1"
    assert body["assignments"]["P2"] == "S2"
    assert "P1" not in body["vacancies"]
