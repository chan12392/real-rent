"""Create in-memory evidence documents from the same fixtures used for comparison."""

from app.engine.models import ASSUMPTIONS, Listing, Route

COMMON = """# COMMON 계산 기준
이 문서는 합성 데이터 시연의 계산 기준이다.
- 월 예상 통근비는 (출근 1회 요금 + 퇴근 1회 요금) × 월 출근일수로 계산한다.
- 월 예상 지출은 월세 + 관리비 + 월 예상 통근비다.
- 보증금은 월 지출에 더하지 않고 보증금 한도와 따로 비교한다.
- 관리비가 확인되지 않으면 월 지출을 확인 불가로 둔다.
- 별도 공과금, 정기권 할인, 시간의 금전 환산은 월 지출에 넣지 않는다.
""" + "\n".join(f"- {assumption}" for assumption in ASSUMPTIONS)

UNKNOWN_FIELDS = ("주차", "층수", "방 상태", "동네 안전", "면적", "엘리베이터", "반려동물")


def route_text(route: Route | None) -> str:
    if route is None:
        return "확인되지 않음 (경로 조회 실패)"
    return (
        f"{route.minutes}분, {route.fare_krw:,}원, "
        f"환승 {route.transfers}회, 도보 {route.walk_minutes}분"
    )


def listing_document(item: Listing) -> str:
    fee = (
        f"{item.monthly_management_krw:,}원"
        if item.monthly_management_krw is not None
        else "확인되지 않음"
    )
    includes = ", ".join(item.management_includes) or "확인되지 않음"
    lines = [
        f"# {item.listing_id} {item.label} ({item.gu} {item.dong})",
        "이 문서는 시연용 가상 매물이다. 실제로 거래 가능한 매물이 아니다.",
        f"- 가격 기준: {item.price_basis}",
        f"- 보증금: {item.deposit_krw:,}원",
        f"- 월세: {item.monthly_rent_krw:,}원",
        f"- 관리비: {fee}",
        f"- 관리비 포함 항목: {includes}",
        f"- 입주 가능일: {item.move_in_available.isoformat()}",
        f"- 위치: {item.gu} {item.dong} (동 단위 대표 좌표, 실제 건물 위치 아님)",
        f"- 대표 좌표: {item.lat}, {item.lng} (실제 건물 위치 아님)",
        f"- 출근 경로: {route_text(item.outbound)}",
        f"- 퇴근 경로: {route_text(item.back)}",
        *(f"- {field}: 확인되지 않음" for field in UNKNOWN_FIELDS),
    ]
    return "\n".join(lines)


def generate_documents(items: list[Listing]) -> dict[str, str]:
    return {"COMMON": COMMON, **{item.listing_id: listing_document(item) for item in items}}
