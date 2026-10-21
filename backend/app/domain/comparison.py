from app.schemas.comparison import (
    Candidate,
    ComparisonRequest,
    ComparisonResponse,
    DemoData,
    ExcludedListing,
)


def compare_listings(conditions: ComparisonRequest, data: DemoData) -> ComparisonResponse:
    office = next((office for office in data.offices if office.id == conditions.office_id), None)
    if office is None:
        raise ValueError("제공된 시연 회사를 선택해 주세요.")

    # shortcut: one fixed route per direction; select among alternatives when adding a live API.
    routes = {route.listing_id: route for route in data.routes if route.office_id == office.id}
    candidates = []
    excluded = []
    for listing in data.listings:
        reasons = []
        if listing.deposit_krw > conditions.deposit_limit_krw:
            reasons.append("보증금 한도 초과")
        if listing.available_from > conditions.move_in_date:
            reasons.append("희망 입주일 이후 입주 가능")
        if listing.monthly_management_krw is None:
            reasons.append("관리비 확인 불가")

        route = routes.get(listing.id)
        if route is None or route.outbound is None or route.inbound is None:
            reasons.append("왕복 경로 확인 불가")
        else:
            for label, leg in (("출근", route.outbound), ("퇴근", route.inbound)):
                if leg.minutes > conditions.max_commute_minutes:
                    reasons.append(f"{label} 시간 상한 초과")
                if leg.transfers > conditions.max_transfers:
                    reasons.append(f"{label} 환승 상한 초과")
            if listing.monthly_management_krw is not None:
                commute = (route.outbound.fare_krw + route.inbound.fare_krw) * conditions.workdays
                total = listing.monthly_rent_krw + listing.monthly_management_krw + commute
                if total > conditions.monthly_limit_krw:
                    reasons.append("월 지출 한도 초과")
                if not reasons:
                    candidates.append(Candidate(
                        listing=listing,
                        outbound=route.outbound,
                        inbound=route.inbound,
                        monthly_commute_krw=commute,
                        monthly_total_krw=total,
                        round_trip_minutes=route.outbound.minutes + route.inbound.minutes,
                    ))
        if reasons:
            excluded.append(ExcludedListing(id=listing.id, label=listing.label, reasons=reasons))

    if conditions.priority == "cost":
        candidates.sort(key=lambda item: (
            item.monthly_total_krw, item.round_trip_minutes, item.listing.id,
        ))
    else:
        candidates.sort(key=lambda item: (
            item.round_trip_minutes, item.monthly_total_krw, item.listing.id,
        ))
    return ComparisonResponse(
        note=data.note,
        conditions=conditions,
        office=office,
        candidates=candidates[:3],
        excluded=excluded,
        evaluated_count=len(data.listings),
        matched_count=len(candidates),
    )
