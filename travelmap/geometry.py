"""Geospatial utility helpers for the travel map animation."""
from __future__ import annotations

import math
from typing import List, Sequence, Tuple

Coordinate = Tuple[float, float]


EARTH_RADIUS_KM = 6371.0088


def haversine_km(a: Coordinate, b: Coordinate) -> float:
    """Compute the great-circle distance between two lat/lon points in kilometres."""

    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    delta_lat = lat2 - lat1
    delta_lon = lon2 - lon1
    sin_lat = math.sin(delta_lat / 2.0)
    sin_lon = math.sin(delta_lon / 2.0)
    h = sin_lat**2 + math.cos(lat1) * math.cos(lat2) * sin_lon**2
    central_angle = 2.0 * math.asin(min(1.0, math.sqrt(h)))
    return EARTH_RADIUS_KM * central_angle


def interpolate_great_circle(a: Coordinate, b: Coordinate, fraction: float) -> Coordinate:
    """Interpolate along the great-circle path between two coordinates."""

    if fraction <= 0.0:
        return a
    if fraction >= 1.0:
        return b

    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)

    delta = 2.0 * math.asin(
        math.sqrt(
            math.sin((lat2 - lat1) / 2.0) ** 2
            + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2.0) ** 2
        )
    )

    if delta == 0.0:
        return a

    sin_delta = math.sin(delta)
    factor_a = math.sin((1 - fraction) * delta) / sin_delta
    factor_b = math.sin(fraction * delta) / sin_delta

    x = factor_a * math.cos(lat1) * math.cos(lon1) + factor_b * math.cos(lat2) * math.cos(lon2)
    y = factor_a * math.cos(lat1) * math.sin(lon1) + factor_b * math.cos(lat2) * math.sin(lon2)
    z = factor_a * math.sin(lat1) + factor_b * math.sin(lat2)

    lat = math.atan2(z, math.sqrt(x**2 + y**2))
    lon = math.atan2(y, x)

    return math.degrees(lat), math.degrees(lon)


def bearing_degrees(a: Coordinate, b: Coordinate) -> float:
    """Return the initial bearing from coordinate ``a`` to coordinate ``b`` in degrees."""

    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    delta_lon = lon2 - lon1
    x = math.sin(delta_lon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(delta_lon)
    bearing = math.degrees(math.atan2(x, y))
    return (bearing + 360.0) % 360.0


def cumulative_distances(points: Sequence[Coordinate]) -> List[float]:
    """Return cumulative travel distance along a sequence of coordinates."""

    distances: List[float] = [0.0]
    for start, end in zip(points[:-1], points[1:]):
        distances.append(distances[-1] + haversine_km(start, end))
    return distances
