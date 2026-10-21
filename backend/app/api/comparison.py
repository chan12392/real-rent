from fastapi import APIRouter, HTTPException

from app.db.demo import load_demo_data
from app.domain.comparison import compare_listings
from app.schemas.comparison import ComparisonRequest, ComparisonResponse, DemoCatalog, DemoData

router = APIRouter(tags=["comparison"])


def _read_demo() -> DemoData:
    try:
        return load_demo_data()
    except (OSError, ValueError) as error:
        raise HTTPException(status_code=503, detail="시연 데이터를 읽을 수 없습니다.") from error


@router.get("/demo/catalog", response_model=DemoCatalog)
def get_demo_catalog() -> DemoCatalog:
    return _read_demo()


@router.post("/compare", response_model=ComparisonResponse)
def compare(conditions: ComparisonRequest) -> ComparisonResponse:
    data = _read_demo()
    try:
        return compare_listings(conditions, data)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
