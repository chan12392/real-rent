"""Reference living costs extend /compare without affecting eligibility or ranking."""

from copy import deepcopy
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app.api.listings import get_data
from app.engine.data import load_listings
from app.engine.extra_cost_params import DEFAULT_PARAMS
from app.main import create_app

BASE = {
    "deposit_limit_krw": 10_000_000,
    "monthly_budget_krw": 750_000,
    "move_in_by": "2026-11-01",
    "office_days": 20,
    "max_one_way_minutes": 40,
    "max_transfers": 1,
    "priority": "cost",
}
UNKNOWN_TOTAL = {
    "amount_krw": None,
    "low_krw": None,
    "high_krw": None,
    "estimated_share_pct": None,
}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("REAL_RENT_DATA_DIR", raising=False)
    with TestClient(create_app()) as test_client:
        yield test_client


def post_compare(client, **changes):
    response = client.post("/api/compare", json={**BASE, **changes})
    assert response.status_code == 200, response.text
    return response.json()


def cost_items(living):
    return {item["key"]: item for item in living["items"]}


def legacy_fields(payload):
    payload = deepcopy(payload)
    payload["conditions"].pop("living", None)
    for result in payload["results"]:
        result.pop("living_cost")
    return payload


def test_default_l01_matches_documented_hand_calculation(client):
    payload = post_compare(client)
    assert payload["conditions"] == {**BASE, "stay_months": 12, "management_overrides": {}}
    assert all(isinstance(row["living_cost"], dict) for row in payload["results"])
    living = payload["results"][0]["living_cost"]
    # L01: 500k + 70k + electricity 26,129 + gas 14,426 + commute 62k.
    assert living["cash_monthly"] == {
        "amount_krw": 672_555,
        "low_krw": 663_017,
        "high_krw": 682_694,
        "estimated_share_pct": 6.03,
    }
    assert living["economic_monthly"] == {
        "amount_krw": 739_555,
        "low_krw": 719_683,
        "high_krw": 761_361,
        "estimated_share_pct": 11.57,
    }
    assert living["initial_cash"]["amount_krw"] == 11_004_000
    assert living["peak"] == {
        "electricity": {"month": 8, "amount_krw": 37_267},
        "gas": {"month": 1, "amount_krw": 31_110},
    }
    items = cost_items(living)
    assert items["water"]["monthly_krw"] == items["internet"]["monthly_krw"] == 0
    assert items["brokerage"]["one_time_krw"] == 264_000
    assert items["brokerage"]["monthly_krw"] == 22_000
    assert living["management_estimated"] is False
    assert living["parameter_status"] == {
        name: parameter["status"] for name, parameter in DEFAULT_PARAMS.items()
    }
    assert living["parameter_status"]["gas_krw_per_mj"] == "검증 필요"
    assert "진짜 월 거주비는 참고용 시안이며 판정·순위에 쓰지 않는다" in payload["assumptions"]
    assert any(
        "건물 유형이 없어" in note and "면적은 미확인" in note for note in payload["assumptions"]
    )


@pytest.mark.parametrize("living", [None, {}])
def test_optional_living_uses_defaults(client, living):
    default = post_compare(client)
    explicit = post_compare(client, living=living)
    assert legacy_fields(default) == legacy_fields(explicit)
    assert [row["living_cost"] for row in default["results"]] == [
        row["living_cost"] for row in explicit["results"]
    ]
    if living is None:
        assert "living" not in explicit["conditions"]
    else:
        assert explicit["conditions"]["living"] == {
            "persons": 1,
            "heating": "individual_gas",
            "move_in_month": 11,
            "include_economic": True,
        }


@pytest.mark.parametrize(
    "living",
    [
        {"persons": 6},
        {"heating": "central"},
        {"heating": "electric"},
        {"move_in_month": 1},
        {"include_economic": False},
        {"persons": 2, "heating": "electric", "move_in_month": 12, "include_economic": False},
    ],
)
def test_living_options_never_change_existing_results(client, living):
    default = post_compare(client)
    changed = post_compare(client, living=living)
    assert legacy_fields(default) == legacy_fields(changed)
    if living.get("persons", 1) > 1:
        assert changed["results"][0]["living_cost"]["cash_monthly"]["amount_krw"] > 672_555


def test_reference_total_exceeding_budget_does_not_fail_listing(client):
    payload = post_compare(client, monthly_budget_krw=632_000)
    l01 = payload["results"][0]
    assert l01["cost"]["monthly_total_krw"] == 632_000
    assert l01["living_cost"]["cash_monthly"]["amount_krw"] == 672_555
    assert l01["status"] == "pass"
    assert l01["rank"] is not None
    assert "L01" in payload["recommended"]


def test_move_in_month_defaults_to_request_date_and_explicit_month_overrides_it(client):
    implicit = post_compare(client, move_in_by="2026-01-01", stay_months=1, living={})
    explicit = post_compare(
        client, move_in_by="2026-01-01", stay_months=1, living={"move_in_month": 8}
    )
    assert implicit["conditions"]["living"]["move_in_month"] == 1
    assert explicit["conditions"]["living"]["move_in_month"] == 8
    winter = implicit["results"][0]["living_cost"]
    summer = explicit["results"][0]["living_cost"]
    assert winter["peak"]["gas"] == {"month": 1, "amount_krw": 31_110}
    assert summer["peak"]["electricity"] == {"month": 8, "amount_krw": 37_267}
    assert cost_items(winter)["gas"]["monthly_krw"] > cost_items(summer)["gas"]["monthly_krw"]
    assert (
        cost_items(winter)["electricity"]["monthly_krw"]
        < cost_items(summer)["electricity"]["monthly_krw"]
    )
    assert legacy_fields(implicit) == legacy_fields(explicit)


