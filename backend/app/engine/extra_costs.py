"""API·기존 판정과 독립적인 부대경비 순수 계산.

관리비는 근거표가 있어 참고 추정하지만, 근거 없는 통근비 미확인은 null로 유지한다.
CostItem.low/high는 정기 항목이면 월액, 일회성 항목이면 선납 원금의 범위다.
일회성 항목의 monthly_krw는 월할액이며 cash에는 넣지 않고 economic에만 넣는다.
기본 요율·사용량의 확인 상태는 parameter_statuses로 전달하며 실제 고지액이 아니다.
"""

from collections.abc import Callable, Iterable, Sequence
from dataclasses import asdict, dataclass
from decimal import ROUND_FLOOR, ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Literal

from app.engine.extra_cost_params import DEFAULT_PARAMS, Params

Number = int | float | Decimal
Basis = Literal["실측", "법정요율", "공식단가", "통계추정", "가정"]
Brackets = Sequence[tuple[Number | None, Number]]
Part = tuple[int | None, int | None, int | None, Basis]
_ESTIMATED_BASES = {"통계추정", "가정"}


def _decimal(value: Number, name: str = "value") -> Decimal:
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ValueError(f"{name}: 유한한 숫자가 필요합니다") from exc
    if isinstance(value, (bool, str)) or not result.is_finite():
        raise ValueError(f"{name}: 유한한 숫자가 필요합니다")
    return result


def _nonnegative(value: Number, name: str = "value") -> Decimal:
    result = _decimal(value, name)
    if result < 0:
        raise ValueError(f"{name}: 음수는 허용하지 않습니다")
    return result


def _won(value: Number) -> int:
    return int(_decimal(value).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _integer(value: int, name: str, minimum: int = 0) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"{name}: {minimum} 이상의 정수가 필요합니다")


@dataclass(frozen=True)
class ExtraCostInput:
    deposit_krw: int
    monthly_rent_krw: int
    monthly_management_krw: int | None
    management_includes: tuple[str, ...]
    building_type: Literal["officetel", "villa", "apartment"]
    area_m2: Number | None
    persons: int
    heating: Literal["individual_gas", "central", "electric"]
    move_in_month: int
    stay_months: int
    monthly_commute_krw: int | None
    moving_size: Literal["small", "medium"] = "small"
    deposit_rate_annual: Number | None = None

    def __post_init__(self) -> None:
        for name in ("deposit_krw", "monthly_rent_krw"):
            _integer(getattr(self, name), name)
        for name in ("monthly_management_krw", "monthly_commute_krw"):
            if getattr(self, name) is not None:
                _integer(getattr(self, name), name)
        for name in ("persons", "move_in_month", "stay_months"):
            _integer(getattr(self, name), name, 1)
        if self.move_in_month > 12:
            raise ValueError("move_in_month: 1~12월이어야 합니다")
        if self.area_m2 is not None and _nonnegative(self.area_m2, "area_m2") == 0:
            raise ValueError("area_m2: 0보다 커야 합니다")
        if self.deposit_rate_annual is not None:
            if _nonnegative(self.deposit_rate_annual, "deposit_rate_annual") > 1:
                raise ValueError("deposit_rate_annual: 0~1의 연 비율이어야 합니다")
        for name, choices in (
            ("building_type", ("officetel", "villa", "apartment")),
            ("heating", ("individual_gas", "central", "electric")),
            ("moving_size", ("small", "medium")),
        ):
            if getattr(self, name) not in choices:
                raise ValueError(f"{name}: 지원하지 않는 값입니다")
        if not isinstance(self.management_includes, (list, tuple, set, frozenset)):
            raise ValueError("management_includes: 문자열 목록이 필요합니다")
        if any(not isinstance(item, str) for item in self.management_includes):
            raise ValueError("management_includes: 문자열 목록이 필요합니다")
        object.__setattr__(self, "management_includes", tuple(sorted(self.management_includes)))


@dataclass(frozen=True)
class CostItem:
    key: str
    label: str
    monthly_krw: int | None
    one_time_krw: int
    low_krw: int | None
    high_krw: int | None
    basis: Basis
    source_id: str
    note: str
    estimated: bool = False


