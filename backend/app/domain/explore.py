"""선택한 집의 조건별 판정. 파일·HTTP·LLM 호출 없는 순수 함수."""

from app.schemas.explore import ExploreConditions

LABELS = {
    "deposit": "보증금",
    "budget": "월 예산",
    "office": "직장",
    "minutes": "편도 통근",
    "move_in": "입주일",
    "kind": "주거 유형",
    "transfers": "편도 환승",
}
DEFAULT_REQUIRED = {"deposit", "budget", "move_in", "office"}


def evaluate_home(home: dict, c: ExploreConditions) -> dict:
    route = home["routes"].get(c.office) if c.office else None
    route_failed = c.office in home.get("route_errors", {})
    if route_failed or (route and (route["outbound"] is None or route["inbound"] is None)):
        route = None
    commute = (
        (route["outbound"]["fare"] + route["inbound"]["fare"]) * c.workdays
        if route and c.workdays is not None else None
    )
    total = (
        home["rent"] + home["management"] + commute
        if home["management"] is not None and commute is not None
        else None
    )
    minutes = max(route["outbound"]["minutes"], route["inbound"]["minutes"]) if route else None
    transfers = (
        max(route["outbound"]["transfers"], route["inbound"]["transfers"]) if route else None
    )
    checks = []
    for key, label in LABELS.items():
        wanted = getattr(c, key)
        if wanted is None or key == "office":
            continue
        actual = {
            "deposit": home["deposit"],
            "budget": total,
            "minutes": minutes,
            "transfers": transfers,
            "kind": home["kind"],
            "move_in": home["available"],
        }[key]
        if actual is None:
            passed = None
        elif key == "kind":
            passed = actual == wanted
        elif key == "move_in":
            passed = actual <= wanted.isoformat()
        else:
            passed = actual <= wanted
        mode = c.modes.get(key, "required" if key in DEFAULT_REQUIRED else "preferred")
        checks.append({"key": key, "label": label, "mode": mode, "passed": passed})
    active = any(getattr(c, key) is not None for key in LABELS)
    failed = [check for check in checks if check["passed"] is False]
    preferred = [check for check in checks if check["mode"] == "preferred"]
    preferred_met = sum(check["passed"] is True for check in preferred)
    unknown = home["management"] is None or (c.office is not None and route is None)
    if not active:
        status = "idle"
    elif any(check["mode"] == "required" for check in failed):
        status = "bad"
    elif unknown or any(check["passed"] is None for check in checks):
        status = "unknown"
    elif preferred_met * 2 >= len(preferred):
        status = "good"
    else:
        status = "so-so"
    reasons = [
        f"{check['label']} {'필수 조건' if check['mode'] == 'required' else '선호'} 미충족"
        for check in failed
    ]
    if status == "good":
        summary = []
        if any(check["mode"] == "required" for check in checks):
            summary.append("입력한 필수 조건을 모두 충족해요.")
        if preferred:
            matched = "·".join(check["label"] for check in preferred if check["passed"] is True)
            summary.append(
                f"선호 {len(preferred)}개 중 {preferred_met}개 충족: {matched}에 맞아요."
            )
        reasons = summary + reasons
    for check in failed:
        if check["key"] == "minutes" and minutes is not None:
            reasons.append(f"편도 통근이 희망보다 {minutes - c.minutes}분 길어요.")
        elif check["key"] == "transfers" and transfers is not None:
            reasons.append(f"환승이 희망보다 {transfers - c.transfers}회 많아요.")
        elif check["key"] == "budget" and total is not None:
            reasons.append(f"월 지출이 예산보다 {total - c.budget:,}원 높아요.")
    if c.budget is not None and not c.office:
        reasons.append("직장을 선택하면 월 통근비와 월 지출을 확인할 수 있어요.")
    if home["management"] is None:
        reasons.append("관리비를 확인해야 해요.")
    if c.office and route is None:
        reasons.append("출퇴근 경로 조회에 실패했어요." if route_failed
                       else "출퇴근 경로 자료가 미확인이에요.")
    if not reasons:
        reasons = ["입력한 조건에 잘 맞아요!" if active else "조건을 알려주시면 비교해 드릴게요."]
    return {
        **home,
        "status": status,
        "checks": checks,
        "reasons": reasons,
        "commute": commute,
        "total": total,
        "minutes": minutes,
        "round_trip_minutes": (
            route["outbound"]["minutes"] + route["inbound"]["minutes"] if route else None
        ),
        "transfers": transfers,
        "route": route,
    }
