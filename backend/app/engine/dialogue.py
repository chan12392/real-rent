"""Pure Korean condition extraction; candidates never update comparison conditions."""

import re
from collections.abc import Mapping
from datetime import date
from decimal import Decimal
from typing import Literal, TypedDict

ConditionField = Literal[
    "deposit_limit_krw",
    "monthly_budget_krw",
    "move_in_by",
    "office_days",
    "max_one_way_minutes",
    "max_transfers",
    "priority",
    "stay_months",
]


class Candidate(TypedDict):
    field: ConditionField
    value: int | str
    display: str
    source_text: str
    needs_confirmation: bool
    note: str | None


class Question(TypedDict):
    field: ConditionField
    question: str
    options: list[str]


class ParseResult(TypedDict):
    candidates: list[Candidate]
    questions: list[Question]
    understood: bool


DIALOGUE_ASSUMPTIONS = (
    "조건은 LLM 없는 한국어 규칙으로 해석한 후보이며 사용자 확인 전에는 적용하지 않는다",
    "월 지출 한도는 월세+관리비+통근비 합계이며 단위 없는 금액은 만 원으로 읽는다",
    "연도 없는 날짜는 서버 기준일 이후 가장 가까운 날짜, 주 출근일은 round(주 일수*52/12)로 읽는다",
)

_NUMBER = r"[+-]?\d+(?:,\d{3})*(?:\.\d+)?"
_OTHER_UNIT = re.compile(r"\s*(?:일|분|개월|년|월(?!세|\s*(?:예산|지출))|회|번)")
_MONEY_NUMBER = rf"(?!\d{{4}}-\d{{1,2}}-\d{{1,2}}){_NUMBER}(?![\d,.])(?!{_OTHER_UNIT.pattern})"
# Consume the whole money phrase, including unsupported unit combinations, so
# its remaining numbers can never become a different condition's candidate.
_AMOUNT = rf"(?:{_NUMBER}|천\s*만)(?:\s*[조억천백십만원](?:\s*{_MONEY_NUMBER})?)*"
_AMOUNT_END = r"(?![\d조억천백십만원]|[,.]\d)"
_MONEY_LABEL = r"보증금|월\s*예산|월\s*지출(?:\s*한도)?|월세|한\s*달|월"
_LABELLED_MONEY = re.compile(
    rf"(?<!\d)(?P<label>{_MONEY_LABEL})\s*(?:은|는|을|를)?\s*"
    rf"(?:최대\s*|약\s*|한도\s*)?(?P<amount>{_AMOUNT}){_AMOUNT_END}"
    r"(?:\s*(?:이하|이내|까지|안쪽))?"
)
_DATE_PATTERNS = (
    re.compile(r"(?<!\d)(?P<year>\d{4})-(?P<month>\d{1,2})-(?P<day>\d{1,2})(?!\d)"),
    re.compile(
        r"(?<!\d)(?:(?P<year>\d{4})\s*년\s*)?"
        r"(?P<month>\d{1,2})\s*월\s*(?P<day>\d{1,2})\s*일"
    ),
    re.compile(r"(?<![\d/])(?:(?P<year>\d{4})/)?(?P<month>\d{1,2})/(?P<day>\d{1,2})(?![\d/])"),
)
_LABELS: dict[ConditionField, str] = {
    "deposit_limit_krw": "보증금 한도",
    "monthly_budget_krw": "월 지출 한도",
    "move_in_by": "입주 희망일",
    "office_days": "월 출근일",
    "max_one_way_minutes": "편도 통근 상한",
    "max_transfers": "환승 상한",
    "priority": "우선순위",
    "stay_months": "거주 기간",
}
_QUESTIONS: dict[ConditionField, str] = {
    "deposit_limit_krw": "보증금 한도를 얼마로 할까요?",
    "monthly_budget_krw": "월 지출 한도(월세+관리비+통근비)를 얼마로 할까요?",
    "move_in_by": "입주 희망일을 연도와 함께 알려 주세요.",
    "office_days": "한 달 출근일을 0~31일 중 며칠로 할까요?",
    "max_one_way_minutes": "편도 통근 시간을 몇 분 이내로 할까요?",
    "max_transfers": "환승은 최대 몇 회까지 괜찮을까요?",
    "priority": "비용과 시간 중 무엇을 우선할까요?",
    "stay_months": "거주 기간을 1~60개월 중 몇 개월로 할까요?",
}


