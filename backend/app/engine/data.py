"""Load synthetic fixtures relative to this module, never the working directory."""

import csv
import os
from datetime import date
from pathlib import Path

from app.engine.models import Listing, Route

DEFAULT_DATA_DIR = Path(__file__).resolve().parents[3] / "data" / "demo"


def load_listings(data_dir: Path | None = None) -> list[Listing]:
    directory = data_dir or Path(os.getenv("REAL_RENT_DATA_DIR", str(DEFAULT_DATA_DIR)))
    routes: dict[tuple[str, str], Route | None] = {}
    with (directory / "commute_fixture.csv").open(encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            routes[(row["listing_id"], row["direction"])] = (
                Route(
                    minutes=int(row["minutes"]),
                    fare_krw=int(row["fare_krw"]),
                    transfers=int(row["transfers"]),
                    walk_minutes=int(row["walk_minutes"]),
                )
                if row["status"] == "ok"
                else None
            )

    with (directory / "listings.csv").open(encoding="utf-8-sig", newline="") as stream:
        return sorted(
            [
                Listing(
                    listing_id=row["listing_id"],
                    label=row["label"],
                    gu=row["gu"],
                    dong=row["dong"],
                    deposit_krw=int(row["deposit_krw"]),
                    monthly_rent_krw=int(row["monthly_rent_krw"]),
                    monthly_management_krw=(
                        int(row["monthly_management_krw"])
                        if row["monthly_management_krw"]
                        else None
                    ),
                    management_includes=tuple(filter(None, row["management_includes"].split("|"))),
                    move_in_available=date.fromisoformat(row["move_in_available"]),
                    lat=float(row["lat"]),
                    lng=float(row["lng"]),
                    outbound=routes.get((row["listing_id"], "outbound")),
                    back=routes.get((row["listing_id"], "return")),
                    price_basis=row["price_basis"],
                )
                for row in csv.DictReader(stream)
            ],
            key=lambda item: item.listing_id,
        )
