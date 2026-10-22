"""고정 params와 손계산으로 검사한다. 운영 요율표의 숫자 변경에 의존하지 않는다."""

import json
from copy import deepcopy
from dataclasses import replace
from decimal import Decimal

import pytest

from app.domain.extra_costs import (
    ExtraCostInput,
    brokerage_transaction_value,
    calculate_extra_costs,
    electricity_bill,
    progressive_bill,
)

BASE = ExtraCostInput(
    deposit_krw=1200,
    monthly_rent_krw=100,
    monthly_management_krw=10,
    management_includes=(),
    building_type="villa",
    area_m2=20,
    persons=1,
    heating="individual_gas",
    move_in_month=1,
    stay_months=12,
    monthly_commute_krw=20,
)


@pytest.fixture
def params():
    values = {
        "electricity_brackets": [(200, 1), (400, 2), (None, 3)],
        "electricity_summer_brackets": [(300, 1), (450, 2), (None, 3)],
        "electricity_base_fees": [10, 20, 30],
        "electricity_summer_months": [7, 8],
        "electricity_superuser": {
            "threshold_kwh": 1000,
            "rate_krw": 10,
            "months": [12, 1, 2, 7, 8],
        },
        "electricity_climate_krw_per_kwh": 0,
        "electricity_fuel_krw_per_kwh": 0,
        "electricity_vat_rate": 0,
        "electricity_fund_rate": 0,
        "electricity_rounding": {
            "subtotal": "none",
            "vat": "half_up_won",
            "fund": "floor_10_won",
            "total": "half_up_won",
        },
        "electricity_base_kwh_per_person": 10,
        "electricity_month_factors": [1] * 12,
        "gas_base_mj_per_person": 10,
        "gas_month_factors": [3, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2],
        "gas_base_fee_krw": 5,
        "gas_krw_per_mj": 2,
        "gas_vat_rate": 0,
        "utility_usage_range": [0.5, 1.5],
        "water_liters_per_person_day": 100,
        "days_per_month": [30] * 12,
        "water_base_fee_krw": 1,
        "water_supply_krw_per_m3": 1,
        "water_sewage_krw_per_m3": 1,
        "water_charge_krw_per_m3": 1,
        "management_per_m2": {
            "villa": {"p25": 1, "median": 2, "p75": 3},
            "officetel": {"p25": 2, "median": 3, "p75": 4},
            "apartment": {"p25": 3, "median": 4, "p75": 5},
        },
        "management_flat_krw": {
            "villa": {"p25": 40, "median": 60, "p75": 80},
            "officetel": {"p25": 60, "median": 90, "p75": 120},
            "apartment": {"p25": 80, "median": 120, "p75": 160},
        },
        "internet_monthly_krw": 5,
        "brokerage_conversion": {
            "multiplier": 100,
            "reduced_multiplier": 70,
            "threshold_krw": 50_000_000,
        },
        "brokerage_brackets": [
            (50_000_000, 0.005, 200_000),
            (100_000_000, 0.004, 300_000),
            (600_000_000, 0.003, None),
            (1_200_000_000, 0.004, None),
            (1_500_000_000, 0.005, None),
            (None, 0.006, None),
        ],
        "brokerage_officetel_rate": 0.004,
        "brokerage_vat_rates": {"low": 0, "assumed": 0, "high": 0.1},
        "moving_one_time_krw": {
            "small": {"low": 10, "median": 12, "high": 14},
            "medium": {"low": 20, "median": 24, "high": 28},
        },
        "cleaning_one_time_krw": {
            "small": {"low": 4, "median": 6, "high": 8},
            "medium": {"low": 8, "median": 12, "high": 16},
        },
        "deposit_rate_annual": 0.03,
    }
    return {
        name: {
            "value": value,
            "unit": "test",
            "source": "손계산 fixture",
            "as_of": "2000-01-01",
            "status": "테스트 고정",
        }
        for name, value in values.items()
    }


def items(result):
    return {item.key: item for item in result.items}


@pytest.mark.parametrize(
    "usage,month,expected",
    [
        (200, 1, 210),  # 200×1 + 기본 10 = 210
        (201, 1, 222),  # 200×1 + 1×2 + 기본 20 = 222
        (400, 1, 620),  # 200×1 + 200×2 + 기본 20 = 620
        (401, 1, 633),  # 200×1 + 200×2 + 1×3 + 기본 30 = 633
        (300, 7, 310),  # 하계: 300×1 + 기본 10 = 310
        (301, 7, 322),  # 하계: 300×1 + 1×2 + 기본 20 = 322
        (450, 8, 620),  # 하계: 300×1 + 150×2 + 기본 20 = 620
        (451, 8, 633),  # 하계: 300×1 + 150×2 + 1×3 + 기본 30 = 633
    ],
)
def test_progressive_boundaries_and_last_tier_base(params, usage, month, expected):
    assert electricity_bill(usage, month, params) == expected


