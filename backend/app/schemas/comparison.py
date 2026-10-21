from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

NonnegativeInt = Annotated[int, Field(ge=0, le=9_007_199_254_740_991, strict=True)]


class Office(BaseModel):
    id: str = Field(min_length=1)
    label: str = Field(min_length=1)


class Listing(BaseModel):
    id: str = Field(min_length=1)
    label: str
    area: str
    available_from: date
    deposit_krw: NonnegativeInt
    monthly_rent_krw: NonnegativeInt
    monthly_management_krw: NonnegativeInt | None
    management_includes: list[str]


class CommuteLeg(BaseModel):
    minutes: NonnegativeInt
    fare_krw: NonnegativeInt
    transfers: NonnegativeInt
    walk_minutes: NonnegativeInt

    @model_validator(mode="after")
    def walking_is_part_of_total(self):
        if self.walk_minutes > self.minutes:
            raise ValueError("도보 시간은 전체 통근 시간보다 클 수 없습니다.")
        return self


class DemoRoute(BaseModel):
    listing_id: str
    office_id: str
    outbound: CommuteLeg | None
    inbound: CommuteLeg | None


class DemoCatalog(BaseModel):
    synthetic: Literal[True] = True
    note: str
    offices: list[Office] = Field(min_length=1)
    listings: list[Listing] = Field(min_length=1)


class DemoData(DemoCatalog):
    schema_version: Literal[2]
    routes: list[DemoRoute]

    @model_validator(mode="after")
    def check_identifiers(self):
        office_ids = {office.id for office in self.offices}
        listing_ids = {listing.id for listing in self.listings}
        route_ids = {(route.office_id, route.listing_id) for route in self.routes}
        if len(office_ids) != len(self.offices) or len(listing_ids) != len(self.listings):
            raise ValueError("시연 회사와 매물 ID는 중복될 수 없습니다.")
        if len(route_ids) != len(self.routes):
            raise ValueError("시연 경로는 회사·매물 조합마다 한 건이어야 합니다.")
        if any(
            office not in office_ids or listing not in listing_ids
            for office, listing in route_ids
        ):
            raise ValueError("경로의 회사·매물 ID가 카탈로그에 없습니다.")
        return self


class ComparisonRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    office_id: str = Field(min_length=1, max_length=100)
    move_in_date: date
    deposit_limit_krw: NonnegativeInt
    monthly_limit_krw: NonnegativeInt
    workdays: Annotated[int, Field(ge=0, le=31, strict=True)]
    max_commute_minutes: NonnegativeInt
    max_transfers: NonnegativeInt
    priority: Literal["cost", "time"]


class Candidate(BaseModel):
    listing: Listing
    outbound: CommuteLeg
    inbound: CommuteLeg
    monthly_commute_krw: NonnegativeInt
    monthly_total_krw: NonnegativeInt
    round_trip_minutes: NonnegativeInt


class ExcludedListing(BaseModel):
    id: str
    label: str
    reasons: list[str]


class ComparisonResponse(BaseModel):
    synthetic: Literal[True] = True
    note: str
    conditions: ComparisonRequest
    office: Office
    candidates: list[Candidate]
    excluded: list[ExcludedListing]
    evaluated_count: int
    matched_count: int
