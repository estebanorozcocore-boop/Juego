"""UMBRAL 0.2 — a continuous, server-authoritative multiplayer world.
Run: pip install -r requirements.txt && python server.py
"""
from __future__ import annotations

import asyncio
import json
import math
import os
import random
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from aiohttp import WSMsgType, web

from map_manager import MAPS

ROOT = Path(__file__).resolve().parent
WIDTH, HEIGHT = MAPS.width, MAPS.height
VERSION = "0.2.0"
TICK_HZ, BROADCAST_HZ = 30, 15
PLAYER_SPEED = 225.0
PLAYER_RADIUS = 17.0
PLAYER_MAX_HP = 100
BASIC_RANGE, BASIC_ARC = 100.0, math.radians(88)
BASIC_DAMAGE, BASIC_COOLDOWN = 18, 0.48
POWER_RANGE, POWER_RADIUS = 320.0, 92.0
POWER_DAMAGE, POWER_COOLDOWN = 42, 3.4
MONSTER_RESPAWN = 9.0
MAX_CLIENTS = 80
SPAWN = (295.0, 580.0)


def clamp(x: float, low: float, high: float) -> float:
    return max(low, min(high, x))


def distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def normalized(x: float, y: float) -> tuple[float, float]:
    l = math.hypot(x, y)
    return (x / l, y / l) if l > 1e-8 else (0.0, 0.0)


def finite_coord(value, fallback: float) -> float:
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
        return float(value)
    return fallback


@dataclass
class Player:
    id: str
    name: str
    ws: web.WebSocketResponse
    x: float = SPAWN[0]
    y: float = SPAWN[1]
    hp: int = PLAYER_MAX_HP
    dx: float = 1.0
    dy: float = 0.0
    move_x: float = 0.0
    move_y: float = 0.0
    basic_ready: float = 0.0
    power_ready: float = 0.0
    dead_until: float = 0.0
    kills: int = 0
    last_input: float = field(default_factory=time.monotonic)
    joined: bool = False

    def public(self, now: float) -> dict:
        return {
            "id": self.id, "name": self.name,
            "x": round(self.x, 1), "y": round(self.y, 1),
            "hp": self.hp, "maxHp": PLAYER_MAX_HP,
            "dx": round(self.dx, 3), "dy": round(self.dy, 3),
            "basicRemaining": round(max(0, self.basic_ready - now), 2),
            "powerRemaining": round(max(0, self.power_ready - now), 2),
            "dead": self.hp <= 0, "kills": self.kills,
            "zoneId": MAPS.zone_at(self.x, self.y),
        }


@dataclass
class Monster:
    id: str
    kind: str
    home_x: float
    home_y: float
    x: float
    y: float
    hp: int
    max_hp: int
    speed: float
    detection: float
    attack: int
    reach: float = 48.0
    attack_ready: float = 0.0
    respawn_at: float = 0.0
    face_x: float = -1.0
    face_y: float = 0.0

    def public(self) -> dict:
        return {"id": self.id, "kind": self.kind, "x": round(self.x, 1),
                "y": round(self.y, 1), "hp": self.hp, "maxHp": self.max_hp,
                "detection": self.detection,
                "dx": round(self.face_x, 2), "dy": round(self.face_y, 2),
                "dead": self.hp <= 0, "zoneId": MAPS.zone_at(self.x, self.y)}


