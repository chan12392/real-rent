"""Deterministic, non-judgmental reaction classification without external services."""

import re
from typing import Literal, TypedDict

ExpressionId = Literal[
    "neutral",
    "listening",
    "thinking",
    "happy",
    "empathetic",
    "concerned",
    "surprised",
    "apologetic",
]
Intent = Literal[
    "save_cost",
    "shorten_commute",
    "set_condition",
    "greeting",
    "thanks",
    "question",
    "complaint",
    "unknown",
]


class Reaction(TypedDict):
    expression_id: ExpressionId
    intent: Intent
    confidence: float


REACTION_ASSUMPTIONS = ("표정은 규칙 기반 키워드 판단이며 추천 계산에 쓰지 않는다",)


def react_to_message(message: str) -> Reaction:
    """Classify text as data; confidence is not expression intensity."""
    if re.search(r"비싸|부담|힘들|지쳤|짜증|답답|속상|불편", message):
        return {"expression_id": "empathetic", "intent": "complaint", "confidence": 0.85}
    if re.search(r"(?:월세|비용|예산|돈).*?(?:줄|낮|아끼)|싸게|저렴", message):
        return {"expression_id": "empathetic", "intent": "save_cost", "confidence": 0.8}
    if re.search(r"더\s*가까|가까웠|(?:통근|출퇴근).*?(?:줄|짧|가까)", message):
        return {"expression_id": "listening", "intent": "shorten_commute", "confidence": 0.8}
    if re.search(r"감사|고마|땡큐|\bthanks?\b", message, re.IGNORECASE):
        return {"expression_id": "happy", "intent": "thanks", "confidence": 0.9}
    if re.search(r"[?？]|어떻게|왜|무엇|뭐|얼마|될까|인가요|까요|나요", message):
        return {"expression_id": "thinking", "intent": "question", "confidence": 0.75}
    if re.search(
        r"보증금|월세|예산|월\s*\d|한\s*달|입주|출근|환승|편도|통근|거주|우선|재택|직통"
        r"|\d+\s*(?:만|원|분|개월|년)",
        message,
    ):
        return {"expression_id": "listening", "intent": "set_condition", "confidence": 0.8}
    if re.search(r"안녕|반가|하이|헬로|\b(?:hello|hi)\b", message, re.IGNORECASE):
        return {"expression_id": "happy", "intent": "greeting", "confidence": 0.9}
    return {"expression_id": "neutral", "intent": "unknown", "confidence": 0.2}