@dataclass(frozen=True)
class CostTotal:
    amount_krw: int | None
    low_krw: int | None
    high_krw: int | None
    estimated_share_pct: float | None


@dataclass(frozen=True)
class MonthlyCharge:
    month: int
    amount_krw: int


@dataclass(frozen=True)
class SeasonalCost:
    monthly: tuple[MonthlyCharge, ...]
    total_krw: int
    monthly_average_krw: int
    peak_month: int
    peak_krw: int


@dataclass(frozen=True)
class ExtraCostResult:
    items: tuple[CostItem, ...]
    cash_monthly: CostTotal
    economic_monthly: CostTotal
    initial_cash: CostTotal
    seasonal: dict[str, SeasonalCost]
    management_estimated: bool
    parameter_statuses: dict[str, str]
    assumptions: tuple[str, ...]

    def to_dict(self) -> dict:
        return asdict(self)


def progressive_bill(kwh: Number, brackets: Brackets, base_fees: Sequence[Number]) -> Decimal:
    """상한 포함 누진 구간의 기본요금+전력량요금(세전, 중간 반올림 없는 Decimal).

    brackets=[(200, 단가1), (400, 단가2), (None, 단가3)]. 기본요금은
    마지막 도달 구간 하나만 적용한다. 200.1kWh도 두 번째 구간이다.
    """
    usage = _nonnegative(kwh, "kwh")
    if not brackets or len(brackets) != len(base_fees):
        raise ValueError("brackets/base_fees: 구간 수가 일치해야 합니다")
    previous = Decimal(0)
    validated = []
    for index, ((upper, rate), fee) in enumerate(zip(brackets, base_fees, strict=True)):
        ceiling = None if upper is None else _nonnegative(upper, "구간 상한")
        if (ceiling is None) != (index == len(brackets) - 1):
            raise ValueError("마지막 구간만 상한 None이어야 합니다")
        if ceiling is not None and ceiling <= previous:
            raise ValueError("구간 상한은 증가해야 합니다")
        validated.append((ceiling, _nonnegative(rate, "단가"), _nonnegative(fee, "기본요금")))
        if ceiling is not None:
            previous = ceiling
    charge, previous = Decimal(0), Decimal(0)
    for ceiling, rate, fee in validated:
        charge += ((usage if ceiling is None else min(usage, ceiling)) - previous) * rate
        if ceiling is None or usage <= ceiling:
            return fee + charge
        previous = ceiling
    raise ValueError("상한 없는 마지막 구간이 필요합니다")  # pragma: no cover


def _value(params: Params, name: str):
    return params[name]["value"]


def _round_by_rule(value: Decimal, rule: str) -> Decimal:
    if rule == "none":
        return value
    if rule == "half_up_won":
        return value.quantize(Decimal(1), rounding=ROUND_HALF_UP)
    if rule in ("floor_won", "floor_10_won"):
        unit = Decimal(10 if rule == "floor_10_won" else 1)
        return (value / unit).to_integral_value(rounding=ROUND_FLOOR) * unit
    raise ValueError(f"지원하지 않는 원 미만 처리 규칙: {rule}")


def electricity_bill(kwh: Number, month: int, params: Params | None = None) -> int:
    """누진·하계·슈퍼유저 단가 적용 후 기후/연료·VAT·전력기금 계산."""
    params = DEFAULT_PARAMS if params is None else params
    _integer(month, "month", 1)
    if month > 12:
        raise ValueError("month: 1~12월이어야 합니다")
    usage = _nonnegative(kwh, "kwh")
    summer = month in _value(params, "electricity_summer_months")
    brackets = _value(params, "electricity_summer_brackets" if summer else "electricity_brackets")
    fees = _value(params, "electricity_base_fees")
    superuser = _value(params, "electricity_superuser")
    threshold = _nonnegative(superuser["threshold_kwh"])
    if month in superuser["months"] and usage > threshold:
        energy = progressive_bill(threshold, brackets, fees)
        energy += (usage - threshold) * _nonnegative(superuser["rate_krw"])
    else:
        energy = progressive_bill(usage, brackets, fees)
    subtotal = energy + usage * (
        _decimal(_value(params, "electricity_climate_krw_per_kwh"))
        + _decimal(_value(params, "electricity_fuel_krw_per_kwh"))
    )
    rules = _value(params, "electricity_rounding")
    subtotal = _round_by_rule(subtotal, rules["subtotal"])
    vat = _round_by_rule(subtotal * _decimal(_value(params, "electricity_vat_rate")), rules["vat"])
    fund = _round_by_rule(
        subtotal * _decimal(_value(params, "electricity_fund_rate")), rules["fund"]
    )
    return _won(_round_by_rule(subtotal + vat + fund, rules["total"]))


