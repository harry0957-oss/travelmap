"""Simplified map shapes used to render a stylised world map."""
from __future__ import annotations

from typing import Dict, List, Sequence, Tuple

Coordinate = Tuple[float, float]

# The shapes below are stylised, intentionally low fidelity outlines intended to
# provide geographical context without the need for large shape files. They were
# sketched manually using coarse coordinates for each continent.

CONTINENT_SHAPES: Dict[str, List[Coordinate]] = {
    "north_america": [
        (83.0, -95.0),
        (70.0, -168.0),
        (50.0, -170.0),
        (23.0, -100.0),
        (7.0, -83.0),
        (18.0, -64.0),
        (32.0, -81.0),
        (50.0, -60.0),
        (60.0, -64.0),
        (70.0, -70.0),
        (83.0, -95.0),
    ],
    "south_america": [
        (12.0, -81.0),
        (5.0, -75.0),
        (-15.0, -75.0),
        (-33.0, -69.0),
        (-55.0, -67.0),
        (-55.0, -47.0),
        (-30.0, -40.0),
        (-12.0, -38.0),
        (4.0, -50.0),
        (12.0, -60.0),
        (12.0, -81.0),
    ],
    "europe_asia": [
        (72.0, -10.0),
        (70.0, 40.0),
        (55.0, 85.0),
        (50.0, 120.0),
        (58.0, 160.0),
        (50.0, 180.0),
        (10.0, 140.0),
        (5.0, 100.0),
        (25.0, 50.0),
        (35.0, 30.0),
        (45.0, 10.0),
        (60.0, -10.0),
        (72.0, -10.0),
    ],
    "africa": [
        (35.0, -17.0),
        (31.0, 30.0),
        (12.0, 43.0),
        (0.0, 46.0),
        (-25.0, 32.0),
        (-35.0, 20.0),
        (-35.0, 15.0),
        (-22.0, 11.0),
        (-5.0, 10.0),
        (16.0, -5.0),
        (20.0, -17.0),
        (35.0, -17.0),
    ],
    "australia": [
        (-11.0, 113.0),
        (-12.0, 129.0),
        (-23.0, 153.0),
        (-36.0, 149.0),
        (-43.0, 146.0),
        (-39.0, 135.0),
        (-34.0, 115.0),
        (-17.0, 113.0),
        (-11.0, 113.0),
    ],
    "antarctica": [
        (-60.0, -180.0),
        (-60.0, -90.0),
        (-60.0, 0.0),
        (-60.0, 90.0),
        (-60.0, 180.0),
        (-80.0, 180.0),
        (-80.0, -180.0),
        (-60.0, -180.0),
    ],
}


def iter_shapes() -> Sequence[List[Coordinate]]:
    """Yield the coordinate sets for each simplified shape."""

    return CONTINENT_SHAPES.values()
