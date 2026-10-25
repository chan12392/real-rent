import json

import pytest
from fastapi.testclient import TestClient

from app.api.explore import DATA
from app.main import create_app

CONDITIONS = {
    "deposit": 30_000_000, "budget": 1_100_000, "office": "강남역",
    "minutes": 90, "move_in": "2026-12-01", "transfers": 3,
    "workdays": 20, "priority": "cost",
}


@pytest.fixture
def client():
    with TestClient(create_app()) as instance:
        yield instance


def turn(client, conditions=CONDITIONS, **kwargs):
    response = client.post("/api/explore", json={"conditions": conditions, **kwargs})
    assert response.status_code == 200, response.text
    return response.json()


def test_complete_conditions_do_not_run_comparison_before_confirmation(client, monkeypatch):
    def unexpected(*args):
        pytest.fail("확인 전 비교/근거 검색이 실행됐습니다.")

    monkeypatch.setattr("app.engine.explore.evaluate_home", unexpected)
    monkeypatch.setattr("app.engine.explore.load_evidence", unexpected)
    result = turn(client)
    assert result["stage"] == "awaiting_confirmation"
    assert result["recommended_ids"] == []
    assert result["confirmed_conditions"] is None
    assert all(home["status"] == "idle" and home["total"] is None for home in result["homes"])
    assert all("routes" not in home for home in result["homes"])


@pytest.mark.parametrize(("priority", "ids"), [
    ("cost", ["home-07", "home-05", "home-01"]),
    ("time", ["home-08", "home-11", "home-10"]),
])
def test_confirmed_comparison_ranks_and_explains_code_values(client, priority, ids):
    conditions = CONDITIONS | {"priority": priority}
    result = turn(client, conditions, confirmed_conditions=conditions)
    assert result["stage"] == "ready"
    assert result["recommended_ids"] == ids
    assert sum(home["recommended"] for home in result["homes"]) == 3
    home = next(home for home in result["homes"] if home["id"] == "home-01")
    assert home["total"] == 592_000  # 480,000 + 50,000 + (1,550 + 1,550) * 20
    assert home["round_trip_minutes"] == 101
    assert any("592,000원" in reason for reason in home["reasons"])
    assert home["evidence_status"] == "found"
    assert {doc["listing_id"] for doc in home["evidence"]} == {"home-01"}
    assert "인터넷, 공용 청소" in home["evidence"][0]["quote"]


def test_change_keeps_other_conditions_and_revokes_previous_confirmation(client):
    first = turn(client, confirmed_conditions=CONDITIONS)
    result = turn(client, first["conditions"], confirmed_conditions=first["confirmed_conditions"],
                  message="예산만 70만 원으로 바꿔줘")
    assert result["conditions"] == first["conditions"] | {"budget": 700_000}
    assert result["confirmed_conditions"] is None
    assert result["stage"] == "awaiting_confirmation"
    assert result["recommended_ids"] == []
    confirmed = turn(client, result["conditions"], message="네")
    assert confirmed["stage"] == "ready"
    assert all(home["total"] <= 700_000 for home in confirmed["homes"] if home["recommended"])


def test_form_change_and_office_change_require_fresh_confirmation(client):
    changed = CONDITIONS | {"office": "서울역"}
    result = turn(client, changed, confirmed_conditions=CONDITIONS)
    assert result["stage"] == "awaiting_confirmation"
    confirmed = turn(client, changed, confirmed_conditions=changed)
    home = next(home for home in confirmed["homes"] if home["id"] == "home-01")
    assert home["round_trip_minutes"] == 59
    assert confirmed["conditions"]["office"] == "서울역"


def test_ambiguous_proposal_is_not_also_a_recommendation_confirmation(client):
    result = turn(client, confirmed_conditions=CONDITIONS, message="월 80")
    assert result["stage"] == "clarifying"
    assert result["recommended_ids"] == []
    applied = turn(client, result["conditions"], message="네",
                   pending_conditions=result["pending_conditions"])
    assert applied["conditions"]["budget"] == 800_000
    assert applied["stage"] == "awaiting_confirmation"
    assert applied["confirmed_conditions"] is None


@pytest.mark.parametrize("field", CONDITIONS)
def test_missing_required_condition_is_never_filled_or_confirmed(client, field):
    conditions = CONDITIONS | {field: None}
    result = turn(client, conditions, confirmed_conditions=conditions)
    assert result["stage"] == "collecting"
    assert result["conditions"][field] is None
    assert result["recommended_ids"] == []