def brokerage_transaction_value(
    deposit_krw: int,
    monthly_rent_krw: int,
    params: Params | None = None,
) -> int:
    """×100 환산액이 5천만원 미만일 때만 ×70으로 재환산한다."""
    _integer(deposit_krw, "deposit_krw")
    _integer(monthly_rent_krw, "monthly_rent_krw")
    params = DEFAULT_PARAMS if params is None else params
    table = _value(params, "brokerage_conversion")
    amount = deposit_krw + monthly_rent_krw * table["multiplier"]
    if amount < table["threshold_krw"]:
        amount = deposit_krw + monthly_rent_krw * table["reduced_multiplier"]
    return amount


def _recurring(key, label, amount, basis, source, note="", *, low=None, high=None) -> CostItem:
    return CostItem(
        key,
        label,
        amount,
        0,
        amount if low is None else low,
        amount if high is None else high,
        basis,
        source,
        note,
        basis in _ESTIMATED_BASES,
    )


def _one_time(key, label, amount, low, high, months, basis, source, note="") -> CostItem:
    return CostItem(
        key,
        label,
        _won(Decimal(amount) / months),
        amount,
        low,
        high,
        basis,
        source,
        note,
        basis in _ESTIMATED_BASES,
    )


def _management(data: ExtraCostInput, params: Params) -> CostItem:
    if data.monthly_management_krw is not None:
        return _recurring("management", "관리비", data.monthly_management_krw, "실측", "input")
    per_area = data.area_m2 is not None
    source = "management_per_m2" if per_area else "management_flat_krw"
    table = _value(params, source)[data.building_type]
    multiplier = _decimal(data.area_m2) if per_area else Decimal(1)
    low, amount, high = (
        _won(_decimal(table[key]) * multiplier) for key in ("p25", "median", "p75")
    )
    return _recurring(
        "management",
        "관리비(참고 추정)",
        amount,
        "통계추정",
        source,
        "미확인 관리비의 참고 추정; 기존 unknown 판정을 변경하지 않음; 분위수 검증 필요",
        low=low,
        high=high,
    )


def _seasonal(months: tuple[int, ...], charges: list[int]) -> SeasonalCost:
    monthly = tuple(
        MonthlyCharge(month, amount) for month, amount in zip(months, charges, strict=True)
    )
    peak = max(monthly, key=lambda row: row.amount_krw)  # 동률이면 체류 순서상 첫 달
    total = sum(charges)
    return SeasonalCost(
        monthly, total, _won(Decimal(total) / len(months)), peak.month, peak.amount_krw
    )


