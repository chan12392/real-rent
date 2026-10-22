"""Condition interpretation boundaries, explicit assumptions and current-value filtering."""

from copy import deepcopy
from datetime import date

import pytest

from app.engine.dialogue import parse_conditions

TODAY = date(2026, 10, 21)


def parse(message, current=None, reference_date=TODAY):
    return parse_conditions(message, current, reference_date=reference_date)


@pytest.mark.parametrize(
    "message, field, amount, confirmation",
    [
        ("60만원", "monthly_budget_krw", 600_000, True),
        ("60만", "monthly_budget_krw", 600_000, True),
        ("월 60", "monthly_budget_krw", 600_000, True),
        ("60 이하", "monthly_budget_krw", 600_000, True),
        ("월세 60만원", "monthly_budget_krw", 600_000, True),
        ("월세 60만원.", "monthly_budget_krw", 600_000, True),
        ("월세 60만", "monthly_budget_krw", 600_000, True),
        ("월세 60 이하", "monthly_budget_krw", 600_000, True),
        ("월 예산 60만원", "monthly_budget_krw", 600_000, False),
        ("한 달 60만원", "monthly_budget_krw", 600_000, False),
        ("월 지출 한도 600,000원", "monthly_budget_krw", 600_000, False),
        ("월 예산 60.5만 원", "monthly_budget_krw", 605_000, False),
        ("보증금 천만", "deposit_limit_krw", 10_000_000, False),
        ("보증금 1천만", "deposit_limit_krw", 10_000_000, False),
        ("보증금 1000만", "deposit_limit_krw", 10_000_000, False),
        ("보증금 1억", "deposit_limit_krw", 100_000_000, False),
        ("보증금 1.5억 원", "deposit_limit_krw", 150_000_000, False),
        ("보증금 1000", "deposit_limit_krw", 10_000_000, True),
        ("천만", "monthly_budget_krw", 10_000_000, True),
        ("1천만", "monthly_budget_krw", 10_000_000, True),
        ("1000만", "monthly_budget_krw", 10_000_000, True),
        ("월 예산 0원", "monthly_budget_krw", 0, False),
    ],
)
def test_money_expressions(message, field, amount, confirmation):
    result = parse(message)
    assert result["questions"] == []
    assert len(result["candidates"]) == 1
    candidate = result["candidates"][0]
    assert candidate["field"] == field
    assert candidate["value"] == amount
    assert candidate["needs_confirmation"] is confirmation
    assert candidate["source_text"] in message
    if confirmation:
        assert candidate["note"]


def test_rent_is_not_silently_treated_as_total_budget():
    candidate = parse("월세 60 이하")["candidates"][0]
    assert candidate["source_text"] == "월세 60 이하"
    assert candidate["needs_confirmation"] is True
    assert "만 원" in candidate["note"]
    assert "월세+관리비+통근비" in candidate["note"]
    assert "다르" in candidate["note"]


@pytest.mark.parametrize(
    "message",
    ["월세 60만원, 월 예산 60만원", "월 예산 60만원, 월세 60만원", "월세 60만원, 60 이하"],
)
def test_repeated_same_amount_preserves_rent_confirmation(message):
    result = parse(message)
    assert len(result["candidates"]) == 1
    candidate = result["candidates"][0]
    assert candidate["value"] == 600_000
    assert candidate["needs_confirmation"] is True
    assert "월세+관리비+통근비" in candidate["note"]
    assert "다르" in candidate["note"]


@pytest.mark.parametrize(
    "message", ["40분 이내", "40분 안쪽", "40분 이하", "40분까지", "편도 40분"]
)
def test_one_way_minutes(message):
    result = parse(message)
    assert [(c["field"], c["value"]) for c in result["candidates"]] == [("max_one_way_minutes", 40)]
    assert result["questions"] == []


@pytest.mark.parametrize(
    "message, count", [("환승 1번", 1), ("환승 1회 이하", 1), ("환승 없이", 0), ("직통", 0)]
)
def test_transfers(message, count):
    assert [(c["field"], c["value"]) for c in parse(message)["candidates"]] == [
        ("max_transfers", count)
    ]


@pytest.mark.parametrize(
    "message, count, confirmation",
    [
        ("주 5일 출근", 22, True),
        ("월 20일 출근", 20, False),
        ("재택", 0, True),
        ("출근 안 함", 0, True),
        ("출근하지 않음", 0, True),
    ],
)
def test_office_days(message, count, confirmation):
    result = parse(message)
    assert result["questions"] == []
    assert len(result["candidates"]) == 1
    candidate = result["candidates"][0]
    assert candidate["field"] == "office_days"
    assert candidate["value"] == count
    assert candidate["needs_confirmation"] is confirmation
    if message.startswith("주"):
        assert "round(5*52/12)=22" in candidate["note"]


