# Travel Map Animator

This project provides a Python-based command line tool that converts an itinerary into a 1080p MP4 animation. The program renders a stylised world map that highlights only text labels for your waypoints and visible world capitals while animating a vehicle along the journey. A thin green line previews the remaining route and a red trail highlights the path already travelled. Custom vehicle icons are supported for cars, vans, buses, campervans, trains, planes and pedestrians.

## Features

- Configure any number of waypoints with per-stop pause durations.
- Adjustable vehicle speed (in km/h), frame rate, start and end pauses.
- 1080p MP4 export using an H.264 encoder.
- Stylised world backdrop with text labels for capitals inside the current viewport.
- Animated vehicle with heading-aware rotation plus green “next leg” guide and a red trail history.
- Fallback placeholder icons automatically generated when custom artwork is not supplied.

## Requirements

The project targets Python 3.10+. Install dependencies with:

```bash
pip install -r requirements.txt
```

Required packages include `matplotlib`, `numpy`, `Pillow` and `imageio` for video export. Optional YAML configuration is supported when `pyyaml` is installed.

## Usage

1. Prepare a configuration file (JSON or YAML). A ready-to-run example is available at [`travelmap/examples/sample_trip.json`](travelmap/examples/sample_trip.json).
2. Run the CLI, passing the configuration file path:

```bash
python -m travelmap.main travelmap/examples/sample_trip.json
```

The resulting video is written to the `output` path defined in your configuration file.

## Browser-based animator

A lightweight web interface is bundled in the [`web/`](web/) directory. Serve the folder with any static file server (for example `python -m http.server` from the repository root) and open `http://localhost:8000/web/` in your browser. The page lets you:

- Load an existing itinerary JSON file that matches the CLI configuration schema.
- Add or remove waypoints manually and adjust animation settings such as speed, frame rate and pauses.
- Upload a custom PNG vehicle icon and preview it instantly.
- Preview the animation directly on the page or record it to a downloadable WebM file using the browser's `MediaRecorder` API.

> **Note:** Downloading animations requires a browser that supports the Canvas `captureStream()` API and the `MediaRecorder` API (Chrome, Edge and Firefox). Safari currently allows previewing but not exporting.

### Configuration schema

| Field | Type | Description |
| --- | --- | --- |
| `title` | string | Optional title rendered at the top of the map. |
| `description` | string | Currently unused in the animation but available for metadata. |
| `speed_kmh` | number | Vehicle speed used to time segment durations. |
| `frame_rate` | integer | Frames per second for the exported MP4. |
| `pause_at_start` / `pause_at_end` | number | Seconds to pause before motion begins and after the final waypoint. |
| `margin_degrees` | number | Extra latitude/longitude padding added around all waypoints. |
| `vehicle.type` | string | Vehicle category (`car`, `van`, `bus`, `campervan`, `train`, `plane`, `pedestrian`). |
| `vehicle.icon` | string | Optional path to a custom PNG icon. Icons are rotated to match the current bearing. |
| `vehicle.icon_scale` | number | Relative scaling factor applied to the icon. |
| `waypoints` | list | Ordered list of stop dictionaries containing `name`, `lat`, `lon` and optional `pause` seconds. |
| `output` | string | MP4 path to write (parent directories are created automatically). |

### Custom icons

Provide a PNG file through the `vehicle.icon` config property for any supported vehicle type. The icon should be roughly square with transparent background and will be rotated each frame according to the current heading. When no icon is supplied, the program draws a themed circular placeholder featuring a letter or emoji representing the vehicle type.

### Capital city labels

A curated CSV of major world capitals is bundled with the tool. Only capitals inside the configured viewport are rendered and they appear as subtle text labels to avoid clutter. No other map text is shown, respecting the requirement that only waypoint and capital names are present on the map.

## Development notes

- The simplified continent shapes are intentionally low fidelity sketches to keep the repository lightweight while still providing contextual geography.
- 1080p output is achieved by fixing the matplotlib canvas to 1920×1080 pixels. The video writer uses `libx264` with a medium quality setting; adjust the `quality` parameter inside `travelmap/renderer.py` if needed.
- Frame generation uses great-circle interpolation to maintain realistic movement between distant waypoints.

## License

This project is provided as-is for demonstration purposes. Consult your media usage requirements before distributing generated animations that include external iconography.
