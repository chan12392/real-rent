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
    commute = (route["outbound"]["fare"] + route["inbound"]["fare"]) * c.workdays if route else None
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
    unknown = home["management"] is None or (c.office is not None and route is None)
    if not active:
        status = "idle"
    elif any(check["mode"] == "required" for check in failed):
        status = "bad"
    elif unknown or any(check["passed"] is None for check in checks):
        status = "unknown"
    elif failed:
        status = "so-so"
    else:
        status = "good"
    reasons = [
        f"{check['label']} {'필수 조건' if check['mode'] == 'required' else '선호'} 미충족"
        for check in failed
    ]
    if home["management"] is None:
        reasons.append("관리비를 확인해야 해요.")
    if c.office and route is None:
        reasons.append("출퇴근 경로를 확인하지 못했어요.")
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
        "transfers": transfers,
        "route": route,
    }
