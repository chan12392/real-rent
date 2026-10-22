"""Independent HTTP adapters for condition suggestions and character reactions."""

from fastapi import APIRouter

from app.api.schemas import (
    ConditionsParseRequest,
    ConditionsParseResponse,
    ReactRequest,
    ReactResponse,
)
from app.engine.dialogue import DIALOGUE_ASSUMPTIONS, parse_conditions
from app.engine.reaction import REACTION_ASSUMPTIONS, react_to_message

router = APIRouter(tags=["chat"])


@router.post("/react", response_model=ReactResponse)
def post_react(request: ReactRequest) -> dict:
    return {
        "synthetic": True,
        "assumptions": list(REACTION_ASSUMPTIONS),
        "request_id": request.request_id,
        "engine": "rule-based-v0",
        **react_to_message(request.message),
    }


@router.post("/conditions/parse", response_model=ConditionsParseResponse)
def post_conditions_parse(request: ConditionsParseRequest) -> dict:
    current = request.current.model_dump(exclude_none=True) if request.current else None
    return {
        "synthetic": True,
        "assumptions": list(DIALOGUE_ASSUMPTIONS),
        **parse_conditions(request.message, current),
    }
