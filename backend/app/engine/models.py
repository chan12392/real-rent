"""Immutable inputs for the calculation engine; no HTTP or filesystem dependencies."""

from dataclasses import dataclass, field
from datetime import date
from typing import Literal

Status = Literal["pass", "fail", "unknown", "route_failed"]

ASSUMPTIONS = (
    "예산과 같으면 통과로 본다.",
    "월 출근일수가 0이면 통근 시간·환승 상한을 적용하지 않는다.",
    "초기 현금은 보증금과 첫 달 월세의 합이며 중개수수료·이사비 등 일회성 비용은 제외한다.",
    "거주 기간 지출은 보증금 전액 반환을 가정하며 보증금과 일회성 비용은 제외한다.",
    "점수는 미확정 시안이며 거주성은 집 상태·동네 안전 데이터 출처가 없어 평가하지 않는다.",
    "매물·가격·좌표·교통 값은 합성 데이터이며 실거래·실제 경로를 조회하지 않았다.",
    "별도 공과금·정기권 할인·시간의 금전 환산은 월 지출에서 제외한다.",
)


@dataclass(frozen=True)
class Route:
    minutes: int
    fare_krw: int
    transfers: int
    walk_minutes: int


@dataclass(frozen=True)
class Listing:
    listing_id: str
    label: str
    gu: str
    dong: str
    deposit_krw: int
    monthly_rent_krw: int
    monthly_management_krw: int | None
    management_includes: tuple[str, ...]
    move_in_available: date
    lat: float
    lng: float
    outbound: Route | None
    back: Route | None
    price_basis: str = "가정값(실거래 미조회)"


@dataclass(frozen=True)
class Conditions:
    deposit_limit_krw: int
    monthly_budget_krw: int
    move_in_by: date
    office_days: int
    max_one_way_minutes: int
    max_transfers: int
    priority: Literal["cost", "time"]
    stay_months: int = 12
    management_overrides: dict[str, int] = field(default_factory=dict)


@dataclass(frozen=True)
class Evaluation:
    status: Status
    primary_reason: str | None
    reasons: tuple[str, ...]