class World:
    def __init__(self):
        self.players: dict[str, Player] = {}
        self.monsters: list[Monster] = []
        self.events: list[dict] = []
        self.started = time.monotonic()
        # Every creature stays within a fixed territory centered on its home.
        seeds = [
            ("slime", 535, 330, 75, 85, 190, 8),
            ("slime", 665, 775, 75, 85, 195, 8),
            ("slime", 815, 505, 75, 85, 210, 8),
            ("wisp", 1100, 275, 58, 110, 240, 11),
            ("wisp", 1230, 730, 58, 110, 245, 11),
            ("slime", 1420, 410, 75, 85, 205, 8),
            ("golem", 1520, 905, 170, 58, 230, 17),
            ("golem", 1005, 930, 170, 58, 215, 17),
            ("sentinel", 2820, 390, 150, 66, 215, 15),
            ("shade", 3010, 690, 62, 125, 205, 10),
            ("shade", 3180, 230, 62, 125, 210, 10),
            ("sentinel", 3420, 640, 150, 66, 220, 15),
            ("shade", 3780, 750, 62, 125, 220, 10),
            ("sentinel", 3990, 640, 150, 66, 210, 15),
            ("shade", 3720, 190, 62, 125, 210, 10),
        ]
        for i, (kind, x, y, hp, speed, detection, damage) in enumerate(seeds):
            self.monsters.append(Monster(
                id=f"m{i + 1}", kind=kind, home_x=x, home_y=y,
                x=x, y=y, hp=hp, max_hp=hp, speed=speed,
                detection=detection, attack=damage))

    def spawn_player(self, ws: web.WebSocketResponse, name: str) -> Player:
        p = Player(id=uuid.uuid4().hex[:9], name=name, ws=ws)
        p.x += random.uniform(-26, 26)
        p.y += random.uniform(-26, 26)
        self.players[p.id] = p
        self.effects("join", p.x, p.y, name=p.name)
        return p

    def effects(self, kind: str, x: float, y: float, **extra) -> None:
        self.events.append({"kind": kind, "x": round(x, 1), "y": round(y, 1),
                            "zoneId": MAPS.zone_at(x, y), **extra})

    def hurt_monster(self, m: Monster, amount: int, actor: Player, now: float) -> None:
        if m.hp <= 0:
            return
        m.hp = max(0, m.hp - amount)
        self.effects("damage", m.x, m.y - 19, amount=amount, target=m.id)
        if m.hp == 0:
            m.respawn_at = now + MONSTER_RESPAWN
            actor.kills += 1
            self.effects("death", m.x, m.y, target=m.id)

    def hurt_player(self, p: Player, amount: int, now: float) -> None:
        if p.hp <= 0:
            return
        p.hp = max(0, p.hp - amount)
        self.effects("hurt", p.x, p.y - 21, amount=amount, target=p.id)
        if p.hp == 0:
            p.dead_until = now + 4.0
            p.move_x = p.move_y = 0
            self.effects("death", p.x, p.y, target=p.id)

    def attack_basic(self, p: Player, now: float) -> None:
        if p.hp <= 0 or now < p.basic_ready:
            return
        p.basic_ready = now + BASIC_COOLDOWN
        self.effects("slash", p.x, p.y, dx=p.dx, dy=p.dy)
        for m in self.monsters:
            if m.hp <= 0:
                continue
            vx, vy = m.x - p.x, m.y - p.y
            d = math.hypot(vx, vy)
            if d > BASIC_RANGE + 17 or d < 1e-5:
                continue
            dot = (vx * p.dx + vy * p.dy) / d
            if dot >= math.cos(BASIC_ARC * 0.5) and MAPS.line_of_sight(p.x, p.y, m.x, m.y):
                self.hurt_monster(m, BASIC_DAMAGE, p, now)

    def attack_power(self, p: Player, x: float, y: float, now: float) -> None:
        if p.hp <= 0 or now < p.power_ready:
            return
        vx, vy = x - p.x, y - p.y
        d = math.hypot(vx, vy)
        if d > POWER_RANGE:
            vx, vy = vx / d * POWER_RANGE, vy / d * POWER_RANGE
            x, y = p.x + vx, p.y + vy
        x, y = MAPS.cast_point(p.x, p.y, x, y)
        p.power_ready = now + POWER_COOLDOWN
        self.effects("nova", x, y, radius=POWER_RADIUS)
        for m in self.monsters:
            if (m.hp > 0 and distance((m.x, m.y), (x, y)) <= POWER_RADIUS + 16
                    and MAPS.line_of_sight(x, y, m.x, m.y)):
                self.hurt_monster(m, POWER_DAMAGE, p, now)

    def handle_action(self, p: Player, message: dict) -> None:
        now = time.monotonic()
        if not p.joined:
            return
        typ = message.get("type")
        if typ == "input":
            mx = clamp(finite_coord(message.get("mx"), 0), -1, 1)
            my = clamp(finite_coord(message.get("my"), 0), -1, 1)
            p.move_x, p.move_y = normalized(mx, my)
            ax = finite_coord(message.get("aimX"), p.x + p.dx)
            ay = finite_coord(message.get("aimY"), p.y + p.dy)
            dx, dy = normalized(ax - p.x, ay - p.y)
            if dx or dy:
                p.dx, p.dy = dx, dy
            p.last_input = now
        elif typ == "basic":
            self.attack_basic(p, now)
        elif typ == "power":
            x = finite_coord(message.get("x"), p.x)
            y = finite_coord(message.get("y"), p.y)
            self.attack_power(p, x, y, now)

    def tick(self, dt: float, now: float) -> None:
        for p in list(self.players.values()):
            if p.hp <= 0:
                if now >= p.dead_until:
                    p.hp = PLAYER_MAX_HP
                    p.x, p.y = MAPS.respawn_point(p.x, p.y)
                    self.effects("respawn", p.x, p.y, target=p.id)
                continue
            # Prevent a disconnected/frozen browser from drifting forever.
            if now - p.last_input < 0.5:
                p.x, p.y = MAPS.move(p.x, p.y, p.move_x * PLAYER_SPEED * dt,
                                    p.move_y * PLAYER_SPEED * dt, PLAYER_RADIUS)
        for m in self.monsters:
            if m.hp <= 0:
                if now >= m.respawn_at:
                    m.hp = m.max_hp
                    m.x, m.y = m.home_x, m.home_y
                    self.effects("respawn", m.x, m.y, target=m.id)
                continue
            targets = [p for p in self.players.values() if p.hp > 0 and
                       distance((p.x, p.y), (m.home_x, m.home_y)) <= m.detection]
            if not targets:
                # Territory-bound AI: it never pursues outside its detection domain.
                self.move_toward(m, m.home_x, m.home_y, dt)
                continue
            target = min(targets, key=lambda p: distance((p.x, p.y), (m.x, m.y)))
            d = distance((m.x, m.y), (target.x, target.y))
            if d > m.reach:
                self.move_toward(m, target.x, target.y, dt)
            elif now >= m.attack_ready and MAPS.line_of_sight(m.x, m.y, target.x, target.y):
                m.attack_ready = now + (1.6 if m.kind in ("golem", "sentinel") else 1.2)
                self.effects("monster_attack", m.x, m.y, tx=target.x, ty=target.y)
                self.hurt_player(target, m.attack, now)

    @staticmethod
    def move_toward(m: Monster, x: float, y: float, dt: float) -> None:
        dx, dy = x - m.x, y - m.y
        d = math.hypot(dx, dy)
        if d > 1:
            nx, ny = dx / d, dy / d
            step = min(d, m.speed * dt)
            m.x, m.y = MAPS.move(m.x, m.y, nx * step, ny * step, 17)
            m.face_x, m.face_y = nx, ny

    def drain_events(self) -> list[dict]:
        events, self.events = self.events[-150:], []
        return events

    def snapshot(self, now: float, viewer: Optional[Player] = None,
                 events: Optional[list[dict]] = None) -> dict:
        # Explicit events let a broadcast drain once, then reuse the same batch
        # for every recipient. The optional viewer retains a full diagnostic view.
        if events is None:
            events = self.drain_events()
        relevant = MAPS.relevant_zones(viewer.x, viewer.y) if viewer else list(MAPS.zones)
        zone_id = MAPS.zone_at(viewer.x, viewer.y) if viewer else "forest"
        zone = MAPS.zones[zone_id]
        joined = [p for p in self.players.values() if p.joined]
        zone_counts = {zid: 0 for zid in MAPS.zones}
        for p in joined:
            zone_counts[MAPS.zone_at(p.x, p.y)] += 1
        return {
            "type": "state", "serverTime": round(now, 3),
            "map": {**zone, "width": zone["bounds"]["width"], "height": zone["bounds"]["height"]},
            "world": {"width": WIDTH, "height": HEIGHT, "online": len(joined), "mapCount": 2},
            "relevantZones": relevant, "zoneCounts": zone_counts,
            "players": [p.public(now) for p in joined if MAPS.zone_at(p.x, p.y) in relevant],
            "monsters": [m.public() for m in self.monsters if MAPS.zone_at(m.x, m.y) in relevant],
            "events": [event for event in events if event["zoneId"] in relevant],
        }


