"""Validated public request and response models for the synthetic demo APIs."""

import re
from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints

from app.engine.dialogue import ConditionField
from app.engine.models import ASSUMPTIONS, Status
from app.engine.reaction import ExpressionId, Intent


def _calendar_date(value: object) -> date:
    # Engine results contain date objects when CompareRequest is reused to
    # validate response conditions. HTTP JSON inputs must be date strings.
    if type(value) is date:
        return value
    if not isinstance(value, str) or re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value) is None:
        raise ValueError("날짜는 YYYY-MM-DD 형식의 문자열이어야 합니다.")
    return date.fromisoformat(value)


CalendarDate = Annotated[date, BeforeValidator(_calendar_date)]
Money = Annotated[int, Field(strict=True, ge=0)]
ListingId = Annotated[str, StringConstraints(pattern=r"^L\d{2}$")]
NonNegative = Annotated[int, Field(strict=True, ge=0)]
Score = Annotated[int, Field(ge=0, le=100)]
Month = Annotated[int, Field(strict=True, ge=1, le=12)]


class LivingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    persons: Annotated[int, Field(strict=True, ge=1, le=6)] = 1
    heating: Literal["individual_gas", "central", "electric"] = "individual_gas"
    move_in_month: Month | None = None
    include_economic: Annotated[bool, Field(strict=True)] = True


class CompareRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    deposit_limit_krw: Money
    monthly_budget_krw: Money
    move_in_by: CalendarDate
    office_days: Annotated[int, Field(strict=True, ge=0, le=31)]
    max_one_way_minutes: Annotated[int, Field(strict=True, ge=1)]
    max_transfers: NonNegative
    priority: Literal["cost", "time"]
    stay_months: Annotated[int, Field(strict=True, ge=1, le=60)] = 12
    management_overrides: dict[ListingId, Money] = Field(default_factory=dict)
    living: LivingRequest | None = Field(default=None, exclude_if=lambda value: value is None)


class AskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)
    ]
    listing_id: ListingId | None = None


class SyntheticResponse(BaseModel):
    synthetic: Literal[True] = True
    assumptions: list[str] = Field(default_factory=lambda: list(ASSUMPTIONS))


class RouteResponse(BaseModel):
    minutes: NonNegative
    fare_krw: Money
    transfers: NonNegative
    walk_minutes: NonNegative


class ListingResponse(BaseModel):
    listing_id: str
    label: str
    gu: str
    dong: str
    deposit_krw: Money
    monthly_rent_krw: Money
    monthly_management_krw: Money | None
    management_includes: list[str]
    move_in_available: date
    lat: float
    lng: float
    outbound: RouteResponse | None
    return_route: RouteResponse | None = Field(alias="return")


class ListingsResponse(SyntheticResponse):
    price_basis: str
    listings: list[ListingResponse]


class CostResponse(BaseModel):
    deposit_krw: Money
    monthly_rent_krw: Money
    monthly_management_krw: Money | None
    monthly_commute_krw: Money | None
    monthly_total_krw: Money | None
    initial_cash_krw: Money
    stay_total_krw: Money | None


class CommuteResponse(BaseModel):
    outbound: RouteResponse | None
    return_route: RouteResponse | None = Field(alias="return")
    round_trip_minutes: NonNegative | None


class ScoresResponse(BaseModel):
    cost: Score | None
    time: Score | None
    convenience: Score | None
    livability: None = None


class LivingTotalResponse(BaseModel):
    amount_krw: Money | None
    low_krw: Money | None
    high_krw: Money | None
    estimated_share_pct: Annotated[float, Field(ge=0, le=100)] | None


class LivingItemResponse(BaseModel):
    key: str
    label: str
    monthly_krw: Money | None
    one_time_krw: Money
    low_krw: Money | None
    high_krw: Money | None
    basis: Literal["실측", "법정요율", "공식단가", "통계추정", "가정"]
    note: str
    estimated: bool


class LivingPeakChargeResponse(BaseModel):
    month: Month
    amount_krw: Money


class LivingPeakResponse(BaseModel):
    electricity: LivingPeakChargeResponse
    gas: LivingPeakChargeResponse | None


