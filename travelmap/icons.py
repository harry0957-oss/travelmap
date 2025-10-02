"""Helpers for loading and generating vehicle icons."""
from __future__ import annotations

from pathlib import Path
from typing import Dict

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .config import VehicleConfig


_ICON_COLOURS: Dict[str, str] = {
    "car": "#1f77b4",
    "van": "#8c564b",
    "bus": "#9467bd",
    "campervan": "#2ca02c",
    "train": "#d62728",
    "plane": "#17becf",
    "pedestrian": "#ff7f0e",
}

_ICON_LETTERS: Dict[str, str] = {
    "car": "C",
    "van": "V",
    "bus": "B",
    "campervan": "RV",
    "train": "T",
    "plane": "✈",
    "pedestrian": "🚶",
}


def _generate_placeholder(vehicle_type: str, size: int = 96) -> Image.Image:
    colour = _ICON_COLOURS.get(vehicle_type, "#444444")
    letter = _ICON_LETTERS.get(vehicle_type, vehicle_type[:1].upper())
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.ellipse([(0, 0), (size - 1, size - 1)], fill=colour)

    font = ImageFont.load_default()
    text_bbox = draw.textbbox((0, 0), letter, font=font)
    text_width = text_bbox[2] - text_bbox[0]
    text_height = text_bbox[3] - text_bbox[1]
    draw.text(
        ((size - text_width) / 2.0, (size - text_height) / 2.0),
        letter,
        font=font,
        fill="white",
    )
    return image


def load_vehicle_icon(config: VehicleConfig, base_size: int = 128) -> np.ndarray:
    """Return a numpy array containing the RGBA icon for the selected vehicle."""

    if config.icon_path and Path(config.icon_path).exists():
        image = Image.open(config.icon_path).convert("RGBA")
    else:
        image = _generate_placeholder(config.type, size=base_size)

    if config.icon_scale != 1.0:
        scaled_size = max(16, int(round(base_size * config.icon_scale)))
        image = image.resize((scaled_size, scaled_size), Image.LANCZOS)

    return np.array(image)


def rotate_icon(icon: np.ndarray, bearing: float) -> np.ndarray:
    """Rotate the icon array so that it faces the given bearing."""

    image = Image.fromarray(icon, mode="RGBA")
    rotated = image.rotate(-bearing, resample=Image.BICUBIC, expand=True)
    return np.array(rotated)
