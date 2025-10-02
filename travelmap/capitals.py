"""Utility helpers for loading world capital locations."""
from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import List, Sequence


@dataclass
class Capital:
    country: str
    name: str
    latitude: float
    longitude: float


_DATA_PATH = Path(__file__).resolve().parent / "data" / "capitals.csv"


def load_capitals() -> List[Capital]:
    capitals: List[Capital] = []
    with _DATA_PATH.open("r", encoding="utf8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            capitals.append(
                Capital(
                    country=row["country"],
                    name=row["capital"],
                    latitude=float(row["latitude"]),
                    longitude=float(row["longitude"]),
                )
            )
    return capitals


def filter_capitals(capitals: Sequence[Capital], lat_min: float, lat_max: float, lon_min: float, lon_max: float) -> List[Capital]:
    """Return the capitals that fall within the provided bounding box."""

    filtered: List[Capital] = []
    for capital in capitals:
        if lat_min <= capital.latitude <= lat_max and lon_min <= capital.longitude <= lon_max:
            filtered.append(capital)
    return filtered