def test_progressive_preserves_fractional_usage_until_final_rounding(params):
    # 200×1 + 0.25×2 + 기본 20 = 220.5 -> 최종 221 (0.5 올림).
    assert progressive_bill(
        200.25, params["electricity_brackets"]["value"], [10, 20, 30]
    ) == Decimal("220.50")
    assert electricity_bill(200.25, 3, params) == 221


@pytest.mark.parametrize(
    "usage,month,expected",
    [
        (1000, 1, 2430),  # 200+400+600×3+30=2430; 1000까지 추가요율 없음.
        (1001, 1, 2440),  # 2430 + 1×10 = 2440
        (1001, 7, 2290),  # 하계: 300+300+550×3+30+1×10=2290
        (1001, 3, 2433),  # 비적용월: 200+400+601×3+30=2433
    ],
)
def test_superuser_rate_only_above_threshold_in_applicable_months(params, usage, month, expected):
    assert electricity_bill(usage, month, params) == expected


def test_electricity_surcharges_vat_and_fund_rounding(params):
    # 기본10+사용1+기후9+연료5=25; VAT 2.5->3, 기금 12.5->10; 합계38.
    params["electricity_climate_krw_per_kwh"]["value"] = 9
    params["electricity_fuel_krw_per_kwh"]["value"] = 5
    params["electricity_vat_rate"]["value"] = 0.1
    params["electricity_fund_rate"]["value"] = 0.5
    assert electricity_bill(1, 3, params) == 38
    # 최종 10원 미만 절사 정책으로 바꾸면 38->30. 정책을 엔진에 하드코딩하지 않음.
    params["electricity_rounding"]["value"]["total"] = "floor_10_won"
    assert electricity_bill(1, 3, params) == 30


@pytest.mark.parametrize(
    "label,key",
    [
        ("전기", "electricity"),
        ("가스", "gas"),
        ("수도", "water"),
        ("인터넷", "internet"),
    ],
)
def test_management_inclusions_prevent_double_counting(params, label, key):
    # 관리비에 포함된 항목은 월액/범위/선납액 모두 0; 관리비 자체는 입력 10 유지.
    result = calculate_extra_costs(replace(BASE, management_includes=(label,)), params)
    item = items(result)[key]
    assert (item.monthly_krw, item.low_krw, item.high_krw, item.one_time_krw) == (0, 0, 0, 0)
    assert item.note == "관리비 포함"
    assert items(result)["management"].monthly_krw == 10
    if key in result.seasonal:
        assert result.seasonal[key].total_krw == 0


def test_all_inclusions_remove_utilities_from_cash(params):
    # 월세100 + 관리비10 + 통근20 = 130 (공과금·인터넷 중복 없음).
    result = calculate_extra_costs(
        replace(BASE, management_includes=("전기", "가스", "수도", "인터넷")), params
    )
    assert result.cash_monthly.amount_krw == 130
    assert result.cash_monthly.estimated_share_pct == 0


@pytest.mark.parametrize(
    "building,area,expected",
    [
        ("villa", 20, (20, 40, 60)),  # (1,2,3)원/㎡ ×20㎡
        ("officetel", 20, (40, 60, 80)),  # (2,3,4)원/㎡ ×20㎡
        ("apartment", 20, (60, 80, 100)),  # (3,4,5)원/㎡ ×20㎡
        ("villa", None, (40, 60, 80)),  # 면적 없으면 유형별 정액
        ("officetel", None, (60, 90, 120)),
        ("apartment", None, (80, 120, 160)),
    ],
)
def test_unknown_management_estimate_is_explicit_and_does_not_replace_input(
    params,
    building,
    area,
    expected,
):
    data = replace(BASE, monthly_management_krw=None, building_type=building, area_m2=area)
    result = calculate_extra_costs(data, params)
    item = items(result)["management"]
    assert (item.low_krw, item.monthly_krw, item.high_krw) == expected
    assert item.basis == "통계추정" and item.estimated and result.management_estimated
    assert "unknown 판정을 변경하지 않음" in item.note
    assert data.monthly_management_krw is None