WORLD = World()
WORLD_KEY = web.AppKey("world", World)


async def websocket_handler(request: web.Request) -> web.WebSocketResponse:
    world = request.app[WORLD_KEY]
    ws = web.WebSocketResponse(heartbeat=20, max_msg_size=2_048)
    await ws.prepare(request)
    p: Optional[Player] = None
    try:
        async for incoming in ws:
            if incoming.type != WSMsgType.TEXT:
                continue
            try:
                data = json.loads(incoming.data)
                if not isinstance(data, dict):
                    continue
            except (ValueError, TypeError):
                continue
            if p is None:
                if data.get("type") != "join":
                    continue
                if len(world.players) >= MAX_CLIENTS:
                    await ws.send_json({"type": "error", "message": "El mundo está lleno."})
                    await ws.close()
                    break
                raw_name = data.get("name", "Explorador")
                name = "".join(c for c in str(raw_name) if c.isprintable()).strip()[:18] or "Explorador"
                p = world.spawn_player(ws, name)
                p.joined = True
                await ws.send_json({"type": "welcome", "id": p.id, "world": "umbral", "manifest": MAPS.manifest()})
            else:
                world.handle_action(p, data)
    finally:
        if p is not None:
            world.players.pop(p.id, None)
            world.effects("leave", p.x, p.y, name=p.name)
    return ws


