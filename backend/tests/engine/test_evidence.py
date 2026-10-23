from app.engine.evidence import Evidence, evidence_for, load_evidence
from app.engine.explore import amount


def test_search_cannot_mix_other_listings_or_invent_missing_evidence():
    other = Evidence(
        document_id="other", listing_id="home-02", title="다른 집",
        quote="인터넷 포함", source="합성 검증 입력", as_of="2026-10-23", synthetic=True,
    )
    assert evidence_for("home-01", [other]) == {"evidence": [], "evidence_status": "missing"}
    assert evidence_for("home-02", [other])["evidence"][0]["quote"] == "인터넷 포함"


def test_invalid_reference_data_is_unavailable(monkeypatch, tmp_path):
    path = tmp_path / "references.json"
    path.write_text('[{"listing_id":"home-01"}]', encoding="utf-8")
    monkeypatch.setattr("app.engine.evidence.REFERENCES", path)
    assert load_evidence() is None


def test_fixture_documents_have_twelve_unique_listing_scopes_and_synthetic_labels():
    documents = load_evidence()
    assert documents is not None
    assert len({doc.listing_id for doc in documents}) == 12
    assert all(doc.synthetic and "합성" in doc.quote for doc in documents)


def test_decimal_money_is_exact_and_fractional_won_is_not_rounded():
    import pytest

    assert amount("1.1억") == 110_000_000
    with pytest.raises(ValueError):
        amount("0.00001만")
