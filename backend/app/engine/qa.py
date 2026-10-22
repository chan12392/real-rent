"""Evidence-based rule answers with explicit identity clarification; no model calls."""

import re

from app.engine.documents import UNKNOWN_FIELDS, generate_documents
from app.engine.models import ASSUMPTIONS, Listing
from app.engine.retrieval import search_documents

ID_PATTERN = re.compile(r"(?<![A-Za-z0-9])L\d{2}(?![A-Za-z0-9])", re.IGNORECASE)


def response(status: str, answer: str, citations: list[dict], candidates: list[str]) -> dict:
    return {
        "synthetic": True,
        "assumptions": list(ASSUMPTIONS),
        "status": status,
        "answer": answer,
        "citations": citations,
        "candidates": candidates,
    }


def common_rule(question: str) -> str | None:
    compact = re.sub(r"\s+", "", question)
    if any(word in compact for word in ("통근비", "교통비")) and any(
        word in compact for word in ("계산", "어떻게", "기준")
    ):
        return "- 월 예상 통근비는"
    if "보증금" in compact and any(word in compact for word in ("월지출", "월비용")):
        return "- 보증금은"
    if any(word in compact for word in ("월지출", "월예상지출")) and any(
        word in compact for word in ("계산", "어떻게", "포함")
    ):
        return "- 월 예상 지출은"
    return None


def fact_fields(question: str) -> list[str]:
    fields = []
    if "관리비" in question or (
        "포함" in question and any(word in question for word in ("수도", "인터넷", "tv", "청소"))
    ):
        includes = any(word in question for word in ("포함", "항목", "뭐가"))
        if not includes or any(word in question for word in ("얼마", "금액", "가격")):
            fields.append("관리비")
        if includes:
            fields.append("관리비 포함 항목")
    if "보증금" in question:
        fields.append("보증금")
    if "월세" in question:
        fields.append("월세")
    if any(word in question for word in ("입주", "언제", "들어갈", "들어가")):
        fields.append("입주 가능일")
    if any(word in question for word in ("가상", "실제", "실매물", "계약", "거래")):
        fields.append("synthetic")
    if any(word in question for word in ("위치", "주소", "어디")):
        fields.append("위치")
    if "좌표" in question:
        fields.append("대표 좌표")
    if any(word in question for word in ("통근", "출근", "퇴근", "환승", "도보", "경로")):
        if "출근" in question or "퇴근" not in question:
            fields.append("출근 경로")
        if "퇴근" in question or "출근" not in question:
            fields.append("퇴근 경로")
    fields.extend(field for field in UNKNOWN_FIELDS if field in question)
    return list(dict.fromkeys(fields))


def identify_candidates(question: str, items: list[Listing], listing_id: str | None) -> list[str]:
    named = set(ID_PATTERN.findall(question.upper()))
    if named:
        if len(named) > 1 and listing_id in named:
            return [listing_id]
        return sorted(named)
    if listing_id is not None:
        return [listing_id]
    candidates = items
    dongs = {item.dong for item in items if item.dong in question or item.dong[:-1] in question}
    if dongs:
        candidates = [item for item in candidates if item.dong in dongs]
    districts = {item.gu for item in items if item.gu in question or item.gu[:-1] in question}
    if districts:
        candidates = [item for item in candidates if item.gu in districts]
    # A confirmed inclusion can disambiguate e.g. 봉천동 + TV (L04).
    # Similarity scores must never silently choose between same-dong listings.
    if "포함" in question:
        qualifiers = [
            included
            for included in ("수도", "인터넷", "TV", "청소")
            if included.casefold() in question.casefold()
        ]
        if qualifiers:
            candidates = [
                item
                for item in candidates
                if all(included in item.management_includes for included in qualifiers)
            ]
    return sorted(item.listing_id for item in candidates)


def answer_question(question: str, items: list[Listing], listing_id: str | None = None) -> dict:
    documents = generate_documents(items)
    rule = common_rule(question)
    if rule:
        doc_id = search_documents(question, documents, ["COMMON"])[0]
        quote = next(line for line in documents[doc_id].splitlines() if line.startswith(rule))
        return response(
            "answered", quote.removeprefix("- "), [{"doc_id": doc_id, "quote": quote}], []
        )
    fields = fact_fields(question.casefold())
    if not fields:
        return response(
            "out_of_scope",
            "근거 문서에 없는 주제입니다. 매물 조건이나 계산 기준을 질문해 주세요.",
            [],
            [],
        )
    candidates = identify_candidates(question, items, listing_id)
    if not candidates or any(doc_id not in documents for doc_id in candidates):
        return response(
            "out_of_scope", "해당 조건의 매물은 시연 근거 문서에서 찾을 수 없습니다.", [], []
        )
    if len(candidates) > 1:
        return response(
            "clarify",
            f"어느 매물인지 골라 주세요. 후보: {', '.join(candidates)}.",
            [
                {"doc_id": doc_id, "quote": documents[doc_id].splitlines()[0]}
                for doc_id in candidates
            ],
            candidates,
        )
    doc_id = search_documents(question, documents, candidates)[0]
    lines = documents[doc_id].splitlines()
    quotes = [
        next(
            line
            for line in lines
            if (
                line.startswith("이 문서는")
                if field == "synthetic"
                else line.startswith(f"- {field}:")
            )
        )
        for field in fields
    ]
    status = "unknown" if any("확인되지 않음" in quote for quote in quotes) else "answered"
    answer = f"{doc_id} " + " ".join(quote.removeprefix("- ") for quote in quotes)
    return response(status, answer, [{"doc_id": doc_id, "quote": quote} for quote in quotes], [])
