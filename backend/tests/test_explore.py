import json

from fastapi.testclient import TestClient

from app.api.explore import DATA
from app.domain.explore import evaluate_home
from app.engine.explore import amount, conversation_graph
from app.main import create_app
from app.schemas.explore import ExploreConditions

client = TestClient(create_app())


def evaluated_homes(conditions):
    conditions = ExploreConditions.model_validate({"workdays": 20, **conditions})
    return [
        evaluate_home(home, conditions)
        for home in json.loads(DATA.read_text(encoding="utf-8"))["homes"]
    ]


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
    assert data["conditions"]["workdays"] is None


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
    homes = {h["id"]: h for h in evaluated_homes(c)}
    assert homes["home-01"]["status"] == "bad"
    assert homes["home-03"]["status"] == "unknown"
    assert homes["home-03"]["total"] is None
    assert homes["home-12"]["commute"] is None
    c["modes"]["budget"] = "preferred"
    homes = {h["id"]: h for h in evaluated_homes(c)}
    assert homes["home-01"]["status"] == "so-so"


def test_selection_can_be_re_evaluated_and_zero_days_still_checks_route():
    c = {"office": "강남역", "budget": 1_000_000, "workdays": 0}
    homes = {h["id"]: h for h in evaluated_homes(c)}
    assert homes["home-01"]["commute"] == 0
    assert homes["home-01"]["total"] == 530_000
    assert homes["home-12"]["total"] is None
    c["budget"] = 100_000
    assert {h["id"]: h for h in evaluated_homes(c)}["home-01"]["status"] == "bad"


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
    data = request({"office": "서울역"})
    assert data["recommended_ids"] == []
    assert all(home["total"] is None for home in data["homes"])


def test_missing_office_cannot_produce_confirmed_budget_match():
    data = request({"budget": 800_000})
    assert all(h["status"] == "idle" for h in data["homes"])
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


def test_half_preferences_is_recommended_with_tradeoff_explained():
    # home-01: required budget/deposit pass; kind passes, 40-minute commute fails (53).
    c = {
        "office": "강남역",
        "budget": 800_000,
        "deposit": 10_000_000,
        "minutes": 40,
        "kind": "원룸",
    }
    home = next(h for h in evaluated_homes(c) if h["id"] == "home-01")
    assert home["status"] == "good"
    assert any("2개 중 1개" in reason for reason in home["reasons"])
    assert any("13분" in reason for reason in home["reasons"])
    assert any("편도 통근 선호 미충족" in reason for reason in home["reasons"])
    # One out of three is below half, two out of three is above half.
    c["transfers"] = 0
    assert next(h for h in evaluated_homes(c) if h["id"] == "home-01")["status"] == "so-so"
    c["transfers"] = 1
    assert next(h for h in evaluated_homes(c) if h["id"] == "home-01")["status"] == "good"


def test_preference_threshold_never_overrides_required_or_unknown():
    c = {"office": "강남역", "budget": 100_000, "kind": "원룸", "minutes": 100}
    homes = {h["id"]: h for h in evaluated_homes(c)}
    assert homes["home-01"]["status"] == "bad"
    assert homes["home-03"]["status"] == "unknown"
    assert homes["home-12"]["status"] == "unknown"
    c["budget"] = 800_000
    c["modes"] = {"minutes": "required"}
    c["minutes"] = 40
    assert next(h for h in evaluated_homes(c) if h["id"] == "home-01")["status"] == "bad"


def test_no_preferences_recommends_when_required_conditions_pass():
    homes = {h["id"]: h for h in evaluated_homes({"office": "강남역", "budget": 800_000})}
    assert homes["home-01"]["status"] == "good"
    assert homes["home-03"]["status"] == "unknown"


