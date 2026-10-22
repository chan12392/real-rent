"""Public API contracts, fixture-based RAG grading and invalid-input behavior."""

import csv
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.engine.data import load_listings
from app.engine.documents import generate_documents
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
KEY_PATH = Path(__file__).resolve().parents[2] / "evaluation" / "rag_answer_key.csv"
with KEY_PATH.open(encoding="utf-8-sig", newline="") as stream:
    ANSWER_KEY = list(csv.DictReader(stream))


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("REAL_RENT_DATA_DIR", raising=False)
    with TestClient(create_app()) as test_client:
        yield test_client


def test_listings_contract_keeps_unknown_values_null(client):
    response = client.get("/api/listings")
    assert response.status_code == 200
    payload = response.json()
    assert payload["synthetic"] is True
    assert payload["assumptions"]
    assert payload["price_basis"] == "가정값(실거래 미조회)"
    rows = payload["listings"]
    assert [row["listing_id"] for row in rows] == [f"L{index:02}" for index in range(1, 13)]
    assert rows[0] == {
        "listing_id": "L01",
        "label": "시연 매물 01",
        "gu": "관악구",
        "dong": "신림동",
        "deposit_krw": 10_000_000,
        "monthly_rent_krw": 500_000,
        "monthly_management_krw": 70_000,
        "management_includes": ["수도", "인터넷"],
        "move_in_available": "2026-11-01",
        "lat": 37.4842,
        "lng": 126.9295,
        "outbound": {"minutes": 38, "fare_krw": 1550, "transfers": 1, "walk_minutes": 10},
        "return": {"minutes": 40, "fare_krw": 1550, "transfers": 1, "walk_minutes": 10},
    }
    assert rows[2]["monthly_management_krw"] is None
    assert rows[2]["management_includes"] == []
    assert rows[-1]["return"] is None


def test_compare_base_conditions_and_hand_calculated_costs(client):
    response = client.post("/api/compare", json=BASE)
    assert response.status_code == 200
    payload = response.json()
    assert payload["synthetic"] is True
    assert payload["assumptions"]
    assert payload["conditions"] == {**BASE, "stay_months": 12, "management_overrides": {}}
    assert payload["counts"] == {"pass": 2, "fail": 8, "unknown": 1, "route_failed": 1}
    assert payload["recommended"] == ["L01", "L05"]
    rows = payload["results"]
    assert [row["listing_id"] for row in rows] == [f"L{index:02}" for index in range(1, 13)]
    assert rows[0]["cost"] == {
        "deposit_krw": 10_000_000,
        "monthly_rent_krw": 500_000,
        "monthly_management_krw": 70_000,
        "monthly_commute_krw": 62_000,
        "monthly_total_krw": 632_000,
        "initial_cash_krw": 10_500_000,
        "stay_total_krw": 7_584_000,
    }
    assert rows[0]["commute"]["round_trip_minutes"] == 78
    assert rows[0]["scores"] == {"cost": 72, "time": 15, "convenience": 20, "livability": None}
    assert rows[0]["primary_reason"] is None
    assert rows[0]["reasons"] == []
    assert rows[0]["rank"] == 1
    assert rows[4]["rank"] == 2
    assert all(row["rank"] is None for row in rows if row["status"] != "pass")
    assert rows[2]["cost"]["monthly_total_krw"] is None
    assert rows[-1]["cost"]["monthly_commute_krw"] is None


def test_management_override_recalculates_l03_without_persisting(client):
    response = client.post("/api/compare", json={**BASE, "management_overrides": {"L03": 60_000}})
    assert response.status_code == 200
    payload = response.json()
    rows = {row["listing_id"]: row for row in payload["results"]}
    assert rows["L03"]["status"] == "pass"
    assert rows["L03"]["management_overridden"] is True
    assert rows["L03"]["cost"]["monthly_total_krw"] == 602_000  # 480k + 60k + 62k
    assert payload["counts"] == {"pass": 3, "fail": 8, "unknown": 0, "route_failed": 1}
    assert payload["recommended"] == ["L03", "L01", "L05"]
    assert client.get("/api/listings").json()["listings"][2]["monthly_management_krw"] is None
    assert client.post("/api/compare", json=BASE).json()["results"][2]["status"] == "unknown"


