"""Command line entry point for the travel map animator."""
from __future__ import annotations

import argparse
from pathlib import Path
from typing import Optional

from .config import load_config
from .renderer import TravelMapAnimator


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate an animated travel map video.")
    parser.add_argument(
        "config",
        type=Path,
        help="Path to the JSON or YAML configuration file containing waypoints.",
    )
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> None:
    args = parse_args(argv)
    animation_config = load_config(args.config)
    animator = TravelMapAnimator(animation_config)
    output_path = animator.render()
    print(f"Saved animation to {output_path}")


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    main()