def test_known_zero_management_is_never_estimated(params):
    # 확인된 0원은 누락과 다름. 기준 현금197 - 기존관리비10 = 187.
    result = calculate_extra_costs(replace(BASE, monthly_management_krw=0), params)
    assert items(result)["management"].monthly_krw == 0
    assert not result.management_estimated
    assert result.cash_monthly.amount_krw == 187


@pytest.mark.parametrize(
    "deposit,rent,expected_value,expected_fee",
    [
        (9_990_000, 400_000, 37_990_000, 189_950),
        # ×100=49,990,000<50,000,000 -> 9,990,000+400,000×70=37,990,000; ×0.005=189,950.
        (10_000_000, 400_000, 50_000_000, 200_000),
        # ×100=50,000,000이므로 ×70 미적용; 50,000,000×0.004=200,000.
    ],
)
def test_brokerage_conversion_4999_and_5000_boundary(
    params, deposit, rent, expected_value, expected_fee
):
    data = replace(BASE, deposit_krw=deposit, monthly_rent_krw=rent)
    assert brokerage_transaction_value(deposit, rent, params) == expected_value
    assert items(calculate_extra_costs(data, params))["brokerage"].one_time_krw == expected_fee


@pytest.mark.parametrize(
    "deposit,expected",
    [
        (49_000_000, 200_000),  # min(49,000,000×0.005=245,000, 200,000)
        (90_000_000, 300_000),  # min(90,000,000×0.004=360,000, 300,000)
        (100_000_000, 300_000),  # 경계에서 다음 구간: 100,000,000×0.003
        (600_000_000, 2_400_000),  # 600,000,000×0.004
        (1_200_000_000, 6_000_000),  # 1,200,000,000×0.005
        (1_500_000_000, 9_000_000),  # 1,500,000,000×0.006
    ],
)
def test_brokerage_caps_and_upper_brackets(params, deposit, expected):
    data = replace(BASE, deposit_krw=deposit, monthly_rent_krw=0)
    item = items(calculate_extra_costs(data, params))["brokerage"]
    assert item.one_time_krw == item.low_krw == expected
    assert item.high_krw == expected * 11 // 10


def test_officetel_rate_and_assumed_vat(params):
    # 90,000,000×0.004=360,000 (주택 30만원 한도 미적용); VAT10%=396,000.
    params["brokerage_vat_rates"]["value"]["assumed"] = 0.1
    data = replace(BASE, deposit_krw=90_000_000, monthly_rent_krw=0, building_type="officetel")
    item = items(calculate_extra_costs(data, params))["brokerage"]
    assert (item.low_krw, item.one_time_krw, item.high_krw) == (360_000, 396_000, 396_000)
    assert item.monthly_krw == 33_000  # 396,000/12
    assert "적용요건 충족 가정" in item.note


def test_seasonal_sum_average_and_winter_peak(params):
    # 가스: 1월65 + 2월45 + 3~11월25×9 + 12월45 = 380; /12 ->32.
    # 전기: (기본10+10kWh×1)×12=240; 월평균20.
    result = calculate_extra_costs(BASE, params)
    gas, electric = result.seasonal["gas"], result.seasonal["electricity"]
    assert (gas.total_krw, gas.monthly_average_krw, gas.peak_month, gas.peak_krw) == (
        380,
        32,
        1,
        65,
    )
    assert (electric.total_krw, electric.monthly_average_krw) == (240, 20)
    assert [row.month for row in gas.monthly] == list(range(1, 13))


def test_seasons_wrap_across_years_and_preserve_every_month(params):
    # 11월25 + 12월45 + 1월65 =135; 평균45. 동률은 체류 순서상 첫 달.
    result = calculate_extra_costs(replace(BASE, move_in_month=11, stay_months=3), params)
    assert [row.month for row in result.seasonal["gas"].monthly] == [11, 12, 1]
    assert result.seasonal["gas"].total_krw == 135
    assert result.seasonal["gas"].monthly_average_krw == 45
    assert result.seasonal["gas"].peak_month == 1
    # 13개월이면 첫 12개월380 + 다음 1월65 =445; /13 ->34.
    longer = calculate_extra_costs(replace(BASE, stay_months=13), params).seasonal["gas"]
    assert len(longer.monthly) == 13
    assert (longer.total_krw, longer.monthly_average_krw) == (445, 34)


@pytest.mark.parametrize("heating", ["central", "electric"])
def test_non_individual_gas_heating_has_no_gas_charge(params, heating):
    result = calculate_extra_costs(replace(BASE, heating=heating), params)
    item = items(result)["gas"]
    assert (item.monthly_krw, item.low_krw, item.high_krw) == (0, 0, 0)
    assert "개별가스 난방 아님" in item.note
    assert "별도 확인" in item.note