class _Collector:
    def __init__(self, current: Mapping[str, object]):
        self.current = current
        self.values: dict[ConditionField, Candidate] = {}
        self.observed: dict[ConditionField, int | str] = {}
        self.questions: dict[ConditionField, Question] = {}
        self.seen: set[ConditionField] = set()

    def question(self, field: ConditionField, reason: str = "") -> None:
        self.seen.add(field)
        self.values.pop(field, None)
        self.questions[field] = {
            "field": field,
            "question": f"{reason} {_QUESTIONS[field]}".strip(),
            "options": ["cost", "time"] if field == "priority" else [],
        }

    def add(
        self,
        field: ConditionField,
        value: int | str,
        source: str,
        *,
        confirmation: bool = False,
        note: str | None = None,
    ) -> None:
        self.seen.add(field)
        if field in self.questions:
            return
        if field in self.observed and self.observed[field] != value:
            self.question(field, "서로 다른 값이 함께 있어 하나를 정할 수 없습니다.")
            return
        self.observed[field] = value
        previous = self.current.get(field)
        if isinstance(previous, date):
            previous = previous.isoformat()
        if previous == value:
            return
        existing = self.values.get(field)
        if existing:
            confirmation = confirmation or existing["needs_confirmation"]
            note = (
                " ".join(dict.fromkeys(text for text in (existing["note"], note) if text)) or None
            )
        unit = {
            "office_days": "일",
            "max_one_way_minutes": "분",
            "max_transfers": "회",
            "stay_months": "개월",
        }.get(field, "")
        shown = f"{value:,}원" if field.endswith("_krw") else f"{value}{unit}"
        if field == "priority":
            shown = "비용 우선" if value == "cost" else "시간 우선"
        self.values[field] = {
            "field": field,
            "value": value,
            "display": f"{_LABELS[field]} {shown}",
            "source_text": source.strip(),
            "needs_confirmation": confirmation,
            "note": note,
        }

    def integer(
        self,
        field: ConditionField,
        number: Decimal,
        source: str,
        minimum: int,
        maximum: int | None = None,
        **kwargs,
    ) -> None:
        if number != number.to_integral_value():
            self.question(field, "정수 단위로 입력해 주세요.")
        elif number < minimum or (maximum is not None and number > maximum):
            limit = f"{minimum}~{maximum}" if maximum is not None else f"{minimum} 이상"
            self.question(field, f"입력값 {number}은 허용 범위({limit})를 벗어납니다.")
        else:
            self.add(field, int(number), source, **kwargs)


def _decimal(text: str) -> Decimal:
    return Decimal(text.replace(",", ""))


def _money(text: str) -> tuple[Decimal, bool]:
    compact = re.sub(r"\s|,", "", text)
    won = compact.endswith("원")
    if won:
        compact = compact[:-1]
    if re.fullmatch(_NUMBER, compact):
        return Decimal(compact) * (1 if won else 10_000), not won

    sign = -1 if compact.startswith("-") else 1
    if compact.startswith(("+", "-")):
        compact = compact[1:]
    total, position, previous = Decimal(0), 0, None
    for match in re.finditer(r"(?P<number>\d+(?:\.\d+)?)?(?P<unit>억|천만|만|천)", compact):
        if match.start() != position:
            raise ValueError("Unsupported money expression")
        unit = match["unit"]
        # In property shorthand, '1억 5천' means '1억 5천만'. Explicit
        # '원' instead makes a trailing '천' a literal thousand won.
        multiplier = {
            "억": 100_000_000,
            "천만": 10_000_000,
            "만": 10_000,
            "천": 1000 if won else 10_000_000,
        }[unit]
        if previous is not None and multiplier >= previous:
            raise ValueError("Money units must be in descending order")
        total += Decimal(match["number"] or "1") * multiplier
        position, previous = match.end(), multiplier
    if position != len(compact) or position == 0:
        raise ValueError("Unsupported money expression")
    return total * sign, False


def _overlaps(span: tuple[int, int], spans: list[tuple[int, int]]) -> bool:
    return any(span[0] < end and start < span[1] for start, end in spans)


