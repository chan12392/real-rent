"""Reference-only adapter from comparison inputs to the extra-cost engine."""

from dataclasses import asdict, dataclass
from typing import Literal

from app.engine.extra_costs import CostTotal, ExtraCostInput, calculate_extra_costs
from app.engine.models import Conditions, Listing

LIVING_ASSUMPTIONS = (
    "진짜 월 거주비는 참고용 시안이며 판정·순위에 쓰지 않는다",
    "living_cost 입력 가정: 건물 유형이 없어 주거용 오피스텔(중개요율 적용요건 충족), "
    "면적은 미확인으로 면적 없는 관리비 추정표, 이사·청소는 소형을 적용한다.",
    "living 생략 시 1인·개별가스·move_in_by의 월·경제적 월 비용 포함을 적용한다.",
    "living_cost는 공과금·이사·청소·보증금 기회비용 등의 가정 추정치를 포함하며 "
    "실제 고지액·견적이 아니다; parameter_status의 검증 상태는 요율표 원문 그대로다.",
    "living_cost.initial_cash는 보증금+첫 달 월세+중개보수+이사·청소이며 "
    "기존 cost.initial_cash_krw와 범위가 다르다; "
    "일회성 항목의 low/high는 선납 원금, monthly_krw는 거주 개월 월할액이다.",
    "중앙·전기 난방은 가스를 제외하며 별도 난방비는 미확인으로 계산하지 않는다.",
)


@dataclass(frozen=True)
class LivingOptions:
    persons: int = 1
    heating: Literal["individual_gas", "central", "electric"] = "individual_gas"
    move_in_month: int | None = None
    include_economic: bool = True


def calculate_living_cost(
    item: Listing,
    conditions: Conditions,
    monthly_commute_krw: int | None,
    options: LivingOptions,
) -> dict:
    """Use the effective management fee and already computed commute without rejudging."""
    result = calculate_extra_costs(
        ExtraCostInput(
            deposit_krw=item.deposit_krw,
            monthly_rent_krw=item.monthly_rent_krw,
            monthly_management_krw=item.monthly_management_krw,
            management_includes=item.management_includes,
            building_type="officetel",
            area_m2=None,
            persons=options.persons,
            heating=options.heating,
            move_in_month=(
                conditions.move_in_by.month
                if options.move_in_month is None
                else options.move_in_month
            ),
            stay_months=conditions.stay_months,
            monthly_commute_krw=monthly_commute_krw,
        )
    )
    items = []
    for item_cost in result.items:
        if not options.include_economic and item_cost.key == "deposit_opportunity":
            continue
        row = asdict(item_cost)
        row.pop("source_id")
        items.append(row)
    peak = {
        key: {"month": result.seasonal[key].peak_month, "amount_krw": result.seasonal[key].peak_krw}
        for key in ("electricity", "gas")
    }
    if options.heating != "individual_gas":
        peak["gas"] = None
    return {
        "cash_monthly": asdict(result.cash_monthly),
        "economic_monthly": asdict(
            result.economic_monthly
            if options.include_economic
            else CostTotal(None, None, None, None)
        ),
        "initial_cash": asdict(result.initial_cash),
        "items": items,
        "peak": peak,
        "management_estimated": result.management_estimated,
        "parameter_status": result.parameter_statuses,
    }