def test_gas_vat_water_persons_and_days(params):
    # 가스: (기본5 + 2인×10MJ×1월계수3×단가2)×1.1=137.5 ->138.
    # 수도: 2인×100L×30일/1000=6㎥; 기본1+6×(1+1+1)=19.
    params["gas_vat_rate"]["value"] = 0.1
    result = calculate_extra_costs(replace(BASE, persons=2, stay_months=1), params)
    assert items(result)["gas"].monthly_krw == 138
    assert items(result)["water"].monthly_krw == 19
    # 2월만 28일: 2×100×28/1000×3+1=17.8 ->18.
    params["days_per_month"]["value"][1] = 28
    result = calculate_extra_costs(replace(BASE, persons=2, stay_months=1, move_in_month=2), params)
    assert items(result)["water"].monthly_krw == 18


def test_one_month_stay_amortizes_full_startup_cost(params):
    # cash=100+10+20+65+10+5+20=230; economic=230+41+12+6+3=292.
    result = calculate_extra_costs(replace(BASE, stay_months=1), params)
    assert result.cash_monthly.amount_krw == 230
    assert result.economic_monthly.amount_krw == 292
    assert result.initial_cash.amount_krw == 1359  # 1200+100+41+12+6
    for key in ("brokerage", "moving", "cleaning"):
        assert items(result)[key].monthly_krw == items(result)[key].one_time_krw
    assert result.seasonal["gas"].total_krw == result.seasonal["gas"].monthly_average_krw == 65


def test_cash_economic_initial_ranges_and_estimated_shares(params):
    # cash=100+10+20+32+10+5+20=197; low=100+10+15+18+6+5+20=174;
    # high=100+10+25+45+15+5+20=220. 가정 비중=(20+32+10+5)/197×100=34.01%.
    # 월할: 중개41/12->3, 이사12/12=1, 청소6/12->1; 기회1200×.03/12=3.
    # economic=197+3+1+1+3=205; low=174+3+1+0+3=181; high=220+4+1+1+3=229.
    # economic 가정 비중=(67+1+1+3)/205×100=35.12%.
    # initial=1200+100+41+12+6=1359; 범위1355~1367; 가정18/1359×100=1.32%.
    result = calculate_extra_costs(BASE, params)
    assert (
        result.cash_monthly.amount_krw,
        result.cash_monthly.low_krw,
        result.cash_monthly.high_krw,
        result.cash_monthly.estimated_share_pct,
    ) == (197, 174, 220, 34.01)
    assert (
        result.economic_monthly.amount_krw,
        result.economic_monthly.low_krw,
        result.economic_monthly.high_krw,
        result.economic_monthly.estimated_share_pct,
    ) == (205, 181, 229, 35.12)
    assert (
        result.initial_cash.amount_krw,
        result.initial_cash.low_krw,
        result.initial_cash.high_krw,
        result.initial_cash.estimated_share_pct,
    ) == (1359, 1355, 1367, 1.32)


def test_estimated_management_contributes_to_share(params):
    # 관리비 20㎡×중위2=40; cash=197-10+40=227;
    # 추정·가정 합=공과금·인터넷67+관리비40=107; 107/227×100=47.14%.
    result = calculate_extra_costs(replace(BASE, monthly_management_krw=None), params)
    assert result.cash_monthly.amount_krw == 227
    assert result.cash_monthly.estimated_share_pct == 47.14


def test_explicit_deposit_or_loan_rate_and_half_up(params):
    # 보증금200×연3%/12=0.5 ->1; 입력 연6%는 1200×.06/12=6 (기본3 대체).
    result = calculate_extra_costs(replace(BASE, deposit_krw=200), params)
    assert items(result)["deposit_opportunity"].monthly_krw == 1
    result = calculate_extra_costs(replace(BASE, deposit_rate_annual=0.06), params)
    assert items(result)["deposit_opportunity"].monthly_krw == 6
    assert result.economic_monthly.amount_krw == 208  # 기존205-3+6
    result = calculate_extra_costs(replace(BASE, deposit_rate_annual=0), params)
    assert items(result)["deposit_opportunity"].monthly_krw == 0


