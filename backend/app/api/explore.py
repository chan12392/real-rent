from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.engine.explore import conversation_graph
from app.schemas.explore import ExploreData, ExploreRequest

router = APIRouter(tags=["explore"])
DATA = Path(__file__).resolve().parents[3] / "data" / "demo" / "explore.json"


@router.post("/explore")
def explore(request: ExploreRequest):
    try:
        data = ExploreData.model_validate_json(DATA.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise HTTPException(503, "시연 데이터를 읽을 수 없습니다.") from error
    result = conversation_graph.invoke({
        **request.model_dump(mode="json"),
        "homes": [home.model_dump(mode="json") for home in data.homes],
        "reply": "", "undone": False, "clarification": False,
    })
    return {
        "pending_conditions": result.get("pending_conditions"),
        "undone": result.get("undone", False),
        "synthetic": True,
        "note": data.note,
        "conditions": result["conditions"],
        "reply": result["reply"],
        "homes": result["homes"],
        "partial": result["partial"],
        "stage": result["stage"],
        "confirmed_conditions": result["confirmed_conditions"],
        "recommended_ids": result["recommended_ids"],
        "exclusion_summary": result["exclusion_summary"],
    }
