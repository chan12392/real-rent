"""Pure monthly-cost, eligibility, ranking and provisional-score calculations."""

from dataclasses import asdict, replace

from app.engine.living import LivingOptions, calculate_living_cost
from app.engine.models import ASSUMPTIONS, Conditions, Evaluation, Listing, Route, Status

ROUTE_FAILED = "출근 또는 퇴근 경로 조회 실패"
UNKNOWN_MANAGEMENT = "관리비 미확인으로 월 지출 계산 불가"


def monthly_commute_krw(outbound: Route, back: Route, office_days: int) -> int:
    if not 0 <= office_days <= 31:
        raise ValueError("office_days must be 0..31")
    return (outbound.fare_krw + back.fare_krw) * office_days


def monthly_cost_krw(item: Listing, office_days: int) -> int | None:
    if item.monthly_management_krw is None or item.outbound is None or item.back is None:
        return None
    return (
        item.monthly_rent_krw
        + item.monthly_management_krw
        + monthly_commute_krw(item.outbound, item.back, office_days)
    )


def round_trip_minutes(item: Listing) -> int | None:
    if item.outbound is None or item.back is None:
        return None
    return item.outbound.minutes + item.back.minutes


def apply_management_override(item: Listing, conditions: Conditions) -> Listing:
    if item.listing_id in conditions.management_overrides:
        return replace(
            item, monthly_management_krw=conditions.management_overrides[item.listing_id]
        )
    return item


def evaluate(item: Listing, conditions: Conditions) -> Evaluation:
    item = apply_management_override(item, conditions)
    failures: list[tuple[Status, str]] = []
    if item.outbound is None or item.back is None:
        failures.append(("route_failed", ROUTE_FAILED))
    if item.deposit_krw > conditions.deposit_limit_krw:
        failures.append(("fail", "보증금 한도 초과"))
    if item.move_in_available > conditions.move_in_by:
        failures.append(("fail", "입주 가능일이 희망일보다 늦음"))
    if item.monthly_management_krw is None:
        failures.append(("unknown", UNKNOWN_MANAGEMENT))
    total = monthly_cost_krw(item, conditions.office_days)
    if total is not None and total > conditions.monthly_budget_krw:
        failures.append(("fail", "월 지출 한도 초과"))
    if conditions.office_days > 0:
        for route, name in ((item.outbound, "출근"), (item.back, "퇴근")):
            if route is None:
                continue
            if route.minutes > conditions.max_one_way_minutes:
                failures.append(("fail", f"{name} 시간 상한 초과"))
            if route.transfers > conditions.max_transfers:
                failures.append(("fail", f"{name} 환승 상한 초과"))

    status: Status = next(
        (
            state
            for state in ("route_failed", "fail", "unknown")
            if any(category == state for category, _ in failures)
        ),
        "pass",
    )
    primary = next((reason for category, reason in failures if category == status), None)
    return Evaluation(status, primary, tuple(reason for _, reason in failures))


def rank(items: list[Listing], conditions: Conditions, limit: int | None = 3) -> list[Listing]:
    passed = [
        apply_management_override(item, conditions)
        for item in items
        if evaluate(item, conditions).status == "pass"
    ]

    def key(item: Listing) -> tuple[int, int, str]:
        cost = monthly_cost_krw(item, conditions.office_days)
        minutes = round_trip_minutes(item)
        # Passing requires known management and both routes, including for zero office days.
        assert cost is not None and minutes is not None
        if conditions.priority == "cost":
            return cost, minutes, item.listing_id
        return minutes, cost, item.listing_id

    return sorted(passed, key=key)[:limit]


def inverse_scores(values: dict[str, int | None]) -> dict[str, int | None]:
    known = [value for value in values.values() if value is not None]
    if not known:
        return {listing_id: None for listing_id in values}
    low, high = min(known), max(known)

    def score(value: int | None) -> int | None:
        if value is None:
            return None
        if high == low:
            return 100
        # Half-up with integer arithmetic, avoiding floating-point ties and precision loss.
        whole, remainder = divmod(100 * (high - value), high - low)
        return whole + int(2 * remainder >= high - low)

    return {listing_id: score(value) for listing_id, value in values.items()}


def compare(
    items: list[Listing], conditions: Conditions, *, living: LivingOptions | None = None
) -> dict:
    effective = sorted(
        [apply_management_override(item, conditions) for item in items],
        key=lambda item: item.listing_id,
    )
    costs = {item.listing_id: monthly_cost_krw(item, conditions.office_days) for item in effective}
    times = {item.listing_id: round_trip_minutes(item) for item in effective}
    cost_scores, time_scores = inverse_scores(costs), inverse_scores(times)
    ranked = rank(effective, conditions, limit=None)
    ranks = {item.listing_id: position for position, item in enumerate(ranked, start=1)}
    counts = dict.fromkeys(("pass", "fail", "unknown", "route_failed"), 0)
    results = []
    for item in effective:
        decision = evaluate(item, conditions)
        counts[decision.status] += 1
        total = costs[item.listing_id]
        has_routes = item.outbound is not None and item.back is not None
        commute = (
            monthly_commute_krw(item.outbound, item.back, conditions.office_days)
            if has_routes
            else None
        )
        convenience = (
            max(
                0,
                100
                - 20 * (item.outbound.transfers + item.back.transfers)
                - 2 * (item.outbound.walk_minutes + item.back.walk_minutes),
            )
            if has_routes
            else None
        )
        results.append(
            {
                "listing_id": item.listing_id,
                "label": item.label,
                "gu": item.gu,
                "dong": item.dong,
                "status": decision.status,
                "primary_reason": decision.primary_reason,
                "reasons": list(decision.reasons),
                "rank": ranks.get(item.listing_id),
                "management_overridden": item.listing_id in conditions.management_overrides,
                "cost": {
                    "deposit_krw": item.deposit_krw,
                    "monthly_rent_krw": item.monthly_rent_krw,
                    "monthly_management_krw": item.monthly_management_krw,
                    "monthly_commute_krw": commute,
                    "monthly_total_krw": total,
                    "initial_cash_krw": item.deposit_krw + item.monthly_rent_krw,
                    "stay_total_krw": total * conditions.stay_months if total is not None else None,
                },
                "commute": {
                    "outbound": asdict(item.outbound) if item.outbound is not None else None,
                    "return": asdict(item.back) if item.back is not None else None,
                    "round_trip_minutes": times[item.listing_id],
                },
                "scores": {
                    "cost": cost_scores[item.listing_id],
                    "time": time_scores[item.listing_id],
                    "convenience": convenience,
                    "livability": None,
                },
                "living_cost": calculate_living_cost(
                    item, conditions, commute, living if living is not None else LivingOptions()
                ),
            }
        )
    return {
        "synthetic": True,
        "conditions": asdict(conditions),
        "assumptions": list(ASSUMPTIONS),
        "counts": counts,
        "recommended": [item.listing_id for item in ranked[:3]],
        "results": results,
    }