async def simulation(app: web.Application) -> None:
    # Single asyncio event loop owns all world mutations, avoiding race conditions.
    delta_target = 1 / TICK_HZ
    broadcast_every = 1 / BROADCAST_HZ
    prev = time.monotonic()
    next_broadcast = prev
    world = app[WORLD_KEY]
    try:
        while True:
            before = time.monotonic()
            dt = min(before - prev, 0.10)
            prev = before
            world.tick(dt, before)
            if before >= next_broadcast:
                next_broadcast = before + broadcast_every
                events = world.drain_events()
                peers = [p for p in world.players.values() if p.joined and not p.ws.closed]
                if peers:
                    await asyncio.gather(*(
                        p.ws.send_str(json.dumps(world.snapshot(before, p, events), separators=(",", ":")))
                        for p in peers), return_exceptions=True)
            elapsed = time.monotonic() - before
            await asyncio.sleep(max(0.001, delta_target - elapsed))
    except asyncio.CancelledError:
        return


async def start_simulation(app: web.Application):
    task = asyncio.create_task(simulation(app))
    yield
    task.cancel()
    await task


async def map_asset(request: web.Request) -> web.Response:
    zone = MAPS.assets.get(request.match_info["zone_id"])
    if zone is None:
        raise web.HTTPNotFound(text="Zona desconocida")
    return web.json_response(zone, headers={"Cache-Control": "public, max-age=300"})


async def health(request: web.Request) -> web.Response:
    world = request.app[WORLD_KEY]
    return web.json_response({"status": "ok", "version": VERSION, "world": "umbral",
                              "players": len(world.players), "maps": 2, "zones": len(MAPS.zones)})


async def index(request: web.Request) -> web.FileResponse:
    return web.FileResponse(ROOT / "static" / "index.html")


def make_app(world: Optional[World] = None):
    app = web.Application()
    app[WORLD_KEY] = WORLD if world is None else world
    app.router.add_get("/ws", websocket_handler)
    app.router.add_get("/health", health)
    app.router.add_get("/maps/{zone_id}.json", map_asset)
    app.router.add_get("/", index)
    app.router.add_static("/", path=ROOT / "static", show_index=True)
    app.cleanup_ctx.append(start_simulation)
    return app


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    print(f"UMBRAL {VERSION}: http://localhost:{port}", flush=True)
    web.run_app(make_app(), host="0.0.0.0", port=port, print=None)
