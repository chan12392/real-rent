from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: Literal["real-rent-api"] = "real-rent-api"


@router.get("/health", response_model=HealthResponse)
def get_health() -> HealthResponse:
    """Confirm the API process is responding; not a DB or external API check."""
    return HealthResponse()