class LivingCostResponse(BaseModel):
    cash_monthly: LivingTotalResponse
    economic_monthly: LivingTotalResponse
    initial_cash: LivingTotalResponse
    items: list[LivingItemResponse]
    peak: LivingPeakResponse
    management_estimated: bool
    parameter_status: dict[str, str]


class ComparisonResult(BaseModel):
    listing_id: str
    label: str
    gu: str
    dong: str
    status: Status
    primary_reason: str | None
    reasons: list[str]
    rank: Annotated[int, Field(ge=1)] | None
    management_overridden: bool
    cost: CostResponse
    commute: CommuteResponse
    scores: ScoresResponse
    living_cost: LivingCostResponse | None = None


class CountsResponse(BaseModel):
    pass_count: NonNegative = Field(alias="pass")
    fail: NonNegative
    unknown: NonNegative
    route_failed: NonNegative


class CompareResponse(SyntheticResponse):
    conditions: CompareRequest
    counts: CountsResponse
    recommended: list[str]
    results: list[ComparisonResult]


class CitationResponse(BaseModel):
    doc_id: str
    quote: str


class AskResponse(SyntheticResponse):
    status: Literal["answered", "unknown", "clarify", "out_of_scope"]
    answer: str
    citations: list[CitationResponse]
    candidates: list[str]


ChatMessage = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class ReactionContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    phase: Literal["input", "confirm", "result"]


class ReactRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    message: ChatMessage
    context: ReactionContext | None = None


class ReactResponse(SyntheticResponse):
    request_id: str
    expression_id: ExpressionId
    confidence: Annotated[float, Field(ge=0, le=1)]
    intent: Intent
    engine: Literal["rule-based-v0"]


class CurrentConditions(BaseModel):
    """A partial comparison input; missing fields never receive comparison defaults."""

    model_config = ConfigDict(extra="forbid")

    deposit_limit_krw: Money | None = None
    monthly_budget_krw: Money | None = None
    move_in_by: CalendarDate | None = None
    office_days: Annotated[int, Field(strict=True, ge=0, le=31)] | None = None
    max_one_way_minutes: Annotated[int, Field(strict=True, ge=1)] | None = None
    max_transfers: NonNegative | None = None
    priority: Literal["cost", "time"] | None = None
    stay_months: Annotated[int, Field(strict=True, ge=1, le=60)] | None = None
    management_overrides: dict[ListingId, Money] = Field(default_factory=dict)


class ConditionsParseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: ChatMessage
    current: CurrentConditions | None = None


class ConditionCandidateResponse(BaseModel):
    display: str
    source_text: str
    needs_confirmation: bool
    note: str | None = None


class MoneyCandidateResponse(ConditionCandidateResponse):
    field: Literal["deposit_limit_krw", "monthly_budget_krw"]
    value: Money


class DateCandidateResponse(ConditionCandidateResponse):
    field: Literal["move_in_by"]
    value: date


class OfficeDaysCandidateResponse(ConditionCandidateResponse):
    field: Literal["office_days"]
    value: Annotated[int, Field(strict=True, ge=0, le=31)]


class MinutesCandidateResponse(ConditionCandidateResponse):
    field: Literal["max_one_way_minutes"]
    value: Annotated[int, Field(strict=True, ge=1)]


class TransfersCandidateResponse(ConditionCandidateResponse):
    field: Literal["max_transfers"]
    value: NonNegative


class PriorityCandidateResponse(ConditionCandidateResponse):
    field: Literal["priority"]
    value: Literal["cost", "time"]


class StayCandidateResponse(ConditionCandidateResponse):
    field: Literal["stay_months"]
    value: Annotated[int, Field(strict=True, ge=1, le=60)]


ConditionCandidate = Annotated[
    MoneyCandidateResponse
    | DateCandidateResponse
    | OfficeDaysCandidateResponse
    | MinutesCandidateResponse
    | TransfersCandidateResponse
    | PriorityCandidateResponse
    | StayCandidateResponse,
    Field(discriminator="field"),
]


class ConditionQuestionResponse(BaseModel):
    field: ConditionField
    question: str
    options: list[str]


class ConditionsParseResponse(SyntheticResponse):
    candidates: list[ConditionCandidate]
    questions: list[ConditionQuestionResponse]
    understood: bool
