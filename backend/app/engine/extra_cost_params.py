"""교체 가능한 시연 요율표. source/status는 요율 자체와 적용 가정의 확인 범위를 뜻한다.

각 최상위 항목은 value/unit/source/as_of/status를 가진다. 표 안의 숫자는 해당
항목의 메타데이터를 공유한다. 검증되지 않은 기본값을 실제 견적·고지액으로 쓰지 않는다.
관리비의 median/p25/p75는 현재 평균/최소/최대를 대용한 가정이며 관측 분위수가 아니다.
"""

from collections.abc import Mapping
from typing import Any, TypedDict


class Parameter(TypedDict):
    value: Any
    unit: str
    source: str
    as_of: str
    status: str


Params = Mapping[str, Parameter]


def _entry(value, unit: str, source: str, status: str = "검증 필요") -> Parameter:
    return {
        "value": value,
        "unit": unit,
        "source": source,
        "as_of": "2026-10-21",
        "status": status,
    }


_POWER = "docs/research/extra-costs-public.md §② / 한국전력 주택용 저압"
_POWER_STATUS = "공식 요금표(작업자 확인, 메인 미재확인)"
_PRIVATE = "docs/research/extra-costs-private.md"
_ASSUMED = "시연 가정; 유형·지역·가구별 검증 필요"