def test_medium_moving_and_cleaning(params):
    # 중형 이사24/12=2, 청소12/12=1; 선납24+12=36.
    result = calculate_extra_costs(replace(BASE, moving_size="medium"), params)
    assert (items(result)["moving"].monthly_krw, items(result)["moving"].one_time_krw) == (2, 24)
    assert (items(result)["cleaning"].monthly_krw, items(result)["cleaning"].one_time_krw) == (
        1,
        12,
    )


def test_missing_commute_keeps_totals_unknown_but_computes_other_items(params):
    result = calculate_extra_costs(replace(BASE, monthly_commute_krw=None), params)
    assert items(result)["commute"].monthly_krw is None
    assert items(result)["commute"].note == "통근비 미확인"
    for total in (result.cash_monthly, result.economic_monthly):
        assert (
            total.amount_krw is total.low_krw is total.high_krw is total.estimated_share_pct is None
        )
    assert result.initial_cash.amount_krw == 1359
    assert result.seasonal["gas"].total_krw == 380


def test_zero_total_has_zero_share_not_division_error(params):
    # 모든 입력·일회성 금액 0, 공과금·인터넷 포함이면 합계=0, 추정 비중=0%.
    for name in ("moving_one_time_krw", "cleaning_one_time_krw"):
        params[name]["value"]["small"] = {"low": 0, "median": 0, "high": 0}
    result = calculate_extra_costs(
        replace(
            BASE,
            deposit_krw=0,
            monthly_rent_krw=0,
            monthly_management_krw=0,
            monthly_commute_krw=0,
            management_includes=("전기", "가스", "수도", "인터넷"),
        ),
        params,
    )
    for total in (result.cash_monthly, result.economic_monthly, result.initial_cash):
        assert (total.amount_krw, total.low_krw, total.high_krw, total.estimated_share_pct) == (
            0,
            0,
            0,
            0,
        )


def test_deterministic_json_and_no_input_or_params_mutation(params):
    before = deepcopy(params)
    first = calculate_extra_costs(BASE, params)
    assert calculate_extra_costs(BASE, params) == first
    assert params == before
    encoded = json.loads(json.dumps(first.to_dict(), ensure_ascii=False))
    assert encoded["cash_monthly"]["amount_krw"] == 197
    assert encoded["parameter_statuses"]["gas_krw_per_mj"] == "테스트 고정"
    for item in first.items:
        assert isinstance(item.monthly_krw, int) and isinstance(item.one_time_krw, int)


@pytest.mark.parametrize(
    "name,value",
    [
        ("deposit_krw", -1),
        ("deposit_krw", 1.5),
        ("deposit_krw", True),
        ("monthly_rent_krw", -1),
        ("monthly_management_krw", -1),
        ("monthly_management_krw", 1.5),
        ("monthly_commute_krw", -1),
        ("monthly_commute_krw", False),
        ("persons", 0),
        ("persons", -1),
        ("persons", 1.5),
        ("persons", True),
        ("move_in_month", 0),
        ("move_in_month", 13),
        ("move_in_month", 1.5),
        ("stay_months", 0),
        ("stay_months", -1),
        ("stay_months", 1.5),
        ("area_m2", 0),
        ("area_m2", -1),
        ("area_m2", float("nan")),
        ("area_m2", float("inf")),
        ("area_m2", "23"),
        ("deposit_rate_annual", -0.1),
        ("deposit_rate_annual", 1.1),
        ("deposit_rate_annual", float("nan")),
        ("building_type", "house"),
        ("heating", "unknown"),
        ("moving_size", "large"),
        ("management_includes", "인터넷"),
        ("management_includes", [None]),
    ],
)
def test_invalid_inputs_raise_value_error(name, value):
    with pytest.raises(ValueError):
        replace(BASE, **{name: value})


@pytest.mark.parametrize(
    "kwh,brackets,fees",
    [
        (-1, [(None, 1)], [1]),
        (float("nan"), [(None, 1)], [1]),
        (10, [], []),
        (10, [(None, 1)], [1, 2]),
        (10, [(200, 1)], [1]),
        (10, [(None, 1), (400, 2)], [1, 2]),
        (10, [(200, 1), (100, 2), (None, 3)], [1, 2, 3]),
        (10, [(None, -1)], [1]),
        (10, [(None, 1)], [-1]),
    ],
)
def test_invalid_progressive_inputs_raise_value_error(kwh, brackets, fees):
    with pytest.raises(ValueError):
        progressive_bill(kwh, brackets, fees)


@pytest.mark.parametrize("month", [0, 13, 1.5, True])
def test_invalid_electricity_month(params, month):
    with pytest.raises(ValueError):
        electricity_bill(10, month, params)
