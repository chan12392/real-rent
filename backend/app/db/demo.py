from pathlib import Path

from app.schemas.comparison import DemoData

DEMO_PATH = Path(__file__).resolve().parents[3] / "data" / "demo" / "listings.json"


def load_demo_data() -> DemoData:
    return DemoData.model_validate_json(DEMO_PATH.read_text(encoding="utf-8"))