@pytest.mark.parametrize(
    "message, reference_date, expected, confirmation",
    [
        ("11월 1일 입주", TODAY, "2026-11-01", True),
        ("11/1", TODAY, "2026-11-01", True),
        ("11/1", date(2026, 11, 2), "2027-11-01", True),
        ("11/1", date(2026, 11, 1), "2026-11-01", True),
        ("1/1 입주", TODAY, "2027-01-01", True),
        ("2월 29일 입주", date(2027, 1, 1), "2028-02-29", True),
        ("2026-11-01", TODAY, "2026-11-01", False),
        ("2026-11-01", date(2028, 1, 1), "2026-11-01", False),
        ("2026년 11월 1일 입주", TODAY, "2026-11-01", False),
    ],
)
def test_dates_with_injected_reference_date(message, reference_date, expected, confirmation):
    result = parse(message, reference_date=reference_date)
    assert result["questions"] == []
    assert len(result["candidates"]) == 1
    candidate = result["candidates"][0]
    assert candidate["field"] == "move_in_by"
    assert candidate["value"] == expected
    assert candidate["needs_confirmation"] is confirmation
    if confirmation:
        assert reference_date.isoformat() in candidate["note"]


def test_default_reference_date_uses_today():
    today = date.today()
    result = parse_conditions(f"{today.month}/{today.day}")
    assert result["candidates"][0]["value"] == today.isoformat()


@pytest.mark.parametrize(
    "message, months",
    [("1년", 12), ("12개월", 12), ("2년 살", 24), ("1년 6개월", 18), ("60개월", 60)],
)
def test_stay_periods(message, months):
    assert [(c["field"], c["value"]) for c in parse(message)["candidates"]] == [
        ("stay_months", months)
    ]


@pytest.mark.parametrize(
    "message, priority",
    [
        ("통근 우선", "time"),
        ("시간 우선", "time"),
        ("빨리", "time"),
        ("싸게", "cost"),
        ("비용 우선", "cost"),
        ("돈 우선", "cost"),
        ("저렴", "cost"),
    ],
)
def test_priorities(message, priority):
    assert parse(message)["candidates"][0]["value"] == priority


@pytest.mark.parametrize(
    "message, field",
    [("월세를 조금 줄이고 싶어", "monthly_budget_krw"), ("더 가까웠으면", "max_one_way_minutes")],
)
def test_numberless_intents_ask_one_question_without_inventing_values(message, field):
    result = parse(message)
    assert result["candidates"] == []
    assert len(result["questions"]) == 1
    assert result["questions"][0]["field"] == field
    assert result["understood"] is True


@pytest.mark.parametrize(
    "message, field, value",
    [
        ("보증금 1억", "deposit_limit_krw", 100_000_000),
        ("월세 60 이하", "monthly_budget_krw", 600_000),
        ("2026-11-01", "move_in_by", "2026-11-01"),
        ("2026-11-01", "move_in_by", date(2026, 11, 1)),
        ("주 5일 출근", "office_days", 22),
        ("40분 이하", "max_one_way_minutes", 40),
        ("직통", "max_transfers", 0),
        ("비용 우선", "priority", "cost"),
        ("1년", "stay_months", 12),
    ],
)
def test_current_values_are_filtered_without_mutation(message, field, value):
    current = {field: value, "management_overrides": {"L03": 60_000}}
    original = deepcopy(current)
    assert parse(message, current) == {"candidates": [], "questions": [], "understood": False}
    assert current == original


@pytest.mark.parametrize(
    "message, field",
    [
        ("월 32일 출근", "office_days"),
        ("월 -1일 출근", "office_days"),
        ("주 8일 출근", "office_days"),
        ("월 1.5일 출근", "office_days"),
        ("0개월", "stay_months"),
        ("61개월", "stay_months"),
        ("6년 살", "stay_months"),
        ("편도 0분", "max_one_way_minutes"),
        ("편도 -40분", "max_one_way_minutes"),
        ("환승 -1회", "max_transfers"),
        ("보증금 -1억", "deposit_limit_krw"),
        ("월 예산 -60만원", "monthly_budget_krw"),
        ("월 예산 0.5원", "monthly_budget_krw"),
        ("2/30 입주", "move_in_by"),
        ("2026-02-29", "move_in_by"),
    ],
)
def test_invalid_values_become_questions_with_reasons(message, field):
    result = parse(message)
    assert result["candidates"] == []
    assert len(result["questions"]) == 1
    question = result["questions"][0]
    assert question["field"] == field
    assert any(word in question["question"] for word in ("범위", "정수", "날짜"))


def test_multiple_fields_and_independent_invalid_value():
    result = parse("보증금 천만, 월세 60 이하, 편도 40분, 환승 1회 이하, 월 32일 출근, 2년 살")
    assert {c["field"]: c["value"] for c in result["candidates"]} == {
        "deposit_limit_krw": 10_000_000,
        "monthly_budget_krw": 600_000,
        "max_one_way_minutes": 40,
        "max_transfers": 1,
        "stay_months": 24,
    }
    assert [q["field"] for q in result["questions"]] == ["office_days"]


