"""UMBRAL's map catalogue, continuous geometry and spatial subscriptions.

Positions are global throughout the world. A zone change is metadata only: the
same player and WebSocket continue across the shared edges of these rectangles.
"""
from __future__ import annotations

import math


class MapManager:
    width = 4200
    height = 1120
    interest_radius = 900.0

    def __init__(self):
        self.zones = {
            "forest": {
                "id": "forest", "name": "Bosque del Umbral", "kind": "forest", "index": 0,
                "bounds": {"x": 0, "y": 0, "width": 1800, "height": 1120},
                "spawn": {"x": 295, "y": 580}, "assetUrl": "/maps/forest.json",
            },
            "corridor": {
                "id": "corridor", "name": "Paso de las Raíces", "kind": "corridor", "index": 1,
                "bounds": {"x": 1800, "y": 440, "width": 600, "height": 240},
                "spawn": {"x": 2100, "y": 580}, "assetUrl": "/maps/corridor.json",
            },
            "ruins": {
                "id": "ruins", "name": "Ruinas del Alba", "kind": "ruins", "index": 2,
                "bounds": {"x": 2400, "y": 0, "width": 1800, "height": 1120},
                "spawn": {"x": 2500, "y": 580}, "assetUrl": "/maps/ruins.json",
            },
        }
        self.connections = [{"from": "forest", "via": "corridor", "to": "ruins"}]
        self.obstacles = [
            {"x": 2590, "y": 190, "width": 210, "height": 170},
            {"x": 2900, "y": 270, "width": 110, "height": 170},
            {"x": 3310, "y": 160, "width": 300, "height": 180},
            {"x": 3850, "y": 260, "width": 160, "height": 190},
            {"x": 2680, "y": 770, "width": 160, "height": 200},
            {"x": 3090, "y": 790, "width": 270, "height": 130},
            {"x": 3550, "y": 740, "width": 120, "height": 250},
            {"x": 3900, "y": 840, "width": 170, "height": 150},
        ]
        self.voids = [
            {"x": 1800, "y": 0, "width": 600, "height": 440},
            {"x": 1800, "y": 680, "width": 600, "height": 440},
        ]
        self.assets = {
            "forest": {
                **self.zones["forest"], "seed": 71821,
                "palette": {"ground": "#172f26", "alternate": "#203b2b", "path": "#5b5841", "accent": "#94bb77"},
                "obstacles": [], "decorations": [],
                "description": "Un bosque vivo custodiado por limos, fuegos fatuos y gólems.",
            },
            "corridor": {
                **self.zones["corridor"], "seed": 9281,
                "palette": {"ground": "#27332e", "alternate": "#344239", "path": "#696452", "accent": "#b7c4a0"},
                "obstacles": [], "decorations": [],
                "description": "Un paso continuo entre el bosque y las ruinas.",
            },
            "ruins": {
                **self.zones["ruins"], "seed": 48217,
                "palette": {"ground": "#242c3b", "alternate": "#303d4e", "path": "#686b76", "accent": "#c3b3ec"},
                "obstacles": self.obstacles, "decorations": [],
                "description": "Patios de piedra entre muros rotos, centinelas y sombras.",
            },
        }

    def manifest(self) -> dict:
        return {"width": self.width, "height": self.height,
                "zones": [{**zone, "obstacles": self.assets[zone_id]["obstacles"]}
                          for zone_id, zone in self.zones.items()],
                "connections": self.connections}

    def zone_at(self, x: float, y: float) -> str:
        # Shared edges belong to the zone being entered from the west.
        for zone_id in ("ruins", "corridor", "forest"):
            b = self.zones[zone_id]["bounds"]
            if b["x"] <= x <= b["x"] + b["width"] and b["y"] <= y <= b["y"] + b["height"]:
                return zone_id
        # Only used for cosmetic events offset just beyond a walkable boundary.
        return min(self.zones, key=lambda zid: self.distance_to_zone(x, y, zid))

    def distance_to_zone(self, x: float, y: float, zone_id: str) -> float:
        b = self.zones[zone_id]["bounds"]
        dx = max(b["x"] - x, 0, x - b["x"] - b["width"])
        dy = max(b["y"] - y, 0, y - b["y"] - b["height"])
        return math.hypot(dx, dy)

    def relevant_zones(self, x: float, y: float) -> list[str]:
        return [zid for zid in self.zones
                if self.distance_to_zone(x, y, zid) <= self.interest_radius]

    @staticmethod
    def circle_hits_rect(x: float, y: float, radius: float, rect: dict) -> bool:
        left, top = rect["x"], rect["y"]
        right, bottom = left + rect["width"], top + rect["height"]
        if radius == 0:
            return left < x < right and top < y < bottom
        near_x, near_y = max(left, min(right, x)), max(top, min(bottom, y))
        return (x - near_x) ** 2 + (y - near_y) ** 2 < radius ** 2 - 1e-8

    def walkable(self, x: float, y: float, radius: float = 17.0) -> bool:
        if not (radius <= x <= self.width - radius and radius <= y <= self.height - radius):
            return False
        return not any(self.circle_hits_rect(x, y, radius, rect)
                       for rect in self.voids + self.obstacles)

    def move(self, x: float, y: float, dx: float, dy: float, radius: float = 17.0) -> tuple[float, float]:
        """Sweep short substeps and slide along walls without crossing thin solids."""
        count = max(1, math.ceil(math.hypot(dx, dy) / max(1, radius * .45)))
        sx, sy = dx / count, dy / count
        for _ in range(count):
            if self.walkable(x + sx, y + sy, radius):
                x, y = x + sx, y + sy
                continue
            if self.walkable(x + sx, y, radius):
                x += sx
            if self.walkable(x, y + sy, radius):
                y += sy
        return x, y

    @staticmethod
    def segment_hits_rect(ax: float, ay: float, bx: float, by: float, rect: dict) -> bool:
        low, high = 0.0, 1.0
        for start, delta, near, far in (
            (ax, bx - ax, rect["x"], rect["x"] + rect["width"]),
            (ay, by - ay, rect["y"], rect["y"] + rect["height"]),
        ):
            if abs(delta) < 1e-9:
                if start <= near or start >= far:
                    return False
                continue
            entry, leave = sorted(((near - start) / delta, (far - start) / delta))
            low, high = max(low, entry), min(high, leave)
            if low >= high:
                return False
        return high > 0 and low < 1

    def line_of_sight(self, ax: float, ay: float, bx: float, by: float) -> bool:
        return (self.walkable(ax, ay, 0) and self.walkable(bx, by, 0)
                and not any(self.segment_hits_rect(ax, ay, bx, by, rect)
                            for rect in self.voids + self.obstacles))

    def cast_point(self, ax: float, ay: float, bx: float, by: float) -> tuple[float, float]:
        """Stop a targeted spell at the first boundary or wall along its cast."""
        steps = max(1, math.ceil(math.hypot(bx - ax, by - ay) / 4))
        px, py = ax, ay
        for i in range(1, steps + 1):
            x, y = ax + (bx - ax) * i / steps, ay + (by - ay) * i / steps
            if not self.walkable(x, y, 1):
                break
            px, py = x, y
        return px, py

    def respawn_point(self, x: float, y: float) -> tuple[float, float]:
        zone_id = self.zone_at(x, y)
        if zone_id == "corridor":
            zone_id = "forest" if x < 2100 else "ruins"
        spawn = self.zones[zone_id]["spawn"]
        return float(spawn["x"]), float(spawn["y"])


MAPS = MapManager()
