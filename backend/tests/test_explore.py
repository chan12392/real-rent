from fastapi.testclient import TestClient

from app.engine.explore import amount, conversation_graph
from app.main import create_app

client = TestClient(create_app())


def request(conditions=None, message=""):
    response = client.post(
        "/api/explore", json={"conditions": conditions or {}, "message": message}
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_initial_map_has_twelve_unrated_homes():
    data = request()
    assert data["synthetic"] is True
    assert len(data["homes"]) == 12
    assert {home["status"] for home in data["homes"]} == {"idle"}
    assert data["partial"] is True
    assert data["conditions"]["workdays"] == 20


def test_korean_money_and_context_preserving_turns():
    assert amount("천만") == 10_000_000
    assert amount("1억 5천만") == 150_000_000
    data = request(message="보증금 천만 원, 월 80만 원, 강남역까지 40분, 가능하면 원룸")
    c = data["conditions"]
    assert c["deposit"] == 10_000_000
    assert c["budget"] == 800_000
    assert c["office"] == "강남역"
    assert c["minutes"] == 40
    assert c["modes"]["kind"] == "preferred"
    data = request(c, "환승 없이 가고 싶어요")
    assert data["conditions"]["transfers"] == 0
    assert data["conditions"]["budget"] == 800_000
    assert "입주" in data["reply"]


def test_modes_and_unknown_are_not_zero():
    c = {"office": "강남역", "budget": 100_000, "modes": {"budget": "required"}}
    homes = {h["id"]: h for h in request(c)["homes"]}
    assert homes["home-01"]["status"] == "bad"
    assert homes["home-03"]["status"] == "unknown"
    assert homes["home-03"]["total"] is None
    assert homes["home-12"]["commute"] is None
    c["modes"]["budget"] = "preferred"
    homes = {h["id"]: h for h in request(c)["homes"]}
    assert homes["home-01"]["status"] == "so-so"


def test_selection_can_be_re_evaluated_and_zero_days_still_checks_route():
    c = {"office": "강남역", "budget": 1_000_000, "workdays": 0}
    homes = {h["id"]: h for h in request(c)["homes"]}
    assert homes["home-01"]["commute"] == 0
    assert homes["home-01"]["total"] == 530_000
    assert homes["home-12"]["total"] is None
    c["budget"] = 100_000
    assert {h["id"]: h for h in request(c)["homes"]}["home-01"]["status"] == "bad"


def test_graph_does_not_overwrite_valid_conditions_on_invalid_input():
    state = conversation_graph.invoke(
        {"message": "출근 월 99일", "conditions": {"workdays": 20}, "reply": ""}
    )
    assert state["conditions"]["workdays"] == 20
    assert "0~31" in state["reply"]
    data = request(message="입주일 2026-02-31")
    assert data["conditions"]["move_in"] is None
    assert "연도" in data["reply"]


def test_request_validation_and_cost_order():
    assert client.post("/api/explore", json={"conditions": {"budget": True}}).status_code == 422
    homes = request({"office": "서울역"})["homes"]
    costs = [h["total"] for h in homes if h["total"] is not None]
    assert costs == sorted(costs)


def test_missing_office_cannot_produce_confirmed_budget_match():
    data = request({"budget": 800_000})
    assert all(h["status"] == "unknown" for h in data["homes"])
    assert all(h["total"] is None for h in data["homes"])


def test_bare_amount_answers_missing_question_without_unit_guess():
    data = request(message="천만 원")
    assert data["conditions"]["deposit"] == 10_000_000
    data = request(data["conditions"], "80만원")
    assert data["conditions"]["budget"] == 800_000
    assert "직장" in data["reply"]
    data = request(message="1000")
    assert data["conditions"]["deposit"] is None


def test_explicit_required_and_preferred_in_same_message():
    data = request(message="월 80만 원은 꼭 지키고 가능하면 원룸")
    assert data["conditions"]["modes"]["budget"] == "required"
    assert data["conditions"]["modes"]["kind"] == "preferred"