@pytest.mark.parametrize("value", [-1, 32, 20.5, True, "20"])
def test_workdays_input_boundary_rejects_invalid_types_and_range(client, value):
    assert client.post("/api/explore", json={
        "conditions": CONDITIONS | {"workdays": value},
    }).status_code == 422


@pytest.mark.parametrize("text", ["출근 월 -1일", "출근 월 32일", "출근 월 20.5일"])
def test_invalid_chat_workdays_preserve_state_and_ask_only_for_days(client, text):
    result = turn(client, confirmed_conditions=CONDITIONS, message=text)
    assert result["conditions"]["workdays"] == 20
    assert result["stage"] == "clarifying"
    assert "0~31" in result["reply"]
    assert result["recommended_ids"] == []


@pytest.mark.parametrize("days", [0, 31])
def test_valid_workday_boundaries(client, days):
    result = turn(client, message=f"출근 월 {days}일")
    assert result["conditions"]["workdays"] == days
    confirmed = turn(client, result["conditions"], confirmed_conditions=result["conditions"])
    home = next(home for home in confirmed["homes"] if home["id"] == "home-01")
    assert home["commute"] == 3100 * days


@pytest.mark.parametrize(("field", "message", "value", "question"), [
    ("workdays", "0일", 0, "며칠"),
    ("workdays", "20일", 20, "며칠"),
    ("workdays", "31일", 31, "며칠"),
    ("transfers", "0회", 0, "환승"),
    ("transfers", "1회", 1, "환승"),
    ("transfers", "10번", 10, "환승"),
])
def test_unit_answer_applies_only_to_the_current_question(client, field, message, value, question):
    first = turn(client, CONDITIONS | {field: None})
    assert first["stage"] == "collecting"
    assert question in first["reply"]
    result = turn(client, first["conditions"], message=message)
    assert result["conditions"] == first["conditions"] | {field: value}
    assert result["stage"] == "awaiting_confirmation"
    assert result["confirmed_conditions"] is None


@pytest.mark.parametrize(("field", "message"), [
    ("workdays", "-1일"), ("workdays", "32일"), ("workdays", "20.5일"),
    ("workdays", "20"), ("workdays", "20~21일"), ("workdays", "20일 1회"),
    ("transfers", "-1회"), ("transfers", "11회"), ("transfers", "1.5회"),
    ("transfers", "1"), ("transfers", "1~2회"), ("transfers", "1회 이상"),
])
def test_invalid_or_ambiguous_unit_answers_preserve_conditions(client, field, message):
    first = turn(client, CONDITIONS | {field: None})
    result = turn(client, first["conditions"], message=message)
    assert result["conditions"] == first["conditions"]
    assert result["stage"] == "clarifying"
    assert result["recommended_ids"] == []


@pytest.mark.parametrize(("changes", "message"), [
    ({}, "20일"), ({}, "1회"),
    ({"deposit": None, "workdays": None}, "20일"),
    ({"budget": None, "transfers": None}, "1회"),
    ({"office": None, "workdays": None, "ignored": ["office"]}, "20일"),
    ({"workdays": None, "transfers": None}, "1회"),
    ({"transfers": None, "priority": None, "ignored": ["transfers"]}, "1회"),
    ({"move_in": None, "workdays": None}, "20일"),
])
def test_unit_answers_do_not_fill_other_missing_or_already_set_conditions(client, changes, message):
    first = turn(client, CONDITIONS | changes)
    result = turn(client, first["conditions"], message=message)
    assert result["conditions"] == first["conditions"]


@pytest.mark.parametrize(("field", "message"), [("workdays", "20일"), ("transfers", "1회")])
def test_unit_answers_do_not_bypass_a_pending_confirmation(client, field, message):
    conditions = CONDITIONS | {field: None}
    first = turn(client, conditions, message="월 80")
    assert first["pending_conditions"] is not None
    result = turn(client, first["conditions"], message=message,
                  pending_conditions=first["pending_conditions"])
    assert result["conditions"] == first["conditions"]
    assert result["recommended_ids"] == []


def test_priority_can_change_in_conversation_without_default_or_conflicting_guess(client):
    result = turn(client, message="시간 우선")
    assert result["conditions"]["priority"] == "time"
    assert result["stage"] == "awaiting_confirmation"
    result = turn(client, message="비용 우선 또는 시간 우선")
    assert result["stage"] == "clarifying"
    assert result["conditions"]["priority"] == "cost"