def _unsupported_limit_suffix(message: str, end: int) -> bool:
    suffix = re.split(
        rf"[,，.;!?。\n]|{_MONEY_LABEL}|환승|편도|통근|출근|입주|거주",
        message[end:],
        maxsplit=1,
    )[0]
    # shortcut: 지정한 후행 부정·하한 문구만 거르며, 지원 문법 확장 시 함께 갱신한다.
    return re.search(
        r"이상|초과|미만|넘|안\s*(?:돼|되|해|함)|않|싫|아니|말고|불가|금지|제외", suffix
    ) is not None


def _parse_money(message: str, found: _Collector) -> None:
    labelled = []
    for match in _LABELLED_MONEY.finditer(message):
        if _OTHER_UNIT.match(message[match.end() :]) and not re.search(
            r"[조억천백십만원]", match["amount"]
        ):
            continue
        labelled.append(match.span())
        label = match["label"]
        field = "deposit_limit_krw" if label == "보증금" else "monthly_budget_krw"
        if _unsupported_limit_suffix(message, match.end()):
            found.question(field, "부정·하한 표현을 상한으로 해석할 수 없습니다.")
            continue
        try:
            amount, unitless = _money(match["amount"])
        except ValueError:
            found.question(field, "금액 전체의 단위와 표기를 확인해 주세요.")
            continue
        notes = ["단위 없는 금액을 만 원 단위로 읽었습니다."] if unitless else []
        rent_only = label == "월세"
        if field == "monthly_budget_krw":
            notes.append("월 지출 한도는 월세+관리비+통근비 합계입니다.")
        if rent_only:
            notes.append("월세만의 금액과 합계 한도는 다르므로 확인해 주세요.")
        found.integer(
            field,
            amount,
            match[0],
            0,
            confirmation=unitless or rent_only,
            note=" ".join(notes) or None,
        )
    for match in re.finditer(rf"(?<![\d,.]){_AMOUNT}{_AMOUNT_END}", message):
        if _overlaps(match.span(), labelled):
            continue
        if _OTHER_UNIT.match(message[match.end() :]) and not re.search(
            r"[조억천백십만원]", match[0]
        ):
            continue
        suffix = re.match(r"\s*(?:이하|이내|까지|안쪽)", message[match.end() :])
        if not re.search(r"[조억천백십만원]", match[0]) and suffix is None:
            continue
        if _unsupported_limit_suffix(message, match.end()):
            found.question("monthly_budget_krw", "부정·하한 표현을 상한으로 해석할 수 없습니다.")
            continue
        try:
            amount, unitless = _money(match[0])
        except ValueError:
            found.question("monthly_budget_krw", "금액 전체의 단위와 표기를 확인해 주세요.")
            continue
        source = message[match.start() : match.end() + (suffix.end() if suffix else 0)]
        note = "금액을 월 지출 한도 후보로 읽었습니다. 월세+관리비+통근비 합계인지 확인해 주세요."
        if unitless:
            note = "단위 없는 금액을 만 원 단위로 읽었습니다. " + note
        found.integer("monthly_budget_krw", amount, source, 0, confirmation=True, note=note)


def _parse_dates(message: str, found: _Collector, reference_date: date) -> list[tuple[int, int]]:
    spans = []
    for pattern in _DATE_PATTERNS:
        for match in pattern.finditer(message):
            if _overlaps(match.span(), spans):
                continue
            spans.append(match.span())
            year, month, day = match["year"], int(match["month"]), int(match["day"])
            years = (
                [int(year)]
                if year
                else range(reference_date.year, min(9999, reference_date.year + 8) + 1)
            )
            resolved = None
            for candidate_year in years:
                try:
                    candidate = date(candidate_year, month, day)
                except ValueError:
                    continue
                if year or candidate >= reference_date:
                    resolved = candidate
                    break
            if resolved is None:
                found.question("move_in_by", "존재하지 않거나 해석할 수 없는 날짜입니다.")
                continue
            found.add(
                "move_in_by",
                resolved.isoformat(),
                match[0],
                confirmation=year is None,
                note=(
                    f"연도가 없어 기준일 {reference_date.isoformat()} 이후 가장 가까운 "
                    f"{resolved.isoformat()}로 읽었습니다."
                )
                if year is None
                else None,
            )
    return spans


