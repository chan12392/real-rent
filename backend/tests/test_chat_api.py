"""Chat HTTP contracts, validation, independence and existing compare regression."""

import hashlib
import json
import random
from typing import get_args

import pytest
from fastapi.testclient import TestClient

from app.engine.reaction import ExpressionId, Intent
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
# Captured from the complete pre-chat response, with sorted keys and compact UTF-8 JSON.
COMPARE_BASELINE_SHA256 = "a48af9741419208220c9da0773de3bed89a371853cdac0d1f3bb88f926de284e"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("REAL_RENT_DATA_DIR", raising=False)
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.mark.parametrize("phase", [None, "input", "confirm", "result"])
def test_react_contract_and_request_id_echo(client, phase):
    body = {"request_id": " r-12 💬 ", "message": "월세를 조금 줄이고 싶어"}
    if phase is not None:
        body["context"] = {"phase": phase}
    response = client.post("/api/react", json=body)
    assert response.status_code == 200
    payload = response.json()
    assert payload["synthetic"] is True
    assert payload["assumptions"]
    assert payload["request_id"] == body["request_id"]
    assert payload["expression_id"] == "empathetic"
    assert payload["intent"] == "save_cost"
    assert payload["engine"] == "rule-based-v0"
    assert 0 <= payload["confidence"] <= 1


