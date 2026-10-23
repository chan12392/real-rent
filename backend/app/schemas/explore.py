"""별도 시연 탐색 API 규약. 기존 comparison 규약은 유지한다."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator

from app.schemas.comparison import NonnegativeInt

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
    workdays: StrictInt | None = Field(default=None, ge=0, le=31)
    priority: Literal["cost", "time"] | None = None
    ignored: list[Key] = Field(default_factory=list, max_length=7)
    modes: dict[Key, Literal["required", "preferred"]] = Field(default_factory=dict)


class ExploreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str = Field(default="", max_length=2000)
    conditions: ExploreConditions = Field(default_factory=ExploreConditions)

    previous_conditions: ExploreConditions | None = None
    pending_conditions: ExploreConditions | None = None
    confirmed_conditions: ExploreConditions | None = None


class ExploreLeg(BaseModel):
    minutes: NonnegativeInt
    fare: NonnegativeInt
    transfers: NonnegativeInt


class ExploreRoute(BaseModel):
    outbound: ExploreLeg | None
    inbound: ExploreLeg | None


class ExploreHome(BaseModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    area: str
    kind: Kind
    size: float = Field(gt=0, strict=True)
    deposit: NonnegativeInt
    rent: NonnegativeInt
    management: NonnegativeInt | None
    includes: list[str]
    available: date
    x: float = Field(ge=0, le=100, strict=True)
    y: float = Field(ge=0, le=100, strict=True)
    routes: dict[Office, ExploreRoute | None]
    route_errors: dict[
        Office, Literal["timeout", "unavailable", "provider_error", "invalid_response"]
    ] = Field(default_factory=dict)


class ExploreData(BaseModel):
    synthetic: Literal[True]
    note: str = Field(min_length=1)
    homes: list[ExploreHome] = Field(min_length=1)

    @model_validator(mode="after")
    def unique_home_ids(self):
        if len({home.id for home in self.homes}) != len(self.homes):
            raise ValueError("시연 매물 ID는 중복될 수 없습니다.")
        return self