def test_missing_reference_file_does_not_discard_comparison(client, monkeypatch, tmp_path):
    monkeypatch.setattr("app.engine.evidence.REFERENCES", tmp_path / "missing.json")
    result = turn(client, confirmed_conditions=CONDITIONS)
    assert result["recommended_ids"] == ["home-07", "home-05", "home-01"]
    assert all(home["evidence_status"] == "unavailable" for home in result["homes"])
    assert all(home["evidence"] == [] for home in result["homes"])


def test_no_candidates_distinguishes_failure_unknown_and_mismatch(client, monkeypatch, tmp_path):
    data = json.loads(DATA.read_text(encoding="utf-8"))
    data["homes"][0]["routes"]["강남역"] = None
    data["homes"][0]["route_errors"] = {"강남역": "timeout"}
    path = tmp_path / "demo.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setattr("app.api.explore.DATA", path)
    conditions = CONDITIONS | {"budget": 0}
    result = turn(client, conditions, confirmed_conditions=conditions)
    assert result["recommended_ids"] == []
    assert result["exclusion_summary"] == {
        "conditions": 9, "route_failed": 1, "route_unknown": 1, "management_unknown": 1,
    }
    assert "어떤 조건" in result["reply"]
    assert result["conditions"]["budget"] == 0


def test_confirmed_conditions_can_be_restored_without_sharing_server_state(client):
    first = turn(client, confirmed_conditions=CONDITIONS)
    fresh = turn(client, {})
    assert fresh["confirmed_conditions"] is None
    restored = turn(client, first["conditions"], confirmed_conditions=first["confirmed_conditions"])
    assert restored["recommended_ids"] == first["recommended_ids"]


@pytest.mark.parametrize("message", [
    "환승 1번은 안 돼", "통근 시간은 40분 이상", "통근 -10분", "환승 1.5회",
    "출근 주 5일", "직장은 강남역 또는 서울역", "회사 주소는 마곡역 근처",
    "월 예산 80만 원 이상", "보증금 3천만 원은 아니야", "예산 -50만원",
    "오피스텔은 싫어요", "원룸 말고 빌라",
    "보증금 500만~1000만 원", "월 예산 50만 원부터 80만 원",
    "월 예산 50-80만 원", "보증금 500만 원에서 1000만 원",
])
def test_ambiguous_or_unsupported_conditions_are_not_reinterpreted(client, message):
    result = turn(client, confirmed_conditions=CONDITIONS, message=message)
    assert result["stage"] == "clarifying"
    assert result["recommended_ids"] == []
    assert all(result["conditions"][key] == value for key, value in CONDITIONS.items())
    assert result["conditions"]["kind"] is None


@pytest.mark.parametrize("broken", ["duplicate", "negative_fare", "missing_field", "not_synthetic"])
def test_bad_listing_data_returns_retryable_error_before_graph(
    client, monkeypatch, tmp_path, broken,
):
    data = json.loads(DATA.read_text(encoding="utf-8"))
    if broken == "duplicate":
        data["homes"][1]["id"] = data["homes"][0]["id"]
    elif broken == "negative_fare":
        data["homes"][0]["routes"]["강남역"]["outbound"]["fare"] = -1
    elif broken == "missing_field":
        data["homes"][0].pop("rent")
    else:
        data["synthetic"] = False
    path = tmp_path / "invalid.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setattr("app.api.explore.DATA", path)
    assert client.post("/api/explore", json={}).status_code == 503


def test_one_missing_direction_is_unknown_not_a_zero_fare(client, monkeypatch, tmp_path):
    data = json.loads(DATA.read_text(encoding="utf-8"))
    data["homes"][0]["routes"]["강남역"]["inbound"] = None
    path = tmp_path / "partial-route.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setattr("app.api.explore.DATA", path)
    result = turn(client, confirmed_conditions=CONDITIONS)
    home = next(home for home in result["homes"] if home["id"] == "home-01")
    assert home["total"] is None
    assert home["route"] is None
    assert home["recommended"] is False


def test_company_cannot_be_waived_before_recommendation(client):
    conditions = CONDITIONS | {"office": None, "ignored": ["office"]}
    result = turn(client, conditions, confirmed_conditions=conditions)
    assert result["stage"] == "collecting"
    assert "직장" in result["reply"]
    assert result["recommended_ids"] == []
    assert all(home["total"] is None for home in result["homes"])
