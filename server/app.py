from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, Field

from server.solver import solve

app = FastAPI(title="渣板求解", version="1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Vite `npm run build` output. Absent during `npm run dev` (Vite proxies /api).
DIST = Path(__file__).resolve().parent.parent / "dist"

NO_CACHE = "no-cache, must-revalidate"
MISSING_FRONTEND = """<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>渣板</title></head>
<body>
<p>渣板前端未建置（找不到 dist/index.html）。請用 repo 根目錄嘅 Dockerfile 部署，或先執行 <code>npm run build</code>。</p>
</body>
</html>
"""


class PostIn(BaseModel):
    id: str
    locked: bool = False
    assignee_id: str | None = None


class StaffIn(BaseModel):
    id: str
    locked: bool = False
    available: bool = True
    post_id: str | None = None
    assign_penalty: int = 0


class SolveIn(BaseModel):
    posts: list[PostIn] = Field(default_factory=list)
    staff: list[StaffIn] = Field(default_factory=list)


@app.get("/api/health")
@app.head("/api/health")
def health() -> dict:
    return {"ok": True, "solver": "ortools"}


@app.post("/api/solve")
def solve_route(body: SolveIn) -> dict:
    posts = [post.model_dump() for post in body.posts]
    staff = [person.model_dump() for person in body.staff]
    return solve(posts, staff)


def _file(path: Path) -> FileResponse:
    response = FileResponse(path)
    if path.name in {"index.html", "sw.js"}:
        response.headers["Cache-Control"] = NO_CACHE
    return response


def _safe_file(full_path: str) -> Path | None:
    root = DIST.resolve()
    candidate = (DIST / full_path).resolve()
    if not candidate.is_relative_to(root) or not candidate.is_file():
        return None
    return candidate


def _register_frontend() -> None:
    index = DIST / "index.html"
    if not index.is_file():

        @app.get("/", response_class=HTMLResponse)
        def frontend_missing() -> HTMLResponse:
            return HTMLResponse(MISSING_FRONTEND, status_code=503)

        return

    @app.get("/")
    def spa_index() -> FileResponse:
        return _file(index)

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str, request: Request) -> FileResponse:
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        found = _safe_file(full_path)
        if found is not None:
            return _file(found)
        accept = request.headers.get("accept", "")
        if "text/html" in accept:
            return _file(index)
        raise HTTPException(status_code=404)


_register_frontend()
