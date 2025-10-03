"""Rendering logic for producing animated travel map videos."""
from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

import imageio.v2 as imageio
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.offsetbox import AnnotationBbox, OffsetImage
import numpy as np

from .capitals import Capital, filter_capitals, load_capitals
from .config import AnimationConfig, Waypoint
from .geometry import bearing_degrees, haversine_km, interpolate_great_circle
from .icons import load_vehicle_icon, rotate_icon
from .map_shapes import iter_shapes

Coordinate = Tuple[float, float]
MILES_PER_KM = 0.621371
LITRES_PER_GALLON = 3.785411784


@dataclass
class FrameState:
    position: Coordinate
    traveled: List[Coordinate]
    upcoming: List[Coordinate]
    bearing: float
    show_summary: bool = False


@dataclass
class LegSummary:
    start_name: str
    end_name: str
    distance_miles: float
    fuel_price_per_litre: Optional[float]
    fuel_cost: Optional[float]


class TravelMapAnimator:
    """Create an animated travel map based on a configuration."""

    def __init__(self, config: AnimationConfig) -> None:
        self.config = config
        self._capitals: List[Capital] = load_capitals()
        self._vehicle_icon = load_vehicle_icon(config.vehicle)
        self._leg_summaries, self._total_distance_miles, self._total_fuel_cost = self._compute_leg_summaries(
            config.waypoints
        )
        self._summary_text_content = self._format_summary_text()
        self._frame_states = self._build_frames(config.waypoints)
        self._setup_canvas()

    # ------------------------------------------------------------------
    # Timeline construction
    # ------------------------------------------------------------------

    def _build_frames(self, waypoints: Sequence[Waypoint]) -> List[FrameState]:
        coords: List[Coordinate] = [(wp.latitude, wp.longitude) for wp in waypoints]
        frames: List[FrameState] = []
        fps = self.config.frame_rate

        traveled_points: List[Coordinate] = [coords[0]]

        def build_upcoming(segment_index: int, fraction: float, current_pos: Coordinate) -> List[Coordinate]:
            remaining: List[Coordinate] = [current_pos]
            if fraction < 1.0 and segment_index + 1 < len(coords):
                remaining.append(coords[segment_index + 1])
            for idx in range(segment_index + 1, len(coords) - 1):
                remaining.append(coords[idx + 1])
            return remaining

        def bearing_after(segment_index: int, position: Coordinate) -> float:
            # Determine the direction towards the next relevant point.
            if segment_index + 1 < len(coords):
                target = coords[segment_index + 1]
                if math.isclose(position[0], target[0], abs_tol=1e-6) and math.isclose(position[1], target[1], abs_tol=1e-6):
                    if segment_index + 2 < len(coords):
                        target = coords[segment_index + 2]
                return bearing_degrees(position, target)
            return 0.0

        # Optional pause at the start
        start_pause_frames = int(round(self.config.pause_at_start * fps))
        for _ in range(start_pause_frames):
            frames.append(
                FrameState(
                    position=coords[0],
                    traveled=list(traveled_points),
                    upcoming=build_upcoming(0, 0.0, coords[0]),
                    bearing=bearing_after(0, coords[0]),
                )
            )

        for segment_index, (start, end) in enumerate(zip(coords[:-1], coords[1:])):
            segment_distance = haversine_km(start, end)
            # Convert travel time to seconds using the configured speed.
            travel_seconds = 3600.0 * segment_distance / max(self.config.speed_kmh, 1e-6)
            frame_count = max(2, int(math.ceil(travel_seconds * fps)))

            for step in range(1, frame_count + 1):
                fraction = min(1.0, step / frame_count)
                position = interpolate_great_circle(start, end, fraction)

                traveled_points.append(position)
                frames.append(
                    FrameState(
                        position=position,
                        traveled=list(traveled_points),
                        upcoming=build_upcoming(segment_index, fraction, position),
                        bearing=bearing_after(segment_index, position),
                    )
                )
                traveled_points.pop()

            # Ensure the final waypoint is stored so that subsequent pauses use it.
            if traveled_points[-1] != end:
                traveled_points.append(end)

            pause_frames = int(round(waypoints[segment_index + 1].pause_seconds * fps))
            for _ in range(pause_frames):
                frames.append(
                    FrameState(
                        position=end,
                        traveled=list(traveled_points),
                        upcoming=build_upcoming(segment_index + 1, 0.0, end),
                        bearing=bearing_after(segment_index + 1, end),
                    )
                )

        end_pause_frames = int(round(self.config.pause_at_end * fps))
        if frames:
            final_state = frames[-1]
            for _ in range(end_pause_frames):
                frames.append(
                    FrameState(
                        position=final_state.position,
                        traveled=list(final_state.traveled),
                        upcoming=[],
                        bearing=final_state.bearing,
                    )
                )

        summary_frames = int(round(max(self.config.summary_display_seconds, 0.0) * fps))
        if frames and summary_frames > 0:
            final_state = frames[-1]
            for _ in range(summary_frames):
                frames.append(
                    FrameState(
                        position=final_state.position,
                        traveled=list(final_state.traveled),
                        upcoming=[],
                        bearing=final_state.bearing,
                        show_summary=True,
                    )
                )

        return frames

    # ------------------------------------------------------------------
    # Rendering helpers
    # ------------------------------------------------------------------

    def _compute_leg_summaries(
        self, waypoints: Sequence[Waypoint]
    ) -> Tuple[List[LegSummary], float, Optional[float]]:
        leg_summaries: List[LegSummary] = []
        total_distance = 0.0
        total_cost = 0.0
        cost_available = False
        mpg = self.config.vehicle.fuel_efficiency_mpg
        default_price = self.config.vehicle.fuel_price_per_litre

        for start, end in zip(waypoints[:-1], waypoints[1:]):
            distance_km = haversine_km((start.latitude, start.longitude), (end.latitude, end.longitude))
            distance_miles = distance_km * MILES_PER_KM
            total_distance += distance_miles

            price = start.fuel_price_per_litre if start.fuel_price_per_litre is not None else default_price
            fuel_cost: Optional[float] = None
            if mpg and mpg > 0 and price is not None:
                gallons_needed = distance_miles / mpg
                litres_needed = gallons_needed * LITRES_PER_GALLON
                fuel_cost = litres_needed * price
                total_cost += fuel_cost
                cost_available = True

            leg_summaries.append(
                LegSummary(
                    start_name=start.name,
                    end_name=end.name,
                    distance_miles=distance_miles,
                    fuel_price_per_litre=price,
                    fuel_cost=fuel_cost,
                )
            )

        return leg_summaries, total_distance, total_cost if cost_available else None

    def _format_summary_text(self) -> str:
        if not self._leg_summaries:
            return ""

        lines = ["Trip Summary"]
        for index, leg in enumerate(self._leg_summaries, start=1):
            line = f"{index}. {leg.start_name} → {leg.end_name}: {leg.distance_miles:.1f} mi"
            if leg.fuel_cost is not None:
                line += f" | est. cost {self.config.currency_symbol}{leg.fuel_cost:.2f}"
            elif (
                leg.fuel_price_per_litre is not None
                and self.config.vehicle.fuel_efficiency_mpg
                and self.config.vehicle.fuel_efficiency_mpg > 0
            ):
                line += (
                    f" | price {self.config.currency_symbol}{leg.fuel_price_per_litre:.2f}/L"
                )
            lines.append(line)

        lines.append(f"Total distance: {self._total_distance_miles:.1f} mi")
        if self._total_fuel_cost is not None:
            lines.append(
                f"Estimated fuel cost: {self.config.currency_symbol}{self._total_fuel_cost:.2f}"
            )

        mpg = self.config.vehicle.fuel_efficiency_mpg
        if mpg:
            lines.append(f"Vehicle efficiency: {mpg:.1f} mpg")

        return "\n".join(lines)

    def _setup_canvas(self) -> None:
        dpi = 100
        figsize = (self.config.width / dpi, self.config.height / dpi)
        self._fig, self._ax = plt.subplots(figsize=figsize, dpi=dpi)
        self._fig.patch.set_facecolor("#06142a")
        self._ax.set_facecolor("#0a1f3f")

        self._ax.set_xticks([])
        self._ax.set_yticks([])

        self._compute_limits()

        # Draw simplified land masses
        for shape in iter_shapes():
            lats = [lat for lat, _ in shape]
            lons = [lon for _, lon in shape]
            self._ax.fill(lons, lats, color="#12355b", alpha=0.6, linewidth=0)
            self._ax.plot(lons, lats, color="#0f2744", linewidth=1.0)

        # Plot capitals within the viewport as text labels
        if self.config.show_capitals:
            lat_min = min(self._lat_min, self._lat_max)
            lat_max = max(self._lat_min, self._lat_max)
            lon_min = min(self._lon_min, self._lon_max)
            lon_max = max(self._lon_min, self._lon_max)
            capitals = filter_capitals(self._capitals, lat_min, lat_max, lon_min, lon_max)
            for capital in capitals:
                self._ax.text(
                    capital.longitude,
                    capital.latitude,
                    capital.name,
                    fontsize=6,
                    color="#d5e5ff",
                    ha="center",
                    va="center",
                    alpha=0.8,
                )

        # Add waypoint labels
        for waypoint in self.config.waypoints:
            self._ax.text(
                waypoint.longitude,
                waypoint.latitude,
                waypoint.name,
                fontsize=9,
                fontweight="bold",
                color="#ffffff",
                ha="center",
                va="bottom",
            )

        if self.config.title:
            self._ax.set_title(self.config.title, color="white", fontsize=16, pad=16)

        # Prepare dynamic artists
        self._trail_line, = self._ax.plot([], [], color="#ff5555", linewidth=3, solid_capstyle="round")
        self._future_line, = self._ax.plot([], [], color="#66ff99", linewidth=1.5, linestyle="--", solid_capstyle="round")

        # Vehicle icon artist
        zoom = max(self.config.width, self.config.height) / 8000.0
        self._vehicle_image_box = OffsetImage(self._vehicle_icon, zoom=zoom)
        self._vehicle_artist = AnnotationBbox(
            self._vehicle_image_box,
            (self.config.waypoints[0].longitude, self.config.waypoints[0].latitude),
            frameon=False,
        )
        self._ax.add_artist(self._vehicle_artist)

        self._summary_text = self._ax.text(
            0.02,
            0.02,
            self._summary_text_content,
            transform=self._ax.transAxes,
            color="#ffffff",
            fontsize=10,
            ha="left",
            va="bottom",
            bbox=dict(facecolor="#000000", alpha=0.7, boxstyle="round,pad=0.5"),
            visible=False,
        )

        self._ax.set_xlim(self._lon_min, self._lon_max)
        self._ax.set_ylim(self._lat_min, self._lat_max)

        self._fig.tight_layout()

    def _compute_limits(self) -> None:
        lats = [wp.latitude for wp in self.config.waypoints]
        lons = [wp.longitude for wp in self.config.waypoints]
        margin = self.config.margin_degrees
        self._lat_min = min(lats) - margin
        self._lat_max = max(lats) + margin
        self._lon_min = min(lons) - margin
        self._lon_max = max(lons) + margin
        self._ax.set_xlim(self._lon_min, self._lon_max)
        self._ax.set_ylim(self._lat_min, self._lat_max)

    # ------------------------------------------------------------------
    # Frame drawing
    # ------------------------------------------------------------------

    def _draw_frame(self, frame: FrameState) -> None:
        if frame.traveled:
            traveled_lats = [lat for lat, lon in frame.traveled]
            traveled_lons = [lon for lat, lon in frame.traveled]
            self._trail_line.set_data(traveled_lons, traveled_lats)
        else:
            self._trail_line.set_data([], [])

        if frame.upcoming and len(frame.upcoming) >= 2:
            future_lats = [lat for lat, lon in frame.upcoming]
            future_lons = [lon for lat, lon in frame.upcoming]
            self._future_line.set_data(future_lons, future_lats)
        else:
            self._future_line.set_data([], [])

        rotated_icon = rotate_icon(self._vehicle_icon, frame.bearing)
        self._vehicle_image_box.set_data(rotated_icon)
        self._vehicle_artist.xy = (frame.position[1], frame.position[0])

        if frame.show_summary and self._summary_text_content:
            self._summary_text.set_text(self._summary_text_content)
            self._summary_text.set_visible(True)
        else:
            self._summary_text.set_visible(False)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def render(self) -> Path:
        output_path = Path(self.config.output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            writer_ctx = imageio.get_writer(
                output_path,
                fps=self.config.frame_rate,
                codec="libx264",
                format="FFMPEG",
                macro_block_size=None,
                quality=8,
            )
        except ImportError as exc:
            raise ImportError(
                "FFMPEG support is required to export videos. Install the "
                "'imageio-ffmpeg' package (for example via 'pip install "
                "imageio-ffmpeg') and try again."
            ) from exc

        with writer_ctx as writer:
            for frame in self._frame_states:
                self._draw_frame(frame)
                self._fig.canvas.draw()
                image = np.frombuffer(self._fig.canvas.tostring_argb(), dtype=np.uint8)
                width_px, height_px = self._fig.canvas.get_width_height()
                image = image.reshape((height_px, width_px, 4))
                # Convert ARGB to RGBA
                image = image[:, :, [1, 2, 3, 0]]
                writer.append_data(image)

        plt.close(self._fig)
        return output_path
