"""규칙 기반 한국어 추출 → 검증 → 추가 질문. 외부 모델/추적 서비스 미사용."""

import re
from datetime import date, datetime
from typing import TypedDict
from zoneinfo import ZoneInfo

from langgraph.graph import END, START, StateGraph

from app.schemas.explore import ExploreConditions


class State(TypedDict):
    message: str
    conditions: dict
    reply: str
    pending_conditions: dict | None
    previous_conditions: dict | None
    undone: bool


DIGITS = {"일": 1, "이": 2, "삼": 3, "사": 4, "오": 5, "육": 6, "칠": 7, "팔": 8, "구": 9}
NUMBER = r"[0-9일이삼사오육칠팔구십백천만억](?:(?!이하|이내)[0-9일이삼사오육칠팔구십백천만억.,\s])*"


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


def local_today() -> date:
    return datetime.now(ZoneInfo("Asia/Seoul")).date()


def extract(state: State) -> dict:
    c = dict(state["conditions"])
    c["modes"] = dict(c.get("modes", {}))
    ignored = set(c.get("ignored", []))
    text = state["message"].strip()
    previous = state.get("previous_conditions")
    pending = state.get("pending_conditions")
    if not text:
        return {
            "conditions": ExploreConditions.model_validate(c).model_dump(mode="json"),
            "pending_conditions": pending,
            "reply": (
                "해석한 조건을 확인 중이에요. "
                "이전 질문을 보고 적용하거나 원하는 값을 다시 알려주세요."
            )
            if pending
            else "",
        }
    if pending and text == "취소":
        return {"pending_conditions": None, "reply": "확인 중인 조건은 적용하지 않았어요."}
    if re.fullmatch(
        r"(?:방금(?:\s*말한\s*건)?|직전|마지막)?\s*(?:변경\s*)?(?:취소|되돌려|되돌리기|원래대로)(?:해줘|해주세요)?[.!]?",
        text,
    ):
        return {
            "conditions": previous or c,
            "pending_conditions": None,
            "undone": previous is not None,
            "reply": "직전 조건 변경을 되돌렸어요."
            if previous is not None
            else "되돌릴 조건 변경이 없어요.",
        }
    if pending and re.fullmatch(
        r"(?:네+|응+|좋아|좋아요|맞아|맞아요|예|확인|이대로\s*적용|적용해줘)[.!~]?", text
    ):
        return {
            "conditions": ExploreConditions.model_validate(pending).model_dump(mode="json"),
            "pending_conditions": None,
            "reply": "확인해 주신 조건을 반영했어요.",
        }
    if pending and re.fullmatch(r"(?:아니|아니요|아냐|취소할게)[.!~]?", text):
        return {
            "pending_conditions": None,
            "reply": "확인 중인 조건은 적용하지 않았어요. 원하는 값을 다시 알려주세요.",
        }
    recognized = False
    invalid = False
    proposals = {}
    prompts = []
    notes = []
    aliases = {
        "deposit": r"보증금",
        "budget": r"월세|월\s*(?:예산|지출)|예산",
        "minutes": r"통근|출퇴근|출근\s*시간",
        "kind": r"원룸|오피스텔|빌라|주거\s*유형|집\s*종류",
        "transfers": r"환승|갈아타",
    }
    missing = next(
        (
            key
            for key in ["deposit", "budget", "office", "minutes", "move_in", "kind"]
            if c.get(key) is None and key not in ignored
        ),
        None,
    )
    if missing in ("deposit", "budget") and re.fullmatch(NUMBER + r"원?", text):
        if "원" in text or "만" in text or "억" in text:
            text = ("보증금 " if missing == "deposit" else "월 예산 ") + text
    # A shorthand is only proposed, never silently converted to won.
    shorthand = re.fullmatch(r"(\d+)\s*/\s*(\d+)", text)
    if shorthand:
        proposals.update(deposit=int(shorthand[1]) * 10000, budget=int(shorthand[2]) * 10000)
        prompts.append(
            f"보증금 {int(shorthand[1]):,}만 원, "
            f"월 지출 상한 {int(shorthand[2]):,}만 원으로 볼까요? "
            "월 지출에는 관리비·통근비도 포함돼요."
        )
        recognized = True
    today = local_today()
    for clause in re.split(r"(?<!\d),|,(?!\d)|[，\n]|그리고|하지만|지키고|(?=가능하면)", text):
        updates = {}
        for key, pattern in [
            ("deposit", r"보증금"),
            ("budget", r"(?:(?<![0-9])월\s*(?:예산|지출|세)?|예산)"),
        ]:
            m = re.search(
                pattern + r"\s*(?:만|은|는|을|를|이|가)?\s*(" + NUMBER + r")\s*(원)?", clause
            )
            if m:
                token = m[1].strip().rstrip(".,")
                if token.endswith("일") and not m[2]:
                    continue  # '월 20일' is a workday count, not a money amount.
                try:
                    value = amount(token)
                    if not m[2] and "원" not in m[0] and not re.search(r"만|억", token):
                        proposals[key] = value * 10000
                        prompts.append(
                            f"{'보증금' if key == 'deposit' else '월 지출 상한'} "
                            f"{value:,}만 원을 말씀하신 걸까요?"
                        )
                    elif key == "budget" and "월세" in m[0]:
                        proposals[key] = value
                        prompts.append(
                            f"월세 {value:,}원 안쪽을 원하시는군요. "
                            "현재는 월세만의 상한 대신 관리비·통근비를 합친 월 예산으로 비교해요. "
                            f"월 총지출 {value:,}원 이하로 적용해도 될까요?"
                        )
                    else:
                        updates[key] = value
                except ValueError:
                    invalid = True
        for office in ["강남역", "서울역", "여의도역"]:
            if office in clause:
                updates["office"] = office
            elif office.removesuffix("역") in clause and re.search(r"직장|출근|회사|근무", clause):
                proposals["office"] = office
                prompts.append(f"직장은 {office} 기준으로 찾을까요?")
        m = re.search(r"(\d+|[일이삼사오육칠팔구십백]+)\s*분", clause)
        if m:
            updates["minutes"] = amount(m[1])
        hours = re.search(r"(\d+|한|두)\s*시간\s*(반|(?:(\d+)\s*분))?", clause)
        if hours:
            value = {"한": 1, "두": 2}.get(hours[1], hours[1])
            updates["minutes"] = int(value) * 60 + (30 if hours[2] == "반" else int(hours[3] or 0))
        for kind in ["원룸", "오피스텔", "빌라"]:
            if kind in clause:
                updates["kind"] = kind
        m = re.search(r"(\d{4})[-./](\d{1,2})[-./](\d{1,2})", clause)
        if m:
            try:
                updates["move_in"] = date(*map(int, m.groups())).isoformat()
            except ValueError:
                invalid = True
        elif re.search(r"다음\s*달", clause):
            year, month = (
                (today.year + 1, 1) if today.month == 12 else (today.year, today.month + 1)
            )
            day_match = re.search(r"(\d+)\s*일", clause)
            day = int(day_match[1]) if day_match else 1
            try:
                proposed = date(year, month, day).isoformat()
                proposals["move_in"] = proposed
                prompts.append(
                    f"입주일을 {proposed}로 볼까요? "
                    "'다음 달 초'처럼 범위로 말한 경우 원하는 날짜로 바꿔도 돼요."
                )
            except ValueError:
                invalid = True
        else:
            m = re.search(r"(\d+)\s*월\s*(\d+)\s*일", clause)
            if m:
                year = today.year + (1 if "내년" in clause else 0)
                try:
                    proposed = date(year, int(m[1]), int(m[2]))
                    if "내년" not in clause and proposed < today:
                        proposed = date(year + 1, int(m[1]), int(m[2]))
                    proposals["move_in"] = proposed.isoformat()
                    prompts.append(f"입주일은 {proposed.isoformat()}을 말씀하신 걸까요?")
                except ValueError:
                    invalid = True
        if re.search(
            r"환승\s*(?:없이|없|안)|한\s*번에|직통|갈아타(?:기)?\s*(?:싫|안)|안\s*갈아타", clause
        ):
            updates["transfers"] = 0
        m = re.search(
            r"(?:환승\s*(?:최대\s*)?(\d+|한|두|세)\s*(?:번|회)|"
            r"(\d+|한|두|세)\s*(?:번|회)\s*(?:까지\s*)?(?:환승|갈아타))",
            clause,
        )
        if m:
            value = m[1] or m[2]
            updates["transfers"] = int({"한": 1, "두": 2, "세": 3}.get(value, value))
        m = re.search(r"(?:출근\s*(?:일수)?\s*(?:월\s*)?|월\s*)(\d+)\s*일", clause)
        if m and not re.search(r"입주|다음\s*달|\d+월\s*\d+일|\d{4}[-./]", clause):
            updates["workdays"] = int(m[1])
        if "월세" in clause and not re.search(r"[0-9만억천백십]", clause) and re.search(
            r"얼마|안쪽|이내|이하", clause
        ):
            notes.append(
                "원하시는 금액을 알려주세요. 현재는 월세·관리비·통근비를 합친 월 예산으로 "
                "비교해요. 예: 월 예산 80만 원 안쪽이었으면 좋겠어요."
            )
            recognized = True
        mode = (
            "required"
            if re.search(r"꼭|반드시|필수|무조건", clause)
            else "preferred"
            if re.search(r"가능하면|선호|좋겠|길어도|상관없", clause)
            else None
        )
        if mode:
            for key, alias in aliases.items():
                if re.search(alias, clause):
                    c["modes"][key] = mode
                    recognized = True
        if (
            re.search(r"통근|출퇴근|출근\s*시간", clause)
            and re.search(r"길어도|더\s*걸려도", clause)
            and "minutes" not in updates
        ):
            notes.append("통근은 선호로 바꿨어요. 몇 분까지 괜찮으세요?")
        for key in updates:
            if mode and key != "workdays":
                c["modes"][key] = mode
            ignored.discard(key)
        for key, alias in aliases.items():
            if re.search(alias, clause) and re.search(
                r"아니어도|상관없|제한\s*없|해제|아무거나", clause
            ):
                updates[key] = None
                ignored.add(key)
                proposals.pop(key, None)
                label = {
                    "deposit": "보증금",
                    "budget": "월 예산",
                    "minutes": "통근 시간",
                    "kind": "주거 유형",
                    "transfers": "환승",
                }[key]
                notes.append(f"{label} 제한을 해제했어요.")
        c.update(updates)
        recognized |= bool(updates)
    c["ignored"] = sorted(ignored)
    try:
        validated = ExploreConditions.model_validate(c).model_dump(mode="json")
        proposal = (
            ExploreConditions.model_validate(
                {
                    **validated,
                    **proposals,
                    "ignored": [key for key in validated["ignored"] if key not in proposals],
                }
            ).model_dump(mode="json")
            if proposals
            else None
        )
    except ValueError:
        return {
            "pending_conditions": None,
            "reply": (
                "조건 범위를 확인해 주세요. 출근일은 0~31일, 금액·시간은 0 이상으로 알려주세요."
            ),
        }
    if invalid:
        reply = "일부 표현을 확인하지 못했어요. 입주일은 2026-11-01처럼 연도까지 알려주세요."
    elif prompts:
        reply = " ".join(prompts) + " 확인 전에는 그 값은 반영하지 않을게요."
    elif notes:
        reply = " ".join(notes)
    elif text and not recognized:
        reply = (
            "그 표현은 아직 이해하지 못했어요. 예를 들어 “보증금 천만 원, "
            "월 80만 원, 강남역까지 40분”처럼 알려주세요. 조건 카드에서도 수정할 수 있어요."
        )
    else:
        reply = ""
    return {
        "conditions": validated,
        "reply": reply,
        "pending_conditions": proposal,
        "undone": False,
    }


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
    missing = next(
        (q for k, q in questions if c.get(k) is None and k not in c.get("ignored", [])), None
    )
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
