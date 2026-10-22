"""The reference's 14 cases, with the original hand-calculated expectations."""

from dataclasses import replace
from datetime import date

import pytest

from app.engine.calc import evaluate, monthly_commute_krw, monthly_cost_krw, rank
from app.engine.data import load_listings
from app.engine.models import Conditions, Route

ITEMS = {item.listing_id: item for item in load_listings()}
BASE = Conditions(
    deposit_limit_krw=10_000_000,
    monthly_budget_krw=750_000,
    move_in_by=date(2026, 11, 1),
    office_days=20,
    max_one_way_minutes=40,
    max_transfers=1,
    priority="cost",
)


@pytest.mark.parametrize(
    "listing_id, expected",
    [
        ("L01", 632_000),  # 500,000 + 70,000 + (1,550 + 1,550) x 20 = 632,000
        ("L04", 566_000),  # 420,000 + 80,000 + (1,650 + 1,650) x 20 = 566,000
        ("L06", 782_000),  # 620,000 + 100,000 + 3,100 x 20 = 782,000
        ("L08", 782_000),  # 650,000 + 70,000 + 3,100 x 20 = 782,000
    ],
)
def test_monthly_cost_matches_hand_calculation(listing_id, expected):
    assert monthly_cost_krw(ITEMS[listing_id], 20) == expected


def test_unknown_management_fee_is_not_zero():
    assert monthly_cost_krw(ITEMS["L03"], 20) is None
    assert evaluate(ITEMS["L03"], BASE).status == "unknown"


def test_deposit_is_not_added_to_monthly_cost():
    richer = replace(ITEMS["L01"], deposit_krw=50_000_000)
    assert monthly_cost_krw(richer, 20) == 632_000


def test_budget_equal_passes_and_one_won_over_fails():
    assert evaluate(ITEMS["L01"], replace(BASE, monthly_budget_krw=632_000)).status == "pass"
    assert evaluate(ITEMS["L01"], replace(BASE, monthly_budget_krw=631_999)).status == "fail"


def test_commute_limit_is_checked_each_way():
    assert evaluate(ITEMS["L01"], BASE).status == "pass"
    result = evaluate(ITEMS["L01"], replace(BASE, max_one_way_minutes=39))
    assert (result.status, result.primary_reason) == ("fail", "퇴근 시간 상한 초과")


def test_office_days_range():
    leg = Route(30, 1_550, 0, 5)
    assert monthly_commute_krw(leg, leg, 0) == 0
    assert monthly_commute_krw(leg, leg, 31) == 96_100  # 3,100 x 31
    with pytest.raises(ValueError):
        monthly_commute_krw(leg, leg, 32)


def test_failed_route_is_excluded_with_reason():
    result = evaluate(ITEMS["L12"], BASE)
    assert (result.status, result.primary_reason) == (
        "route_failed",
        "출근 또는 퇴근 경로 조회 실패",
    )


def test_scenario_a_budget_750k():
    # Only L01 (632k) and L05 (712k) pass every rule.
    assert [item.listing_id for item in rank(list(ITEMS.values()), BASE)] == ["L01", "L05"]


def test_scenario_b_tie_is_broken_by_round_trip_time():
    # L06 and L08 both cost 782,000. L06's 31 minutes beats L08's 36 minutes.
    conditions = replace(BASE, monthly_budget_krw=800_000)
    assert [item.listing_id for item in rank(list(ITEMS.values()), conditions)] == [
        "L01",
        "L05",
        "L06",
    ]


def test_time_priority_reorders():
    # L05 57 minutes < L01 78 minutes.
    conditions = replace(BASE, priority="time")
    assert [item.listing_id for item in rank(list(ITEMS.values()), conditions)] == ["L05", "L01"]


def test_same_input_same_order():
    assert rank(list(ITEMS.values()), BASE) == rank(list(reversed(list(ITEMS.values()))), BASE)
