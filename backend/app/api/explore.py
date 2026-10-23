import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.domain.explore import evaluate_home
from app.engine.explore import conversation_graph
from app.schemas.explore import ExploreConditions, ExploreRequest

router = APIRouter(tags=["explore"])
DATA = Path(__file__).resolve().parents[3] / "data" / "demo" / "explore.json"


@router.post("/explore")
def explore(request: ExploreRequest):
    result = conversation_graph.invoke(
        {
            "message": request.message,
            "conditions": request.conditions.model_dump(mode="json"),
            "reply": "",
            "pending_conditions": request.pending_conditions.model_dump(mode="json")
            if request.pending_conditions
            else None,
            "previous_conditions": request.previous_conditions.model_dump(mode="json")
            if request.previous_conditions
            else None,
            "undone": False,
        }
    )
    conditions = ExploreConditions.model_validate(result["conditions"])
    try:
        data = json.loads(DATA.read_text(encoding="utf-8"))
        homes = [evaluate_home(home, conditions) for home in data["homes"]]
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise HTTPException(503, "시연 데이터를 읽을 수 없습니다.") from error
    homes.sort(
        key=lambda h: (
            h["total"] if h["total"] is not None else float("inf"),
            h["minutes"] if h["minutes"] is not None else float("inf"),
            h["transfers"] if h["transfers"] is not None else float("inf"),
            h["id"],
        )
    )
    partial = any(
        getattr(conditions, key) is None and key not in conditions.ignored
        for key in ["deposit", "budget", "office", "minutes", "move_in", "kind"]
    )
    return {
        "pending_conditions": result.get("pending_conditions"),
        "undone": result.get("undone", False),
        "synthetic": True,
        "note": data["note"],
        "conditions": result["conditions"],
        "reply": result["reply"],
        "homes": homes,
        "partial": partial,
    }