def parse_conditions(
    message: str,
    current: Mapping[str, object] | None = None,
    *,
    reference_date: date | None = None,
) -> ParseResult:
    """Return suggestions only, with an injectable clock and no I/O or input execution."""
    found = _Collector(current if current is not None else {})
    _parse_money(message, found)
    date_spans = _parse_dates(message, found, reference_date or date.today())

    for match in re.finditer(
        rf"(?P<period>주|월|한\s*달)\s*(?P<days>{_NUMBER})\s*일\s*(?:출근|근무)", message
    ):
        days = _decimal(match["days"])
        weekly = match["period"] == "주"
        if weekly and (days != days.to_integral_value() or not 0 <= days <= 7):
            found.question("office_days", "주 출근일은 0~7일 정수여야 합니다.")
            continue
        converted = Decimal(round(days * 52 / 12)) if weekly else days
        found.integer(
            "office_days",
            converted,
            match[0],
            0,
            31,
            confirmation=weekly,
            note=f"round({days}*52/12)={converted}일로 월 출근일을 환산했습니다."
            if weekly
            else None,
        )
    for match in re.finditer(r"재택|출근\s*(?:안\s*(?:함|해)|하지\s*않\w*)", message):
        found.add(
            "office_days",
            0,
            match[0],
            confirmation=True,
            note=(
                "재택·출근하지 않음을 월 출근일 0일로 읽었습니다. "
                "부분 재택이면 일수를 확인해 주세요."
            ),
        )
    for match in re.finditer(
        rf"(?:편도\s*)?(?P<minutes>{_NUMBER})\s*분(?:\s*(?:이내|안쪽|이하|까지))?", message
    ):
        if _unsupported_limit_suffix(message, match.end()):
            found.question("max_one_way_minutes", "부정·하한 표현을 상한으로 해석할 수 없습니다.")
            continue
        found.integer("max_one_way_minutes", _decimal(match["minutes"]), match[0], 1)
    for match in re.finditer(
        rf"환승\s*(?:은|는|이|을)?\s*(?P<count>{_NUMBER})\s*(?:번|회)"
        r"(?:\s*(?:이하|이내|까지))?",
        message,
    ):
        if _unsupported_limit_suffix(message, match.end()):
            found.question("max_transfers", "부정·하한 표현을 상한으로 해석할 수 없습니다.")
            continue
        found.integer("max_transfers", _decimal(match["count"]), match[0], 0)
    for match in re.finditer(r"환승\s*(?:없이|없음|없는)|직통", message):
        if _unsupported_limit_suffix(message, match.end()):
            found.question("max_transfers", "부정·하한 표현을 상한으로 해석할 수 없습니다.")
            continue
        found.add("max_transfers", 0, match[0])

    for match in re.finditer(
        rf"(?P<years>{_NUMBER})\s*년(?:\s*(?P<extra>{_NUMBER})\s*개월)?"
        rf"|(?P<months>{_NUMBER})\s*개월",
        message,
    ):
        if _overlaps(match.span(), date_spans):
            continue
        months = (
            _decimal(match["years"]) * 12 + _decimal(match["extra"] or "0")
            if match["years"] is not None
            else _decimal(match["months"])
        )
        found.integer("stay_months", months, match[0], 1, 60)

    for pattern, priority in (
        (r"(?:통근|시간)\s*(?:이|을|은)?\s*우선|빨리", "time"),
        (r"싸게|저렴|(?:비용|돈)\s*(?:이|을|은)?\s*우선", "cost"),
    ):
        for match in re.finditer(pattern, message):
            found.add("priority", priority, match[0])

    for field, pattern in (
        ("monthly_budget_krw", r"월세|월\s*예산|월\s*지출|(?:비용|돈).*줄"),
        ("deposit_limit_krw", r"보증금"),
        ("max_one_way_minutes", r"더\s*가까|가까웠|(?:통근|출퇴근|편도).*(?:줄|짧|가까)"),
        ("office_days", r"출근\s*일수|출근일|(?:주|월|한\s*달).*출근"),
        ("max_transfers", r"환승"),
        ("move_in_by", r"입주"),
        ("stay_months", r"거주\s*기간"),
        ("priority", r"우선순위"),
    ):
        if field not in found.seen and re.search(pattern, message):
            found.question(field)

    candidates = list(found.values.values())
    questions = list(found.questions.values())
    return {
        "candidates": candidates,
        "questions": questions,
        "understood": bool(candidates or questions),
    }
