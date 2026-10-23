"""매물 ID로 제한한 합성 문서 검색. 모델 생성 없이 원문을 반환한다."""

from datetime import date
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

REFERENCES = Path(__file__).resolve().parents[3] / "data" / "references" / "explore.json"


class Evidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: str = Field(min_length=1, max_length=100)
    listing_id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=200)
    quote: str = Field(min_length=1, max_length=2000)
    source: str = Field(min_length=1, max_length=300)
    as_of: date
    synthetic: Literal[True]


def load_evidence() -> list[Evidence] | None:
    try:
        documents = TypeAdapter(list[Evidence]).validate_json(
            REFERENCES.read_text(encoding="utf-8")
        )
        if len({doc.document_id for doc in documents}) != len(documents):
            return None
        return documents
    except (OSError, ValueError):
        return None


def evidence_for(listing_id: str, documents: list[Evidence] | None) -> dict:
    if documents is None:
        return {"evidence": [], "evidence_status": "unavailable"}
    matches = [doc.model_dump(mode="json") for doc in documents if doc.listing_id == listing_id]
    return {"evidence": matches, "evidence_status": "found" if matches else "missing"}