def explore_turn(message, c=None, **extra):
    response = client.post(
        "/api/explore", json={"message": message, "conditions": c or {}, **extra}
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_ambiguous_money_requires_confirmation_and_rejection_preserves_old_value():
    old = {"budget": 900_000, "office": "강남역"}
    result = explore_turn("월 80", old)
    assert result["conditions"]["budget"] == 900_000
    assert result["pending_conditions"]["budget"] == 800_000
    result = explore_turn(
        "네", result["conditions"], pending_conditions=result["pending_conditions"]
    )
    assert result["conditions"]["budget"] == 800_000
    assert result["pending_conditions"] is None
    result = explore_turn("보증금 천", old)
    assert result["conditions"]["deposit"] is None
    assert result["pending_conditions"]["deposit"] == 10_000_000
    result = explore_turn(
        "아니요", result["conditions"], pending_conditions=result["pending_conditions"]
    )
    assert result["conditions"]["deposit"] is None
    assert result["conditions"]["budget"] == 900_000


def test_shorthand_is_confirmed_with_budget_definition():
    result = explore_turn("1000/60")
    assert result["conditions"]["deposit"] is None
    assert result["conditions"]["budget"] is None
    assert result["pending_conditions"]["deposit"] == 10_000_000
    assert result["pending_conditions"]["budget"] == 600_000
    assert "관리비·통근비" in result["reply"]


def test_office_alias_and_relative_date_need_confirmation(monkeypatch):
    from datetime import date

    monkeypatch.setattr("app.engine.explore.local_today", lambda: date(2026, 12, 22))
    result = explore_turn("강남으로 출근해요, 다음 달 초에 들어가요")
    assert result["conditions"]["office"] is None
    assert result["conditions"]["move_in"] is None
    assert result["pending_conditions"]["office"] == "강남역"
    assert result["pending_conditions"]["move_in"] == "2027-01-01"
    refreshed = explore_turn(
        "", result["conditions"], pending_conditions=result["pending_conditions"]
    )
    assert refreshed["pending_conditions"] == result["pending_conditions"]
    confirmed = explore_turn(
        "이대로 적용", refreshed["conditions"], pending_conditions=refreshed["pending_conditions"]
    )
    assert confirmed["conditions"]["move_in"] == "2027-01-01"


def test_transfer_synonyms_and_hours():
    for text in ["갈아타기 싫어요", "한 번에 가고 싶어요", "안 갈아타고 싶어요"]:
        assert explore_turn(text)["conditions"]["transfers"] == 0
    assert explore_turn("한 번까지 갈아타도 돼요")["conditions"]["transfers"] == 1
    assert explore_turn("출근 한 시간 반 이내")["conditions"]["minutes"] == 90


def test_remove_preference_does_not_ask_it_again_and_readding_clears_waiver():
    c = {
        "deposit": 10_000_000,
        "budget": 800_000,
        "office": "강남역",
        "minutes": 40,
        "move_in": "2026-11-01",
        "kind": "원룸",
        "workdays": 20,
        "priority": "cost",
        "transfers": 2,
    }
    result = explore_turn("원룸 아니어도 괜찮아요", c)
    assert result["conditions"]["kind"] is None
    assert "kind" in result["conditions"]["ignored"]
    assert result["partial"] is False
    result = explore_turn("환승 상관없어요", result["conditions"])
    assert result["conditions"]["transfers"] is None
    result = explore_turn("가능하면 빌라", result["conditions"])
    assert result["conditions"]["kind"] == "빌라"
    assert "kind" not in result["conditions"]["ignored"]


def test_targeted_budget_change_mode_only_and_undo():
    c = {
        "budget": 800_000,
        "office": "여의도역",
        "kind": "빌라",
        "minutes": 40,
        "modes": {"minutes": "required"},
    }
    changed = explore_turn("예산만 70만 원으로 바꿔줘", c)
    assert changed["conditions"]["budget"] == 700_000
    assert changed["conditions"]["office"] == "여의도역"
    assert changed["conditions"]["kind"] == "빌라"
    relaxed = explore_turn("출퇴근은 좀 길어도 돼요", changed["conditions"])
    assert relaxed["conditions"]["modes"]["minutes"] == "preferred"
    assert "몇 분" in relaxed["reply"]
    undone = explore_turn("방금 말한 건 취소", changed["conditions"], previous_conditions=c)
    assert undone["conditions"]["budget"] == 800_000
    assert undone["undone"] is True


def test_formatted_money_units_and_unrelated_date_do_not_become_workdays():
    result = explore_turn("보증금 10,000,000원, 월 예산 80만 원 이하")
    assert result["conditions"]["deposit"] == 10_000_000
    assert result["conditions"]["budget"] == 800_000
    assert result["pending_conditions"] is None
    assert explore_turn("입주일 2027-01-15")["conditions"]["workdays"] is None


def test_pending_cancel_does_not_undo_previous_change():
    result = explore_turn(
        "취소",
        {"budget": 800_000},
        pending_conditions={"budget": 700_000},
        previous_conditions={"budget": 600_000},
    )
    assert result["conditions"]["budget"] == 800_000
    assert result["undone"] is False
    assert result["pending_conditions"] is None


def test_workday_count_and_month_day_are_not_money(monkeypatch):
    from datetime import date

    monkeypatch.setattr("app.engine.explore.local_today", lambda: date(2026, 10, 22))
    result = explore_turn("출근 월 15일")
    assert result["conditions"]["workdays"] == 15
    assert result["pending_conditions"] is None
    assert result["conditions"]["budget"] is None
    result = explore_turn("11월 1일 입주")
    assert result["pending_conditions"]["move_in"] == "2026-11-01"
    assert result["pending_conditions"]["budget"] is None


def test_inside_time_and_money_phrases_with_soft_preference():
    for text, minutes in [
        ("30분 안쪽이였으면 좋겠어", 30),
        ("사십 분 안쪽이었으면 좋겠어요", 40),
        ("출근 한 시간 안쪽이면 좋겠어요", 60),
    ]:
        result = explore_turn(text)
        assert result["conditions"]["minutes"] == minutes
        assert result["conditions"]["modes"]["minutes"] == "preferred"
    result = explore_turn("월 예산은 80만 원 안쪽이었으면 좋겠어")
    assert result["conditions"]["budget"] == 800_000
    assert result["conditions"]["modes"]["budget"] == "preferred"
    result = explore_turn("꼭 30분 안쪽이었으면 좋겠어")
    assert result["conditions"]["modes"]["minutes"] == "required"


def test_rent_inside_phrase_confirms_total_budget_instead_of_silent_reinterpretation():
    result = explore_turn("월세는 60만 원 안쪽이였으면 좋겠어", {"budget": 900_000})
    assert result["conditions"]["budget"] == 900_000
    assert result["pending_conditions"]["budget"] == 600_000
    assert "월세만의 상한" in result["reply"]
    assert "관리비·통근비" in result["reply"]
    confirmed = explore_turn(
        "네", result["conditions"], pending_conditions=result["pending_conditions"]
    )
    assert confirmed["conditions"]["budget"] == 600_000
    rejected = explore_turn(
        "아니요", result["conditions"], pending_conditions=result["pending_conditions"]
    )
    assert rejected["conditions"]["budget"] == 900_000


def test_rent_without_amount_asks_for_money_without_inventing_a_limit():
    result = explore_turn("월세는 얼마 안쪽이였으면 좋겠어", {"budget": 900_000})
    assert result["conditions"]["budget"] == 900_000
    assert result["pending_conditions"] is None
    assert "원하시는 금액" in result["reply"]