@pytest.mark.parametrize("heating", ["central", "electric"])
def test_other_heating_preserves_engine_limits_and_has_no_gas_peak(client, heating):
    payload = post_compare(client, living={"heating": heating})
    living = payload["results"][0]["living_cost"]
    assert living["peak"]["gas"] is None
    assert living["peak"]["electricity"]["amount_krw"] > 0
    gas = cost_items(living)["gas"]
    assert gas["monthly_krw"] == 0
    assert "별도 확인 필요" in gas["note"]
    assert any("별도 난방비는 미확인" in note for note in payload["assumptions"])


def test_excluding_economic_keeps_initial_cash_breakdown(client):
    included = post_compare(client)["results"][0]["living_cost"]
    excluded = post_compare(client, living={"include_economic": False})["results"][0]["living_cost"]
    assert excluded["economic_monthly"] == UNKNOWN_TOTAL
    assert excluded["cash_monthly"] == included["cash_monthly"]
    assert excluded["initial_cash"] == included["initial_cash"]
    assert "deposit_opportunity" not in cost_items(excluded)
    for key in ("brokerage", "moving", "cleaning"):
        assert cost_items(excluded)[key] == cost_items(included)[key]


@pytest.mark.parametrize("office_days", [0, 20])
def test_route_failure_keeps_both_monthly_totals_unknown_even_with_zero_office_days(
    client, office_days
):
    l12 = post_compare(client, office_days=office_days)["results"][-1]
    living = l12["living_cost"]
    assert l12["status"] == "route_failed"
    assert living["cash_monthly"] == living["economic_monthly"] == UNKNOWN_TOTAL
    commute = cost_items(living)["commute"]
    assert commute["monthly_krw"] is commute["low_krw"] is commute["high_krw"] is None
    assert living["initial_cash"]["amount_krw"] is not None
    assert cost_items(living)["rent"]["monthly_krw"] == 680_000


def test_unknown_management_is_estimated_without_changing_unknown_status(client):
    l03 = post_compare(client)["results"][2]
    living = l03["living_cost"]
    assert l03["status"] == "unknown"
    assert l03["cost"]["monthly_total_krw"] is None
    assert l03["scores"]["cost"] is None
    assert l03["rank"] is None
    assert living["management_estimated"] is True
    management = cost_items(living)["management"]
    assert management["monthly_krw"] == 78_000  # No area: use the flat reference estimate.
    assert management["low_krw"] == 59_000
    assert management["high_krw"] == 105_000
    assert management["estimated"] is True
    assert management["basis"] == "통계추정"
    assert living["cash_monthly"]["amount_krw"] is not None
    assert living["cash_monthly"]["estimated_share_pct"] > 0


@pytest.mark.parametrize("override", [0, 60_000])
def test_management_override_is_used_by_reference_costs_and_remains_request_local(client, override):
    l03 = post_compare(client, management_overrides={"L03": override})["results"][2]
    living = l03["living_cost"]
    assert l03["status"] == "pass"
    assert living["management_estimated"] is False
    assert cost_items(living)["management"]["monthly_krw"] == override
    assert cost_items(living)["management"]["estimated"] is False
    assert client.get("/api/listings").json()["listings"][2]["monthly_management_krw"] is None
    subsequent = post_compare(client)["results"][2]
    assert subsequent["living_cost"]["management_estimated"] is True
    assert subsequent["status"] == "unknown"


def test_all_management_inclusions_are_not_counted_twice(client):
    item = replace(load_listings()[0], management_includes=("전기", "가스", "수도", "인터넷"))
    client.app.dependency_overrides[get_data] = lambda: [item]
    living = post_compare(client)["results"][0]["living_cost"]
    for key in ("electricity", "gas", "water", "internet"):
        utility = cost_items(living)[key]
        assert utility["monthly_krw"] == utility["low_krw"] == utility["high_krw"] == 0
        assert utility["note"] == "관리비 포함"
        assert utility["estimated"] is False
    assert living["cash_monthly"]["amount_krw"] == 632_000


def test_money_stays_integer_with_maximum_persons_and_stay(client):
    payload = post_compare(client, stay_months=60, living={"persons": 6, "move_in_month": 12})

    def check_money(value):
        if isinstance(value, dict):
            for key, field in value.items():
                if key == "parameter_status":
                    continue  # Parameter names map to provenance statuses, not monetary values.
                if key.endswith("_krw"):
                    assert field is None or (type(field) is int and field >= 0), (key, field)
                check_money(field)
        elif isinstance(value, list):
            for field in value:
                check_money(field)

    check_money(payload)


@pytest.mark.parametrize(
    "living",
    [
        {"persons": 0},
        {"persons": 7},
        {"persons": True},
        {"persons": 1.5},
        {"persons": "2"},
        {"persons": None},
        {"heating": "steam"},
        {"heating": None},
        {"move_in_month": 0},
        {"move_in_month": 13},
        {"move_in_month": True},
        {"move_in_month": 1.5},
        {"move_in_month": "11"},
        {"include_economic": 0},
        {"include_economic": "false"},
        {"include_economic": None},
        {"building_type": "villa"},
        [],
        "invalid",
    ],
)
def test_invalid_living_inputs_return_422(client, living):
    response = client.post("/api/compare", json={**BASE, "living": living})
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)