def _utilities(data: ExtraCostInput, params: Params, months: tuple[int, ...]):
    low_factor, high_factor = map(_decimal, _value(params, "utility_usage_range"))
    if not 0 <= low_factor <= 1 <= high_factor:
        raise ValueError("utility_usage_range: 0 <= low <= 1 <= high가 필요합니다")
    electric_factors = _value(params, "electricity_month_factors")
    gas_factors = _value(params, "gas_month_factors")
    days = _value(params, "days_per_month")
    if any(len(profile) != 12 for profile in (electric_factors, gas_factors, days)):
        raise ValueError("월별 계수와 일수는 12개여야 합니다")

    def electric(month: int, scale: Decimal) -> int:
        kwh = _nonnegative(_value(params, "electricity_base_kwh_per_person")) * data.persons
        kwh *= _nonnegative(electric_factors[month - 1]) * scale
        return electricity_bill(kwh, month, params)

    def gas(month: int, scale: Decimal) -> int:
        mj = _nonnegative(_value(params, "gas_base_mj_per_person")) * data.persons
        mj *= _nonnegative(gas_factors[month - 1]) * scale
        return _won(
            (
                _nonnegative(_value(params, "gas_base_fee_krw"))
                + mj * _nonnegative(_value(params, "gas_krw_per_mj"))
            )
            * (1 + _nonnegative(_value(params, "gas_vat_rate")))
        )

    def water(month: int, scale: Decimal) -> int:
        m3 = data.persons * _nonnegative(_value(params, "water_liters_per_person_day"))
        m3 *= _nonnegative(days[month - 1]) * scale / 1000
        unit_price = sum(
            _nonnegative(_value(params, name))
            for name in (
                "water_supply_krw_per_m3",
                "water_sewage_krw_per_m3",
                "water_charge_krw_per_m3",
            )
        )
        return _won(_nonnegative(_value(params, "water_base_fee_krw")) + m3 * unit_price)

    items, seasonal = [], {}
    calculators: tuple[tuple[str, str, str, Callable[[int, Decimal], int]], ...] = (
        ("electricity", "전기", "electricity_brackets", electric),
        ("gas", "가스", "gas_krw_per_mj", gas),
        ("water", "수도", "water_supply_krw_per_m3", water),
    )
    for key, label, source, calculate in calculators:
        note = "사용량·월별 계수·사용량 범위는 가정; 요율 검증 상태 참조"
        disabled = label in data.management_includes
        if disabled:
            note = "관리비 포함"
        elif key == "gas" and data.heating != "individual_gas":
            disabled = True
            note = "개별가스 난방 아님; 중앙/전기 난방비는 별도 확인 필요"
        summaries = [
            _seasonal(months, [0 if disabled else calculate(month, scale) for month in months])
            for scale in (Decimal(1), low_factor, high_factor)
        ]
        center, low, high = summaries
        seasonal[key] = center
        items.append(
            _recurring(
                key,
                label,
                center.monthly_average_krw,
                "실측" if disabled else "가정",
                "input" if disabled else source,
                note,
                low=low.monthly_average_krw,
                high=high.monthly_average_krw,
            )
        )
    return items, seasonal


def _brokerage(data: ExtraCostInput, params: Params) -> CostItem:
    amount = brokerage_transaction_value(data.deposit_krw, data.monthly_rent_krw, params)
    source = "brokerage_brackets"
    if data.building_type == "officetel":
        source = "brokerage_officetel_rate"
        fee = _decimal(amount) * _nonnegative(_value(params, source))
    else:
        for upper, rate, cap in _value(params, source):
            if upper is None or amount < upper:
                fee = _decimal(amount) * _nonnegative(rate)
                if cap is not None:
                    fee = min(fee, _nonnegative(cap))
                break
        else:
            raise ValueError("brokerage_brackets: 최상위 구간이 없습니다")
    vat = _value(params, "brokerage_vat_rates")
    low, center, high = (_won(fee * (1 + _decimal(vat[key]))) for key in ("low", "assumed", "high"))
    return _one_time(
        "brokerage",
        "중개보수(상한)",
        center,
        low,
        high,
        data.stay_months,
        "법정요율",
        source,
        f"환산보증금 {amount}원; 부가세 0~10%, 실제 협의액 아님; "
        "오피스텔은 주거용 85㎡ 이하 등 적용요건 충족 가정",
    )


