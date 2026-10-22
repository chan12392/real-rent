"""규칙 기반 한국어 추출 → 검증 → 추가 질문. 외부 모델/추적 서비스 미사용."""

import re
from datetime import date
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from app.schemas.explore import ExploreConditions


class State(TypedDict):
    message: str
    conditions: dict
    reply: str


DIGITS = {"일": 1, "이": 2, "삼": 3, "사": 4, "오": 5, "육": 6, "칠": 7, "팔": 8, "구": 9}
NUMBER = r"[0-9일이삼사오육칠팔구십백천만억.,\s]+"


def amount(text: str) -> int:
    text = re.sub(r"[\s,]", "", text)
    if "." in text:
        match = re.fullmatch(r"(\d+\.\d+)(만|억)", text)
        if not match:
            raise ValueError("소수 금액 형식")
        return round(float(match[1]) * {"만": 10000, "억": 100000000}[match[2]])
    total = section = digit = 0
    for part in re.findall(r"\d+|[일이삼사오육칠팔구십백천만억]", text):
        if part.isdigit() or part in DIGITS:
            digit = int(part) if part.isdigit() else DIGITS[part]
        elif part in "십백천":
            section += (digit or 1) * {"십": 10, "백": 100, "천": 1000}[part]
            digit = 0
        else:
            total += (section + digit or 1) * {"만": 10000, "억": 100000000}[part]
            section = digit = 0
    return total + section + digit


def extract(state: State) -> dict:
    c = dict(state["conditions"])
    c["modes"] = dict(c.get("modes", {}))
    text = state["message"].strip()
    recognized = False
    invalid = False
    # Short replies answer the next missing field, without guessing the money unit.
    missing = next(
        (
            key
            for key in ["deposit", "budget", "office", "minutes", "move_in", "kind"]
            if c.get(key) is None
        ),
        None,
    )
    if missing in ("deposit", "budget") and re.fullmatch(
        r"[0-9일이삼사오육칠팔구십백천만억.,\s]+원?", text
    ):
        if "원" in text or "만" in text or "억" in text:
            text = ("보증금 " if missing == "deposit" else "월 예산 ") + text

    # Split clauses to bind '꼭/가능하면' to a condition rather than the whole message.
    for clause in re.split(r"[,，\n]|그리고|하지만|지키고|(?=가능하면)", text):
        updates = {}
        for key, pattern in [("deposit", r"보증금"), ("budget", r"월\s*(?:예산|지출|세)?")]:
            m = re.search(pattern + r"\s*(?:은|는|을|를|이|가)?\s*(" + NUMBER + r")\s*원?", clause)
            if m:
                try:
                    updates[key] = amount(m[1])
                except ValueError:
                    invalid = True
        for office in ["강남역", "서울역", "여의도역"]:
            if office in clause:
                updates["office"] = office
        m = re.search(r"(\d+)\s*분", clause)
        if m:
            updates["minutes"] = int(m[1])
        for kind in ["원룸", "오피스텔", "빌라"]:
            if kind in clause:
                updates["kind"] = kind
        m = re.search(r"(\d{4})[-./](\d{1,2})[-./](\d{1,2})", clause)
        if m:
            try:
                updates["move_in"] = date(*map(int, m.groups())).isoformat()
            except ValueError:
                invalid = True
        m = re.search(r"(\d+)\s*월\s*(\d+)\s*일", clause)
        if m and "move_in" not in updates:
            # No implicit year: date must be explicitly confirmed.
            invalid = True
        if re.search(r"환승\s*(?:없이|없|안)|한\s*번에|직통", clause):
            updates["transfers"] = 0
        m = re.search(
            r"(?:환승\s*(?:최대\s*)?(\d+|한|두|세)\s*(?:번|회)|"
            r"(\d+|한|두|세)\s*(?:번|회)\s*(?:까지\s*)?환승)",
            clause,
        )
        if m:
            value = m[1] or m[2]
            updates["transfers"] = {"한": 1, "두": 2, "세": 3}.get(value, value)
            updates["transfers"] = int(updates["transfers"])
        if re.search(r"환승.*(?:제한\s*없|상관없)", clause):
            updates["transfers"] = None
        m = re.search(r"(?:출근\s*(?:일수)?\s*(?:월\s*)?|월\s*)(\d+)\s*일", clause)
        if m and not re.search(r"입주|\d+월\s*\d+일|\d{4}[-./]", clause):
            updates["workdays"] = int(m[1])
        mode = (
            "preferred"
            if re.search(r"가능하면|선호|좋겠|상관없", clause)
            else "required"
            if re.search(r"꼭|반드시|필수|무조건", clause)
            else None
        )
        for key in updates:
            if mode and key != "workdays":
                c["modes"][key] = mode
        c.update(updates)
        recognized |= bool(updates)
    try:
        validated = ExploreConditions.model_validate(c)
    except ValueError:
        return {
            "reply": (
                "조건 범위를 확인해 주세요. 출근일은 0~31일, 금액·시간은 0 이상으로 알려주세요."
            )
        }
    if invalid:
        reply = "일부 표현을 확인하지 못했어요. 입주일은 2026-11-01처럼 연도까지 알려주세요."
    elif text and not recognized:
        reply = (
            "그 표현은 아직 이해하지 못했어요. 예를 들어 “보증금 천만 원, 월 80만 원, "
            "강남역까지 40분”처럼 알려주세요. 조건 카드에서도 수정할 수 있어요."
        )
    else:
        reply = ""
    return {"conditions": validated.model_dump(mode="json"), "reply": reply}


def respond(state: State) -> dict:
    if state.get("reply"):
        return {}
    c = state["conditions"]
    questions = [
        ("deposit", "보증금은 얼마까지 괜찮으세요?"),
        ("budget", "월세·관리비·통근비를 합해 월 얼마까지 괜찮으세요?"),
        ("office", "직장은 강남역·서울역·여의도역 중 어디인가요?"),
        ("minutes", "편도 출퇴근은 몇 분까지 괜찮으세요?"),
        ("move_in", "희망 입주일을 연도까지 알려주세요. 예: 2026-11-01"),
        ("kind", "원룸·오피스텔·빌라 중 어떤 집을 선호하세요?"),
    ]
    missing = next((q for k, q in questions if c.get(k) is None), None)
    prefix = "말씀하신 조건으로 지도를 반영했어요. " if state["message"] else ""
    return {
        "reply": prefix + (missing or "조건을 모두 받았어요! 지도에서 집을 눌러 비교해 보세요.")
    }


builder = StateGraph(State)
builder.add_node("extract", extract)
builder.add_node("respond", respond)
builder.add_edge(START, "extract")
builder.add_edge("extract", "respond")
builder.add_edge("respond", END)
conversation_graph = builder.compile()
