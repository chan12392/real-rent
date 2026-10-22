"""Boundary and integration checks beyond the hand-calculated reference cases."""

import csv
from dataclasses import replace
from datetime import date

from app.engine.calc import compare, evaluate, inverse_scores, rank
from app.engine.data import DEFAULT_DATA_DIR, load_listings
from app.engine.documents import generate_documents
from app.engine.models import Conditions, Route
from app.engine.retrieval import search_documents


def conditions(**changes):
    base = Conditions(10_000_000, 750_000, date(2026, 11, 1), 20, 40, 1, "cost")
    return replace(base, **changes)


def test_collects_all_reasons_and_primary_uses_final_status():
    item = next(item for item in load_listings() if item.listing_id == "L03")
    result = evaluate(item, conditions(max_one_way_minutes=32, max_transfers=0))
    assert result.status == "fail"
    assert result.primary_reason == "출근 시간 상한 초과"
    assert result.reasons == (
        "관리비 미확인으로 월 지출 계산 불가",
        "출근 시간 상한 초과",
        "출근 환승 상한 초과",
        "퇴근 시간 상한 초과",
        "퇴근 환승 상한 초과",
    )
    result = evaluate(item, conditions(deposit_limit_krw=9_999_999))
    assert result.status == "fail"
    assert result.primary_reason == "보증금 한도 초과"
    assert result.reasons[-1] == "관리비 미확인으로 월 지출 계산 불가"


def test_route_failure_preserves_other_known_failures_and_nulls():
    item = next(item for item in load_listings() if item.listing_id == "L12")
    item = replace(item, outbound=Route(45, 1550, 2, 6), monthly_management_krw=None)
    result = compare([item], conditions(deposit_limit_krw=0))["results"][0]
    assert result["status"] == "route_failed"
    assert result["primary_reason"] == "출근 또는 퇴근 경로 조회 실패"
    assert result["reasons"] == [
        "출근 또는 퇴근 경로 조회 실패",
        "보증금 한도 초과",
        "관리비 미확인으로 월 지출 계산 불가",
        "출근 시간 상한 초과",
        "출근 환승 상한 초과",
    ]
    assert result["cost"]["monthly_commute_krw"] is None
    assert result["cost"]["monthly_total_krw"] is None
    assert result["cost"]["stay_total_krw"] is None
    assert result["commute"]["return"] is None
    assert result["scores"] == {"cost": None, "time": None, "convenience": None, "livability": None}


def test_zero_office_days_skips_limits_but_keeps_missing_routes_unknown():
    result = compare(
        load_listings(), conditions(office_days=0, max_one_way_minutes=1, max_transfers=0)
    )
    rows = {row["listing_id"]: row for row in result["results"]}
    assert result["counts"] == {"pass": 5, "fail": 5, "unknown": 1, "route_failed": 1}
    assert rows["L01"]["status"] == "pass"
    assert rows["L01"]["cost"]["monthly_commute_krw"] == 0
    assert rows["L01"]["cost"]["monthly_total_krw"] == 570_000
    assert rows["L12"]["status"] == "route_failed"
    assert rows["L12"]["cost"]["monthly_commute_krw"] is None


def test_zero_management_override_and_stay_total_do_not_change_original():
    item = next(item for item in load_listings() if item.listing_id == "L03")
    result = compare([item], conditions(management_overrides={"L03": 0}, stay_months=2))["results"][
        0
    ]
    assert result["status"] == "pass"
    assert result["cost"]["monthly_total_krw"] == 542_000  # 480,000 + 0 + 62,000
    assert result["cost"]["stay_total_krw"] == 1_084_000
    assert result["cost"]["initial_cash_krw"] == 10_480_000
    assert item.monthly_management_krw is None


def test_scores_use_all_known_values_not_only_passed_listings():
    rows = {row["listing_id"]: row for row in compare(load_listings(), conditions())["results"]}
    # Cost: min L09=562k, max L11=812k. L01 => (812-632)/(812-562)*100=72.
    # Time: min L11=25, max L04=87. L01 => (87-78)/(87-25)*100=14.516... => 15.
    assert rows["L01"]["scores"] == {"cost": 72, "time": 15, "convenience": 20, "livability": None}
    assert rows["L03"]["scores"]["cost"] is None
    assert rows["L04"]["scores"]["convenience"] == 0
    assert rows["L09"]["scores"]["cost"] == 100
    assert rows["L11"]["scores"]["time"] == 100


def test_scores_equal_and_all_unknown():
    assert inverse_scores({"a": 5, "b": 5, "c": None}) == {"a": 100, "b": 100, "c": None}
    assert inverse_scores({"a": None}) == {"a": None}
    assert inverse_scores({}) == {}


def test_score_half_is_rounded_up():
    # 100 * (8 - 3) / (8 - 0) = 62.5 -> 63 (not banker's rounding to 62).
    assert inverse_scores({"best": 0, "middle": 3, "worst": 8}) == {
        "best": 100,
        "middle": 63,
        "worst": 0,
    }


def test_exact_cost_and_time_tie_uses_id():
    item = load_listings()[0]
    earlier = replace(item, listing_id="L00")
    for priority in ("cost", "time"):
        assert [row.listing_id for row in rank([item, earlier], conditions(priority=priority))] == [
            "L00",
            "L01",
        ]


def test_default_data_location_is_independent_of_cwd(monkeypatch, tmp_path):
    monkeypatch.delenv("REAL_RENT_DATA_DIR", raising=False)
    monkeypatch.chdir(tmp_path)
    assert len(load_listings()) == 12
    assert load_listings()[0].monthly_management_krw == 70_000


def test_environment_data_override_changes_both_calculation_and_evidence(monkeypatch, tmp_path):
    for filename in ("listings.csv", "commute_fixture.csv"):
        with (DEFAULT_DATA_DIR / filename).open(encoding="utf-8", newline="") as stream:
            reader = csv.DictReader(stream)
            names, rows = reader.fieldnames, list(reader)
        if filename == "listings.csv":
            rows[0]["monthly_management_krw"] = "12345"
        with (tmp_path / filename).open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=names)
            writer.writeheader()
            writer.writerows(rows)
    monkeypatch.setenv("REAL_RENT_DATA_DIR", str(tmp_path))
    items = load_listings()
    assert compare(items, conditions())["results"][0]["cost"]["monthly_total_krw"] == 574_345
    assert "- 관리비: 12,345원" in generate_documents(items)["L01"]


def test_search_matches_lexical_evidence_and_can_filter_to_id():
    documents = generate_documents(load_listings())
    assert search_documents("L06 노량진동 2026-10-25 입주 가능일", documents)[0] == "L06"
    assert search_documents("관리비 수도 인터넷", documents, ["L07"]) == ["L07"]