def test_time_priority_and_zero_days_via_api(client):
    time_response = client.post("/api/compare", json={**BASE, "priority": "time"})
    assert time_response.status_code == 200
    assert time_response.json()["recommended"] == ["L05", "L01"]
    zero_response = client.post(
        "/api/compare",
        json={
            **BASE,
            "office_days": 0,
            "max_one_way_minutes": 1,
            "max_transfers": 0,
            "stay_months": 1,
        },
    )
    assert zero_response.status_code == 200
    rows = zero_response.json()["results"]
    assert rows[0]["status"] == "pass"
    assert rows[0]["cost"]["monthly_commute_krw"] == 0
    assert rows[0]["cost"]["stay_total_krw"] == 570_000
    assert rows[-1]["status"] == "route_failed"


@pytest.mark.parametrize("row", ANSWER_KEY, ids=lambda row: row["qid"])
def test_rag_answer_key_all_13_questions(client, row):
    response = client.post("/api/ask", json={"question": row["question"], "listing_id": None})
    assert response.status_code == 200
    payload = response.json()
    assert payload["synthetic"] is True
    assert payload["assumptions"]
    for required in filter(None, row["must_include"].split("|")):
        assert required in payload["answer"]
    for forbidden in filter(None, row["must_not_include"].split("|")):
        assert forbidden not in payload["answer"]
    expected_docs = set(row["expected_doc"].split("|"))
    assert {citation["doc_id"] for citation in payload["citations"]} == expected_docs
    documents = generate_documents(load_listings())
    for citation in payload["citations"]:
        assert citation["quote"] in documents[citation["doc_id"]]
    if row["qid"] == "Q13":
        assert payload["status"] == "clarify"
        assert payload["candidates"] == ["L08", "L09"]
    else:
        assert payload["status"] == ("unknown" if row["qid"] in ("Q03", "Q05") else "answered")
        assert payload["candidates"] == []


@pytest.mark.parametrize(
    "question, expected_candidates",
    [
        ("문래동 집 관리비 얼마야?", ["L11", "L12"]),
        ("신림동 관리비 얼마야?", ["L01", "L02"]),
        ("봉천동 관리비 얼마야?", ["L03", "L04"]),
        ("L01과 L05 관리비 얼마야?", ["L01", "L05"]),
    ],
)
def test_same_dong_and_multiple_explicit_ids_require_clarification(
    client, question, expected_candidates
):
    response = client.post("/api/ask", json={"question": question})
    assert response.status_code == 200
    assert response.json()["status"] == "clarify"
    assert response.json()["candidates"] == expected_candidates


def test_selected_listing_context_and_korean_id_particles(client):
    context = client.post("/api/ask", json={"question": "관리비 얼마야?", "listing_id": "L08"})
    assert context.status_code == 200
    assert context.json()["status"] == "answered"
    assert "70,000" in context.json()["answer"]
    assert {citation["doc_id"] for citation in context.json()["citations"]} == {"L08"}
    explicit = client.post("/api/ask", json={"question": "l09의 관리비는?", "listing_id": "L08"})
    assert explicit.status_code == 200
    assert {citation["doc_id"] for citation in explicit.json()["citations"]} == {"L09"}


@pytest.mark.parametrize(
    "question", ["내일 날씨 알려줘", "L99 관리비 얼마야?", "L01 주식 추천해 줘"]
)
def test_out_of_scope_does_not_invent_evidence(client, question):
    response = client.post("/api/ask", json={"question": question})
    assert response.status_code == 200
    assert response.json()["status"] == "out_of_scope"
    assert response.json()["citations"] == []
    assert response.json()["candidates"] == []


@pytest.mark.parametrize(
    "field, value",
    [
        ("deposit_limit_krw", -1),
        ("monthly_budget_krw", -1),
        ("monthly_budget_krw", 1.5),
        ("monthly_budget_krw", True),
        ("office_days", -1),
        ("office_days", 32),
        ("office_days", 1.5),
        ("office_days", "20"),
        ("max_one_way_minutes", 0),
        ("max_transfers", -1),
        ("stay_months", 0),
        ("stay_months", 61),
        ("move_in_by", "2026-02-30"),
        ("priority", "livability"),
        ("management_overrides", {"L03": -1}),
        ("management_overrides", {"L03": None}),
        ("management_overrides", {"L03": 1.5}),
        ("management_overrides", {"L03": True}),
        ("management_overrides", {"L99": 0}),
        ("management_overrides", {"not-an-id": 0}),
    ],
)
def test_compare_invalid_input_returns_422(client, field, value):
    response = client.post("/api/compare", json={**BASE, field: value})
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)


@pytest.mark.parametrize(
    "body",
    [{}, {"question": "   "}, {"question": 1}, {"question": "관리비?", "listing_id": "not-an-id"}],
)
def test_ask_invalid_input_returns_422(client, body):
    response = client.post("/api/ask", json=body)
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)


def test_compare_missing_required_fields_returns_422(client):
    response = client.post("/api/compare", json={})
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)
