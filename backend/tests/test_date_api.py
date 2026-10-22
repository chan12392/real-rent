"""R1-09: public condition dates accept calendar-date strings without timestamp coercion."""

import pytest
from fastapi.testclient import TestClient

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


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("REAL_RENT_DATA_DIR", raising=False)
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.mark.parametrize("endpoint", ["/api/compare", "/api/conditions/parse"])
@pytest.mark.parametrize(
    "invalid_date",
    [
        1793491200,
        1793491200.0,
        1793491200000,
        "1793491200",
        "2026-11-01T00:00:00",
        "2026-11-01T00:00:00Z",
        "2026-11-01 00:00:00",
        "2026-1-01",
        "2026-11-1",
        "2026/11/01",
        "20261101",
        "2026-02-30",
        "2026-02-29",
        "0000-01-01",
        True,
        False,
        [],
        {},
    ],
)
def test_move_in_by_requires_a_real_yyyy_mm_dd_string(client, endpoint, invalid_date):
    body = (
        {**BASE, "move_in_by": invalid_date}
        if endpoint == "/api/compare"
        else {"message": "안녕하세요", "current": {"move_in_by": invalid_date}}
    )
    response = client.post(endpoint, json=body)
    assert response.status_code == 422
    assert any(error["loc"][-1] == "move_in_by" for error in response.json()["detail"])


@pytest.mark.parametrize("valid_date", ["2026-11-01", "2028-02-29"])
def test_calendar_date_strings_keep_compare_and_current_behavior(client, valid_date):
    comparison = client.post("/api/compare", json={**BASE, "move_in_by": valid_date})
    assert comparison.status_code == 200
    assert comparison.json()["conditions"]["move_in_by"] == valid_date
    parsed = client.post(
        "/api/conditions/parse",
        json={"message": valid_date, "current": {"move_in_by": valid_date}},
    )
    assert parsed.status_code == 200
    assert parsed.json()["candidates"] == parsed.json()["questions"] == []


def test_optional_current_date_can_still_be_omitted_or_null(client):
    for current in ({}, {"move_in_by": None}):
        response = client.post(
            "/api/conditions/parse", json={"message": "안녕하세요", "current": current}
        )
        assert response.status_code == 200
        assert response.json()["candidates"] == response.json()["questions"] == []


def test_compare_still_requires_a_non_null_date(client):
    assert client.post("/api/compare", json={**BASE, "move_in_by": None}).status_code == 422
