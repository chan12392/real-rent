"""HTTP adapter over synthetic fixtures and the pure engine."""

from dataclasses import asdict
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.exceptions import RequestValidationError

from app.api.schemas import (
    AskRequest,
    AskResponse,
    CompareRequest,
    CompareResponse,
    ListingsResponse,
    LivingRequest,
)
from app.engine.calc import compare
from app.engine.data import load_listings
from app.engine.living import LIVING_ASSUMPTIONS, LivingOptions
from app.engine.models import ASSUMPTIONS, Conditions, Listing
from app.engine.qa import answer_question

router = APIRouter(tags=["listings"])


def get_data() -> list[Listing]:
    return load_listings()


Fixtures = Annotated[list[Listing], Depends(get_data)]


@router.get("/listings", response_model=ListingsResponse)
def get_listings(items: Fixtures) -> dict:
    listings = []
    for item in items:
        listing = asdict(item)
        listing["return"] = listing.pop("back")
        listing.pop("price_basis")
        listings.append(listing)
    return {
        "synthetic": True,
        "assumptions": list(ASSUMPTIONS),
        "price_basis": items[0].price_basis if items else "가정값(실거래 미조회)",
        "listings": listings,
    }


@router.post("/compare", response_model=CompareResponse)
def post_compare(request: CompareRequest, items: Fixtures) -> dict:
    known_ids = {item.listing_id for item in items}
    unknown_ids = set(request.management_overrides) - known_ids
    if unknown_ids:
        raise RequestValidationError(
            [
                {
                    "type": "value_error",
                    "loc": ("body", "management_overrides", listing_id),
                    "msg": "알 수 없는 매물 ID입니다.",
                    "input": request.management_overrides[listing_id],
                }
                for listing_id in sorted(unknown_ids)
            ]
        )
    conditions = Conditions(**request.model_dump(exclude={"living"}))
    options = LivingOptions(**(request.living or LivingRequest()).model_dump())
    result = compare(items, conditions, living=options)
    result["assumptions"].extend(LIVING_ASSUMPTIONS)
    if request.living is not None:
        result["conditions"]["living"] = {
            **asdict(options),
            "move_in_month": options.move_in_month or conditions.move_in_by.month,
        }
    return result


@router.post("/ask", response_model=AskResponse)
def post_ask(request: AskRequest, items: Fixtures) -> dict:
    return answer_question(request.question, items, request.listing_id)