@pytest.mark.parametrize(
    "message, field",
    [
        ("월세 60만, 월 예산 70만", "monthly_budget_krw"),
        ("시간 우선 비용 우선", "priority"),
        ("주 5일 출근, 재택", "office_days"),
    ],
)
def test_conflicting_values_require_clarification(message, field):
    result = parse(message)
    assert result["candidates"] == []
    assert result["questions"][0]["field"] == field
    assert "서로 다른" in result["questions"][0]["question"]


@pytest.mark.parametrize("message", ["", "   ", "안녕하세요", "오늘은 맑음", "알 수 없는 문자열"])
def test_uninterpretable_text_has_no_conditions(message):
    assert parse(message) == {"candidates": [], "questions": [], "understood": False}


def test_instruction_text_is_only_parsed_as_data(monkeypatch):
    def must_not_execute(*args, **kwargs):
        pytest.fail("input was executed")

    monkeypatch.setattr("os.system", must_not_execute)
    result = parse("월세 60만원; __import__('os').system('echo unsafe')")
    assert result["candidates"][0]["value"] == 600_000


@pytest.mark.parametrize(
    "expression, amount",
    [
        ("1억 5천만원", 150_000_000),
        ("1억5000만원", 150_000_000),
        ("1억 5000만 원", 150_000_000),
        ("1억 5천", 150_000_000),
        ("1억5천만", 150_000_000),
        ("2억", 200_000_000),
        ("5천만원", 50_000_000),
        ("3500만", 35_000_000),
    ],
)
def test_compound_deposit_is_one_candidate_and_preserves_monthly_budget(expression, amount):
    current = {"monthly_budget_krw": 750_000, "deposit_limit_krw": 10_000_000}
    original = deepcopy(current)
    result = parse(f"보증금 {expression}", current)
    assert result["questions"] == []
    assert len(result["candidates"]) == 1
    candidate = result["candidates"][0]
    assert candidate["field"] == "deposit_limit_krw"
    assert candidate["value"] == amount
    assert candidate["source_text"] == f"보증금 {expression}"
    assert current == original


@pytest.mark.parametrize(
    "expression, amount",
    [
        ("1억 5천만원", 150_000_000),
        ("1억5000만원", 150_000_000),
        ("1억 5천", 150_000_000),
        ("2억", 200_000_000),
        ("5천만원", 50_000_000),
        ("3500만", 35_000_000),
    ],
)
def test_unlabelled_compound_money_remains_one_budget_candidate(expression, amount):
    result = parse(expression)
    assert result["questions"] == []
    assert len(result["candidates"]) == 1
    candidate = result["candidates"][0]
    assert candidate["field"] == "monthly_budget_krw"
    assert candidate["value"] == amount
    assert candidate["source_text"] == expression
    assert candidate["needs_confirmation"] is True


@pytest.mark.parametrize(
    "message",
    [
        "월세 60 보증금 1억 5천",
        "보증금 1억 5천 월세 60",
        "보증금 1억5000만원, 월세 60만원",
        "월세 60만원, 보증금 1억 5천만원",
    ],
)
def test_compound_money_keeps_explicit_fields_separate(message):
    result = parse(message)
    assert result["questions"] == []
    assert len(result["candidates"]) == 2
    assert {c["field"]: c["value"] for c in result["candidates"]} == {
        "deposit_limit_krw": 150_000_000,
        "monthly_budget_krw": 600_000,
    }


@pytest.mark.parametrize(
    "expression", ["1억 2억", "5천만 1억", "1억 5천 3백만원", "1조 5천만원", "-1억 5천만원"]
)
def test_unsupported_compound_money_is_one_question_without_residual_budget(expression):
    result = parse(f"보증금 {expression}", {"monthly_budget_krw": 750_000})
    assert result["candidates"] == []
    assert [q["field"] for q in result["questions"]] == ["deposit_limit_krw"]


def test_unsupported_compound_deposit_keeps_independent_rent_candidate():
    result = parse("월세 60 보증금 1억 5천 3백만원")
    assert [(c["field"], c["value"]) for c in result["candidates"]] == [
        ("monthly_budget_krw", 600_000)
    ]
    assert [q["field"] for q in result["questions"]] == ["deposit_limit_krw"]


def test_unchanged_compound_deposit_does_not_leak_a_budget_candidate():
    current = {"deposit_limit_krw": 150_000_000, "monthly_budget_krw": 750_000}
    assert parse("보증금 1억 5천만원", current) == {
        "candidates": [],
        "questions": [],
        "understood": False,
    }


@pytest.mark.parametrize(
    "message, expected",
    [
        ("월세 60 40분", {"monthly_budget_krw": 600_000, "max_one_way_minutes": 40}),
        ("월세 60 2026-11-01", {"monthly_budget_krw": 600_000, "move_in_by": "2026-11-01"}),
        ("보증금 1억 5천 40분", {"deposit_limit_krw": 150_000_000, "max_one_way_minutes": 40}),
        ("보증금 1억 5천 월 20일 출근", {"deposit_limit_krw": 150_000_000, "office_days": 20}),
    ],
)
def test_money_does_not_consume_independent_non_money_numbers(message, expected):
    result = parse(message)
    assert result["questions"] == []
    assert {c["field"]: c["value"] for c in result["candidates"]} == expected