DEFAULT_PARAMS: dict[str, Parameter] = {
    "electricity_brackets": _entry(
        [(200, 120.0), (400, 214.6), (None, 307.3)], "kWh, 원/kWh", _POWER, _POWER_STATUS
    ),
    "electricity_summer_brackets": _entry(
        [(300, 120.0), (450, 214.6), (None, 307.3)], "kWh, 원/kWh", _POWER, _POWER_STATUS
    ),
    "electricity_base_fees": _entry([910, 1600, 7300], "원/월", _POWER, _POWER_STATUS),
    "electricity_summer_months": _entry([7, 8], "월", _POWER, _POWER_STATUS),
    "electricity_superuser": _entry(
        {"threshold_kwh": 1000, "rate_krw": 736.2, "months": [12, 1, 2, 7, 8]},
        "kWh, 원/kWh, 월",
        _POWER,
        _POWER_STATUS,
    ),
    "electricity_climate_krw_per_kwh": _entry(9.0, "원/kWh", _POWER, _POWER_STATUS),
    "electricity_fuel_krw_per_kwh": _entry(5.0, "원/kWh", _POWER, _POWER_STATUS),
    "electricity_vat_rate": _entry(0.1, "비율", _POWER, _POWER_STATUS),
    "electricity_fund_rate": _entry(0.027, "비율", _POWER, _POWER_STATUS),
    "electricity_rounding": _entry(
        {"subtotal": "none", "vat": "half_up_won", "fund": "floor_10_won", "total": "half_up_won"},
        "none=중간 유지; half_up_won=0.5원 올림; floor_10_won=10원 미만 절사",
        _POWER,
        _POWER_STATUS,
    ),
    "electricity_base_kwh_per_person": _entry(150, "kWh/인·월", _ASSUMED),
    "electricity_month_factors": _entry(
        [1.1, 1.1, 1.0, 0.9, 0.9, 1.1, 1.5, 1.6, 1.1, 0.9, 1.0, 1.1],
        "1~12월 배수",
        _ASSUMED,
    ),
    "gas_base_mj_per_person": _entry(400, "MJ/인·월", _ASSUMED),
    "gas_month_factors": _entry(
        [3.0, 2.7, 2.0, 1.2, 0.6, 0.3, 0.2, 0.2, 0.4, 0.9, 1.7, 2.6],
        "1~12월 배수",
        _ASSUMED,
    ),
    "gas_base_fee_krw": _entry(1250, "원/월", "docs/research/extra-costs-public.md §③"),
    "gas_krw_per_mj": _entry(22.5268, "원/MJ", "docs/research/extra-costs-public.md §③"),
    "gas_vat_rate": _entry(0.1, "비율", "docs/research/extra-costs-public.md §③"),
    "utility_usage_range": _entry([0.75, 1.25], "사용량 low/high 배수", _ASSUMED),
    "water_liters_per_person_day": _entry(
        270, "L/인·일", "docs/research/extra-costs-public.md §④-1"
    ),
    "days_per_month": _entry(
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], "1~12월 일수(평년)", _ASSUMED
    ),
    "water_base_fee_krw": _entry(
        1080, "원/월(15mm 계량기 가정)", "docs/research/extra-costs-public.md §④"
    ),
    "water_supply_krw_per_m3": _entry(580, "원/㎥", "docs/research/extra-costs-public.md §④"),
    "water_sewage_krw_per_m3": _entry(
        480, "원/㎥", "https://news.seoul.go.kr/env/archives/520948", "확인"
    ),
    "water_charge_krw_per_m3": _entry(
        170, "원/㎥", "docs/research/extra-costs-public.md §④", "공식(작업자 확인)"
    ),
    "management_per_m2": _entry(
        {
            "officetel": {"p25": 1800, "median": 2400, "p75": 3200},
            "villa": {"p25": 1200, "median": 1800, "p75": 2400},
            "apartment": {"p25": 2000, "median": 2800, "p75": 3600},
        },
        "원/㎡·월",
        _ASSUMED,
    ),
    "management_flat_krw": _entry(
        {
            "officetel": {"p25": 59000, "median": 78000, "p75": 105000},
            "villa": {"p25": 59000, "median": 78000, "p75": 105000},
            "apartment": {"p25": 100000, "median": 150000, "p75": 220000},
        },
        "원/월",
        _PRIVATE + " §③; 2025-01 대학가 원룸 평균·학교별 최소/최대의 대용; 아파트는 가정",
        "통계추정(관측 분위수 아님, 유형·적용범위 검증 필요)",
    ),
    "internet_monthly_krw": _entry(
        19800,
        "원/월(VAT 포함)",
        "https://www.lg.co.kr/media/release/27504",
        "민간(2024-04 청년 한정, 날짜 오래됨)",
    ),
    "brokerage_conversion": _entry(
        {"multiplier": 100, "reduced_multiplier": 70, "threshold_krw": 50000000},
        "배수, 원",
        "docs/research/extra-costs-public.md §⑤",
        "법령(작업자 확인)",
    ),
    "brokerage_brackets": _entry(
        [
            (50000000, 0.005, 200000),
            (100000000, 0.004, 300000),
            (600000000, 0.003, None),
            (1200000000, 0.004, None),
            (1500000000, 0.005, None),
            (None, 0.006, None),
        ],
        "거래금액 미만, 상한비율, 한도 원",
        "docs/research/extra-costs-public.md §⑤",
        "법령(작업자 확인)",
    ),
    "brokerage_officetel_rate": _entry(
        0.004,
        "상한비율(주거용 85㎡ 이하 요건 충족 가정)",
        "docs/research/extra-costs-public.md §⑤",
        "법령(작업자 확인), 적용요건 확인 필요",
    ),
    "brokerage_vat_rates": _entry(
        {"low": 0, "assumed": 0.1, "high": 0.1},
        "부가세 비율",
        "과세유형 미확인; 일반과세 10% 가정",
        "가정",
    ),
    "moving_one_time_krw": _entry(
        {
            "small": {"low": 40000, "median": 100000, "high": 200000},
            "medium": {"low": 80000, "median": 200000, "high": 400000},
        },
        "원/회",
        _PRIVATE + " §⑤; 운송 하한만 조회, 중위·상한은 가정",
        "업체 글(검색 요약), 견적 검증 필요",
    ),
    "cleaning_one_time_krw": _entry(
        {
            "small": {"low": 100000, "median": 140000, "high": 180000},
            "medium": {"low": 140000, "median": 200000, "high": 300000},
        },
        "원/회",
        _PRIVATE + " §⑤; 중위 및 medium 범위는 가정",
        "업체 글, 견적 검증 필요",
    ),
    "deposit_rate_annual": _entry(
        0.03, "연 비율", "예금금리 미확인; 2026-08 기준금리를 대용한 시연 가정", "가정"
    ),
}
