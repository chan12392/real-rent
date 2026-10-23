"""별도 시연 탐색 API 규약. 기존 comparison 규약은 유지한다."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt

Office = Literal["강남역", "서울역", "여의도역"]
Kind = Literal["원룸", "오피스텔", "빌라"]
Key = Literal["deposit", "budget", "office", "minutes", "move_in", "kind", "transfers"]


class ExploreConditions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    deposit: StrictInt | None = Field(default=None, ge=0, le=1_000_000_000)
    budget: StrictInt | None = Field(default=None, ge=0, le=100_000_000)
    office: Office | None = None
    minutes: StrictInt | None = Field(default=None, ge=0, le=1440)
    move_in: date | None = None
    kind: Kind | None = None
    transfers: StrictInt | None = Field(default=None, ge=0, le=10)
    workdays: StrictInt = Field(default=20, ge=0, le=31)
    ignored: list[Key] = Field(default_factory=list, max_length=7)
    modes: dict[Key, Literal["required", "preferred"]] = Field(default_factory=dict)


class ExploreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str = Field(default="", max_length=2000)
    conditions: ExploreConditions = Field(default_factory=ExploreConditions)

    previous_conditions: ExploreConditions | None = None
    pending_conditions: ExploreConditions | None = None
