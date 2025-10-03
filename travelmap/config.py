"""Configuration loading utilities for the travel map animator."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional
import json


LITRES_PER_GALLON = 3.785411784


@dataclass
class Waypoint:
    """A single waypoint in the itinerary."""

    name: str
    latitude: float
    longitude: float
    pause_seconds: float = 0.0
    fuel_price_per_litre: Optional[float] = None

    @staticmethod
    def from_mapping(data: Dict[str, Any]) -> "Waypoint":
        try:
            name = data["name"]
            latitude = float(data["lat"] if "lat" in data else data["latitude"])
            longitude = float(data["lon"] if "lon" in data else data["longitude"])
        except KeyError as exc:  # pragma: no cover - defensive branch
            raise ValueError(f"Waypoint configuration missing field: {exc.args[0]}") from exc
        pause = float(data.get("pause", data.get("pause_seconds", 0.0)))
        fuel_price = None
        if "fuel_price_per_litre" in data:
            fuel_price = data["fuel_price_per_litre"]
        elif "fuel_price_per_liter" in data:
            fuel_price = data["fuel_price_per_liter"]
        elif "fuel_price_per_gallon" in data:
            fuel_price = float(data["fuel_price_per_gallon"]) / LITRES_PER_GALLON
        elif "fuel_price" in data:
            base_price = float(data["fuel_price"])
            fuel_price = base_price / LITRES_PER_GALLON
        if fuel_price is not None:
            fuel_price = float(fuel_price)
        return Waypoint(
            name=name,
            latitude=latitude,
            longitude=longitude,
            pause_seconds=pause,
            fuel_price_per_litre=fuel_price,
        )


@dataclass
class VehicleConfig:
    """Configuration for how the vehicle should be rendered."""

    type: str = "car"
    icon_path: Optional[Path] = None
    icon_scale: float = 1.0
    fuel_efficiency_mpg: Optional[float] = None
    fuel_price_per_litre: Optional[float] = None

    @staticmethod
    def from_mapping(data: Optional[Dict[str, Any]]) -> "VehicleConfig":
        if not data:
            return VehicleConfig()
        icon_path = data.get("icon") or data.get("icon_path")
        return VehicleConfig(
            type=data.get("type", "car"),
            icon_path=Path(icon_path) if icon_path else None,
            icon_scale=float(data.get("icon_scale", 1.0)),
            fuel_efficiency_mpg=(
                float(data["fuel_efficiency_mpg"])
                if "fuel_efficiency_mpg" in data
                else float(data["mpg"]) if "mpg" in data else None
            ),
            fuel_price_per_litre=(
                float(data["fuel_price_per_litre"])
                if "fuel_price_per_litre" in data
                else float(data["fuel_price_per_liter"])
                if "fuel_price_per_liter" in data
                else float(data["fuel_price_per_gallon"]) / LITRES_PER_GALLON
                if "fuel_price_per_gallon" in data
                else float(data["fuel_price"]) / LITRES_PER_GALLON
                if "fuel_price" in data
                else None
            ),
        )


@dataclass
class AnimationConfig:
    """Top-level configuration for an animation."""

    title: str = ""
    description: Optional[str] = None
    speed_kmh: float = 80.0
    frame_rate: int = 30
    output_path: Path = Path("travelmap.webm")
    width: int = 1920
    height: int = 1080
    margin_degrees: float = 5.0
    waypoints: List[Waypoint] = field(default_factory=list)
    vehicle: VehicleConfig = field(default_factory=VehicleConfig)
    show_capitals: bool = True
    pause_at_start: float = 0.0
    pause_at_end: float = 1.0
    currency_symbol: str = "$"
    summary_display_seconds: float = 2.0

    @staticmethod
    def from_mapping(data: Dict[str, Any]) -> "AnimationConfig":
        waypoints_data = data.get("waypoints") or []
        if not isinstance(waypoints_data, Iterable) or isinstance(waypoints_data, (str, bytes)):
            raise ValueError("Waypoints must be provided as a list of mappings.")

        waypoints = [Waypoint.from_mapping(item) for item in waypoints_data]
        if len(waypoints) < 2:
            raise ValueError("At least two waypoints are required to build an itinerary.")

        output_path = data.get("output") or data.get("output_path") or "travelmap.webm"

        return AnimationConfig(
            title=data.get("title", ""),
            description=data.get("description"),
            speed_kmh=float(data.get("speed_kmh", data.get("speed", 80.0))),
            frame_rate=int(data.get("frame_rate", data.get("fps", 30))),
            output_path=Path(output_path),
            width=int(data.get("width", 1920)),
            height=int(data.get("height", 1080)),
            margin_degrees=float(data.get("margin_degrees", data.get("margin", 5.0))),
            waypoints=waypoints,
            vehicle=VehicleConfig.from_mapping(data.get("vehicle")),
            show_capitals=bool(data.get("show_capitals", True)),
            pause_at_start=float(data.get("pause_at_start", 0.0)),
            pause_at_end=float(data.get("pause_at_end", 1.0)),
            currency_symbol=str(data.get("currency_symbol", data.get("currency", "$"))),
            summary_display_seconds=float(data.get("summary_display_seconds", 2.0)),
        )


def _load_yaml(path: Path) -> Dict[str, Any]:
    try:  # pragma: no cover - optional dependency
        import yaml  # type: ignore
    except Exception as exc:  # pragma: no cover - optional dependency
        raise RuntimeError(
            "YAML configuration requested but PyYAML is not available. Install with 'pip install pyyaml'."
        ) from exc
    with path.open("r", encoding="utf8") as handle:
        return yaml.safe_load(handle)  # type: ignore[no-any-return]


def load_config(path: Path) -> AnimationConfig:
    """Load an :class:`AnimationConfig` from a JSON or YAML file."""

    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(path)

    if path.suffix.lower() in {".yaml", ".yml"}:
        raw = _load_yaml(path)
    else:
        with path.open("r", encoding="utf8") as handle:
            raw = json.load(handle)

    if not isinstance(raw, dict):
        raise ValueError("Configuration file must contain a mapping at the top level.")

    return AnimationConfig.from_mapping(raw)