def _total(parts: Iterable[Part]) -> CostTotal:
    amount = low = high = estimated = 0
    for center, lower, upper, basis in parts:
        if center is None or lower is None or upper is None:
            return CostTotal(None, None, None, None)
        amount += center
        low += lower
        high += upper
        if basis in _ESTIMATED_BASES:
            estimated += center
    share = Decimal(estimated * 100) / amount if amount else Decimal(0)
    return CostTotal(
        amount, low, high, float(share.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    )


def calculate_extra_costs(data: ExtraCostInput, params: Params | None = None) -> ExtraCostResult:
    """동일 입력·params에 동일 결과. 입출력·기존 판정·기본 params를 변경하지 않는다.

    금리는 3%를 0.03으로 입력한다. 대출이면 deposit_rate_annual에 대출금리를
    넣으며 보증금 전액에 적용한다(부분 대출 원금은 현재 입력 계약에 없다).
    """
    params = DEFAULT_PARAMS if params is None else params
    months = tuple((data.move_in_month - 1 + offset) % 12 + 1 for offset in range(data.stay_months))
    management = _management(data, params)
    utilities, seasonal = _utilities(data, params, months)
    internet_included = "인터넷" in data.management_includes
    cash_items = [
        _recurring("rent", "월세", data.monthly_rent_krw, "실측", "input"),
        management,
        *utilities,
        _recurring(
            "internet",
            "인터넷",
            0 if internet_included else _won(_value(params, "internet_monthly_krw")),
            "실측" if internet_included else "가정",
            "internet_monthly_krw",
            "관리비 포함" if internet_included else "통신상품·가입조건 미확인 가정",
        ),
        _recurring(
            "commute",
            "통근비",
            data.monthly_commute_krw,
            "실측",
            "input",
            "통근비 미확인" if data.monthly_commute_krw is None else "입력 월 통근비",
        ),
    ]
    startup = [_brokerage(data, params)]
    for key, label, source in (
        ("moving", "이사비", "moving_one_time_krw"),
        ("cleaning", "입주청소", "cleaning_one_time_krw"),
    ):
        table = _value(params, source)[data.moving_size]
        startup.append(
            _one_time(
                key,
                label,
                _won(table["median"]),
                _won(table["low"]),
                _won(table["high"]),
                data.stay_months,
                "가정",
                source,
                "짐 규모 기준 가정; 업체 견적 확인 필요",
            )
        )
    rate = (
        _value(params, "deposit_rate_annual")
        if data.deposit_rate_annual is None
        else data.deposit_rate_annual
    )
    opportunity = _recurring(
        "deposit_opportunity",
        "보증금 기회비용",
        _won(data.deposit_krw * _decimal(rate) / 12),
        "가정",
        "deposit_rate_annual",
        "보증금 전액 × 연이율 / 12; 대출금리 입력 시 대체",
    )
    cash_parts = [
        (item.monthly_krw, item.low_krw, item.high_krw, item.basis) for item in cash_items
    ]
    amortized = [
        (
            item.monthly_krw,
            _won(Decimal(item.low_krw) / data.stay_months),
            _won(Decimal(item.high_krw) / data.stay_months),
            item.basis,
        )
        for item in startup
    ]
    initial = [(data.deposit_krw, data.deposit_krw, data.deposit_krw, "실측"), cash_parts[0]]
    initial += [(item.one_time_krw, item.low_krw, item.high_krw, item.basis) for item in startup]
    return ExtraCostResult(
        items=tuple([*cash_items, *startup, opportunity]),
        cash_monthly=_total(cash_parts),
        economic_monthly=_total(
            [
                *cash_parts,
                *amortized,
                (
                    opportunity.monthly_krw,
                    opportunity.low_krw,
                    opportunity.high_krw,
                    opportunity.basis,
                ),
            ]
        ),
        initial_cash=_total(initial),
        seasonal=seasonal,
        management_estimated=management.estimated,
        parameter_statuses={name: parameter["status"] for name, parameter in params.items()},
        assumptions=(
            "시연 추정치이며 실제 고지액·견적이 아님; params의 출처·검증 상태 확인 필요",
            "관리비 추정은 기존 unknown 판정을 변경하지 않음; 분위수는 검증 필요",
            "공과금 사용량·계절계수·범위는 가정; 수도 일수는 평년 기준",
            "추정 비중은 통계추정·가정 basis의 중앙 금액 합 / 해당 합계 × 100(소수 둘째 자리)",
            "initial_cash는 보증금+첫 달 월세+중개보수+이사·청소만 포함",
            "월할·월평균은 항목별 0.5원 올림 후 합산; 일회성 low/high는 선납 원금 범위",
        ),
    )
