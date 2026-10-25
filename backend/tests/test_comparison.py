import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.db.demo import load_demo_data
from app.domain.comparison import compare_listings
from app.main import create_app
from app.schemas.comparison import CommuteLeg, ComparisonRequest, DemoData

INPUT = {
    "office_id": "seoul-station",
    "move_in_date": "2026-11-01",
    "deposit_limit_krw": 10_000_000,
    "monthly_limit_krw": 800_000,
    "workdays": 20,
    "max_commute_minutes": 60,
    "max_transfers": 2,
    "priority": "cost",
}


@pytest.fixture
def client():
    with TestClient(create_app()) as test_client:
        yield test_client


def test_catalog_explicitly_labels_synthetic_data(client):
    response = client.get("/api/demo/catalog")
    assert response.status_code == 200
    data = response.json()
    assert data["synthetic"] is True
    assert len(data["offices"]) == 2
    assert len(data["listings"]) == 4
    assert "routes" not in data
    assert data["listings"][2]["monthly_management_krw"] is None


def test_real_http_comparison_and_independent_expected_costs(client):
    response = client.post("/api/compare", json=INPUT)
    assert response.status_code == 200
    result = response.json()
    assert result["conditions"] == INPUT
    assert result["synthetic"] is True
    assert [item["listing"]["id"] for item in result["candidates"]] == [
        "demo-d", "demo-a", "demo-b",
    ]
    assert [item["monthly_total_krw"] for item in result["candidates"]] == [
        598_000, 632_000, 712_000,
    ]
    assert result["candidates"][1]["monthly_commute_krw"] == 62_000
    assert result["candidates"][1]["round_trip_minutes"] == 60
    assert result["excluded"] == [{
        "id": "demo-c", "label": "시연 C · 일부 미확인", "reasons": ["관리비 확인 불가"],
    }]


@pytest.mark.parametrize(("changes", "expected_ids"), [
    ({"priority": "time"}, ["demo-b", "demo-a", "demo-d"]),
    ({"monthly_limit_krw": 632_000}, ["demo-d", "demo-a"]),
    ({"monthly_limit_krw": 631_999}, ["demo-d"]),
    ({"monthly_limit_krw": 0}, []),
    ({"deposit_limit_krw": 8_000_000}, ["demo-d", "demo-b"]),
    ({"move_in_date": "2026-10-31"}, ["demo-b"]),
    ({"max_commute_minutes": 34}, ["demo-b"]),
    ({"max_transfers": 0}, ["demo-b"]),
    ({"office_id": "gangnam-station"}, ["demo-a"]),
])
def test_conditions_change_eligibility_and_order(client, changes, expected_ids):
    result = client.post("/api/compare", json=INPUT | changes).json()
    assert [item["listing"]["id"] for item in result["candidates"]] == expected_ids
    assert result["evaluated_count"] == 4


def test_zero_workdays_keeps_commute_filters_but_has_zero_fares(client):
    result = client.post("/api/compare", json=INPUT | {
        "workdays": 0, "max_commute_minutes": 34,
    }).json()
    assert [item["listing"]["id"] for item in result["candidates"]] == ["demo-b"]
    assert result["candidates"][0]["monthly_commute_krw"] == 0
    assert result["candidates"][0]["monthly_total_krw"] == 650_000


@pytest.mark.parametrize("changes", [
    {"workdays": -1}, {"workdays": 32}, {"workdays": 1.5}, {"workdays": True},
    {"workdays": "20"}, {"monthly_limit_krw": -1}, {"deposit_limit_krw": -1},
    {"max_transfers": -1}, {"move_in_date": "2026-02-30"}, {"priority": "unknown"},
    {"office_id": "unavailable-office"}, {"unexpected": "value"},
    {"move_in_date": 1793491200}, {"move_in_date": "1793491200"},
    {"move_in_date": "2026-11-01T00:00:00Z"},
])
def test_invalid_requests_are_rejected(client, changes):
    assert client.post("/api/compare", json=INPUT | changes).status_code == 422


def test_required_conditions_are_not_silently_filled(client):
    assert client.post("/api/compare", json={}).status_code == 422


def test_missing_route_is_not_a_zero_cost_route(client, monkeypatch):
    data = load_demo_data()
    data.routes[0].inbound = None
    monkeypatch.setattr("app.api.comparison.load_demo_data", lambda: data)
    result = client.post("/api/compare", json=INPUT).json()
    assert "demo-a" not in [item["listing"]["id"] for item in result["candidates"]]
    excluded = next(item for item in result["excluded"] if item["id"] == "demo-a")
    assert "왕복 경로 확인 불가" in excluded["reasons"]


@pytest.mark.parametrize("priority", ["cost", "time"])
def test_final_ties_use_id_and_limit_results_without_losing_matched_count(priority):
    data = load_demo_data()
    for listing in data.listings:
        listing.monthly_rent_krw = 500_000
        listing.monthly_management_krw = 50_000
    for route in data.routes:
        route.outbound = CommuteLeg(minutes=30, fare_krw=1500, transfers=0, walk_minutes=5)
        route.inbound = route.outbound.model_copy()
    data.listings.reverse()
    result = compare_listings(ComparisonRequest(**(INPUT | {"priority": priority})), data)
    assert [item.listing.id for item in result.candidates] == ["demo-a", "demo-b", "demo-c"]
    assert result.matched_count == 4
    assert result.excluded == []


@pytest.mark.parametrize("broken", ["missing", "invalid_json", "invalid_schema"])
def test_broken_demo_data_returns_safe_retryable_error(client, monkeypatch, tmp_path, broken):
    path = tmp_path / "demo.json"
    if broken == "invalid_json":
        path.write_text("{", encoding="utf-8")
    elif broken == "invalid_schema":
        path.write_text('{"synthetic": false}', encoding="utf-8")
    monkeypatch.setattr("app.db.demo.DEMO_PATH", path)
    for response in (client.get("/api/demo/catalog"), client.post("/api/compare", json=INPUT)):
        assert response.status_code == 503
        assert response.json() == {"detail": "시연 데이터를 읽을 수 없습니다."}


def test_duplicate_demo_identifiers_are_rejected():
    data = load_demo_data().model_dump(mode="json")
    data["listings"][1]["id"] = data["listings"][0]["id"]
    with pytest.raises(ValidationError, match="중복"):
        DemoData.model_validate(data)