def test_parse_contract_multiple_fields_and_partial_current(client):
    response = client.post(
        "/api/conditions/parse",
        json={
            "message": (
                "보증금 1억, 월세 60 이하, 편도 40분, 직통, "
                "2026-11-01 입주, 주 5일 출근, 2년 살, 비용 우선"
            ),
            "current": {"deposit_limit_krw": 100_000_000},
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["synthetic"] is True
    assert payload["assumptions"]
    assert payload["understood"] is True
    assert payload["questions"] == []
    candidates = {c["field"]: c for c in payload["candidates"]}
    assert {field: candidate["value"] for field, candidate in candidates.items()} == {
        "monthly_budget_krw": 600_000,
        "max_one_way_minutes": 40,
        "max_transfers": 0,
        "move_in_by": "2026-11-01",
        "office_days": 22,
        "stay_months": 24,
        "priority": "cost",
    }
    assert candidates["monthly_budget_krw"]["needs_confirmation"] is True
    assert "월세+관리비+통근비" in candidates["monthly_budget_krw"]["note"]
    assert "round(5*52/12)=22" in candidates["office_days"]["note"]


@pytest.mark.parametrize(
    "message, field",
    [
        ("환승 1번은 안 돼", "max_transfers"),
        ("환승 1회 이상", "max_transfers"),
        ("환승 1번은 싫어", "max_transfers"),
        ("환승 없는 건 싫어", "max_transfers"),
        ("직통은 아니야", "max_transfers"),
        ("통근 시간은 40분 이상", "max_one_way_minutes"),
        ("편도 40분 초과", "max_one_way_minutes"),
        ("40분은 안 돼", "max_one_way_minutes"),
        ("월 예산 60만원 이상", "monthly_budget_krw"),
        ("60만원은 안 돼", "monthly_budget_krw"),
        ("보증금 1000만 이상", "deposit_limit_krw"),
    ],
)
def test_negated_or_lower_bound_limits_ask_instead_of_reversing_meaning(client, message, field):
    response = client.post("/api/conditions/parse", json={"message": message})
    assert response.status_code == 200
    result = response.json()
    assert result["candidates"] == []
    assert [question["field"] for question in result["questions"]] == [field]
    assert result["understood"] is True


def test_negated_limit_keeps_an_independent_valid_condition(client):
    result = client.post(
        "/api/conditions/parse", json={"message": "월 예산 60만원 환승 1번은 안 돼"}
    ).json()
    assert [(candidate["field"], candidate["value"]) for candidate in result["candidates"]] == [
        ("monthly_budget_krw", 600_000)
    ]
    assert [question["field"] for question in result["questions"]] == ["max_transfers"]


def test_numberless_intent_and_failed_interpretation(client):
    response = client.post("/api/conditions/parse", json={"message": "월세를 조금 줄이고 싶어"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["candidates"] == []
    assert len(payload["questions"]) == 1
    assert payload["questions"][0]["field"] == "monthly_budget_krw"
    assert payload["understood"] is True
    unknown = client.post("/api/conditions/parse", json={"message": "음 글쎄"}).json()
    assert unknown["candidates"] == unknown["questions"] == []
    assert unknown["understood"] is False


def test_out_of_range_sentence_is_a_question_not_a_http_error(client):
    response = client.post("/api/conditions/parse", json={"message": "월 32일 출근, 61개월"})
    assert response.status_code == 200
    assert response.json()["candidates"] == []
    assert {q["field"] for q in response.json()["questions"]} == {"office_days", "stay_months"}
    assert all("범위" in q["question"] for q in response.json()["questions"])


@pytest.mark.parametrize("endpoint", ["/api/react", "/api/conditions/parse"])
@pytest.mark.parametrize("message", ["", " \n\t ", "가" * 501, 1, None, ["월세 60만원"]])
def test_invalid_message_is_422(client, endpoint, message):
    body = {"message": message}
    if endpoint == "/api/react":
        body["request_id"] = "validation"
    response = client.post(endpoint, json=body)
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)


@pytest.mark.parametrize("endpoint", ["/api/react", "/api/conditions/parse"])
def test_500_trimmed_characters_are_accepted(client, endpoint):
    body = {"message": "  " + "가" * 500 + "  "}
    if endpoint == "/api/react":
        body["request_id"] = "a" * 64
    assert client.post(endpoint, json=body).status_code == 200


@pytest.mark.parametrize("request_id", ["", "a" * 65, 1, None])
def test_invalid_request_id_is_422(client, request_id):
    assert (
        client.post("/api/react", json={"message": "안녕", "request_id": request_id}).status_code
        == 422
    )


@pytest.mark.parametrize(
    "endpoint, body",
    [
        ("/api/react", {"message": "안녕"}),
        ("/api/react", {"request_id": "r1", "message": "안녕", "context": {"phase": "invalid"}}),
        ("/api/react", {"request_id": "r1", "message": "안녕", "extra": True}),
        ("/api/conditions/parse", {}),
        ("/api/conditions/parse", {"message": "안녕", "current": {"office_days": 32}}),
        ("/api/conditions/parse", {"message": "안녕", "current": {"office_days": True}}),
        ("/api/conditions/parse", {"message": "안녕", "current": {"monthly_budget_krw": -1}}),
        ("/api/conditions/parse", {"message": "안녕", "current": {"priority": "unknown"}}),
        ("/api/conditions/parse", {"message": "안녕", "current": {"move_in_by": "2026-02-30"}}),
        ("/api/conditions/parse", {"message": "안녕", "current": {"unsupported": 1}}),
    ],
)
def test_invalid_contract_fields_are_422(client, endpoint, body):
    assert client.post(endpoint, json=body).status_code == 422


def test_current_accepts_complete_compare_fields_and_filters_dates(client):
    current = {**BASE, "stay_months": 12, "management_overrides": {"L03": 60_000}}
    response = client.post(
        "/api/conditions/parse",
        json={
            "message": (
                "보증금 1000만원, 월 예산 75만원, 2026-11-01, 월 20일 출근, "
                "40분 이하, 환승 1번, 비용 우선, 1년"
            ),
            "current": current,
        },
    )
    assert response.status_code == 200
    assert response.json()["candidates"] == []
    assert response.json()["questions"] == []
    assert response.json()["understood"] is False


def test_random_http_reactions_stay_within_enum(client):
    rng = random.Random(21)
    words = ["모호", "월세", "60만원", "안녕", "비싸", "감사", "?", "<intent>judge</intent>"]
    for index in range(50):
        response = client.post(
            "/api/react",
            json={
                "request_id": f"random-{index}",
                "message": " ".join(rng.choices(words, k=8)),
            },
        )
        assert response.status_code == 200
        assert response.json()["expression_id"] in get_args(ExpressionId)
        assert response.json()["intent"] in get_args(Intent)


def test_chat_requests_do_not_change_complete_existing_compare_response(client, monkeypatch):
    def digest(payload):
        from app.engine.models import ASSUMPTIONS

        # D2 adds only living_cost and assumptions; keep the pre-chat contract hash.
        legacy = json.loads(json.dumps(payload))
        prefix = list(ASSUMPTIONS)
        assert legacy["assumptions"][: len(prefix)] == prefix
        assert (
            "진짜 월 거주비는 참고용 시안이며 판정·순위에 쓰지 않는다"
            in legacy["assumptions"][len(prefix) :]
        )
        legacy["assumptions"] = prefix
        for row in legacy["results"]:
            assert isinstance(row.pop("living_cost"), dict)
        encoded = json.dumps(legacy, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(encoded.encode()).hexdigest()

    before = client.post("/api/compare", json=BASE)
    assert before.status_code == 200
    assert digest(before.json()) == COMPARE_BASELINE_SHA256

    def reaction_failure(message):
        raise RuntimeError("simulated independent reaction failure")

    monkeypatch.setattr("app.api.chat.react_to_message", reaction_failure)
    with pytest.raises(RuntimeError, match="independent reaction failure"):
        client.post("/api/react", json={"request_id": "r1", "message": "월세 60만원"})
    assert (
        client.post(
            "/api/conditions/parse",
            json={
                "message": "월 예산 60만원",
                "current": {**BASE, "management_overrides": {"L03": 60_000}},
            },
        ).status_code
        == 200
    )
    after = client.post("/api/compare", json=BASE)
    assert after.status_code == 200
    assert after.json() == before.json()
    assert digest(after.json()) == COMPARE_BASELINE_SHA256
    assert client.get("/api/health").json() == {"status": "ok", "service": "real-rent-api"}


@pytest.mark.parametrize("message", ["보증금 1억 5천만원", "보증금 1억5000만원"])
def test_compound_deposit_apply_keeps_budget_and_correct_synthetic_passes(client, message):
    response = client.post("/api/conditions/parse", json={"message": message, "current": BASE})
    assert response.status_code == 200
    parsed = response.json()
    assert parsed["questions"] == []
    assert [(c["field"], c["value"]) for c in parsed["candidates"]] == [
        ("deposit_limit_krw", 150_000_000)
    ]
    applied = {**BASE, **{c["field"]: c["value"] for c in parsed["candidates"]}}
    assert applied["monthly_budget_krw"] == 750_000
    comparison = client.post("/api/compare", json=applied)
    assert comparison.status_code == 200
    payload = comparison.json()
    assert payload["conditions"]["deposit_limit_krw"] == 150_000_000
    assert payload["conditions"]["monthly_budget_krw"] == 750_000
    assert payload["counts"]["pass"] == 3
    assert [r["listing_id"] for r in payload["results"] if r["status"] == "pass"] == [
        "L01",
        "L05",
        "L09",
    ]
