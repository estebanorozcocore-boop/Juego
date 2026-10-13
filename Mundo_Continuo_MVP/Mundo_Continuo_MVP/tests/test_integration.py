"""Real WebSocket acceptance test on an isolated, ephemeral aiohttp server.

Run with ``python -m unittest discover -s tests -v``. No running game is needed
and the test never connects to port 8000. The journey takes about 45 seconds,
using ordinary input messages and the real 30 Hz simulation throughout.
"""
import asyncio
import contextlib
import json
import math
from pathlib import Path
import sys
import time
import unittest

from aiohttp import ClientSession, WSMsgType, web

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class Explorer:
    """Continuously drain a socket, so both clients observe the live simulation."""
    def __init__(self, ws, welcome):
        self.ws = ws
        self.welcome = welcome
        self.id = welcome["id"]
        self.state = None
        self.history = []
        self.events = []
        self.sequence = 0
        self.changed = asyncio.Condition()
        self.reader = asyncio.create_task(self.read())

    @classmethod
    async def join(cls, session, base, name):
        ws = await session.ws_connect(base + "/ws")
        await ws.send_json({"type": "join", "name": name})
        message = await asyncio.wait_for(ws.receive(), 3)
        assert message.type == WSMsgType.TEXT, message
        welcome = json.loads(message.data)
        assert welcome["type"] == "welcome", welcome
        explorer = cls(ws, welcome)
        await explorer.until(lambda state: any(p["id"] == explorer.id for p in state["players"]))
        return explorer

    @property
    def player(self):
        return next(p for p in self.state["players"] if p["id"] == self.id)

    async def read(self):
        async for message in self.ws:
            if message.type != WSMsgType.TEXT:
                continue
            value = json.loads(message.data)
            if value.get("type") == "state":
                async with self.changed:
                    self.state = value
                    self.history.append(value)
                    self.events.extend(value["events"])
                    self.sequence += 1
                    self.changed.notify_all()

    async def until(self, predicate, timeout=4):
        async def wait():
            async with self.changed:
                await self.changed.wait_for(lambda: self.state is not None and predicate(self.state))
            return self.state
        return await asyncio.wait_for(wait(), timeout)

    async def next_state(self):
        sequence = self.sequence
        return await self.until(lambda _: self.sequence > sequence)

    async def input(self, mx=0, my=0, aim=None):
        x, y = aim or (self.player["x"] + 100, self.player["y"])
        await self.ws.send_json({"type": "input", "mx": mx, "my": my, "aimX": x, "aimY": y})

    async def walk_to(self, x, y, timeout=45):
        deadline = time.monotonic() + timeout
        while True:
            p = self.player
            dx, dy = x - p["x"], y - p["y"]
            if math.hypot(dx, dy) <= 13:
                await self.input()
                await self.next_state()
                return
            if time.monotonic() >= deadline:
                raise AssertionError(f"Traversal stalled at {p}; destination=({x}, {y})")
            length = math.hypot(dx, dy)
            await self.input(dx / length, dy / length, aim=(x + 100, y))
            await self.next_state()

    async def close(self):
        await self.ws.close()
        self.reader.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self.reader


class ConnectedMapsIntegration(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        # unittest enables expensive asyncio traceback capture by default;
        # use the same event-loop mode as the production simulation.
        asyncio.get_running_loop().set_debug(False)
        self.world = server.World()
        # Keep traversal deterministic without replacing the world, movement,
        # network or monsters. Combat is enabled and exercised after reunion.
        for monster in self.world.monsters:
            monster.detection = 0
        self.runner = web.AppRunner(server.make_app(self.world))
        await self.runner.setup()
        self.site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await self.site.start()
        port = self.site._server.sockets[0].getsockname()[1]
        self.base = f"http://127.0.0.1:{port}"
        self.session = ClientSession()
        self.explorers = []

    async def asyncTearDown(self):
        for explorer in self.explorers:
            await explorer.close()
        await self.session.close()
        await self.runner.cleanup()

    async def join(self, name):
        explorer = await Explorer.join(self.session, self.base, name)
        self.explorers.append(explorer)
        return explorer

    async def test_two_players_separate_reunite_fight_and_return_without_reconnect(self):
        a, b = await self.join("Explorador A"), await self.join("Explorador B")
        await a.until(lambda state: state["world"]["online"] == 2)
        self.assertNotEqual(a.id, b.id)
        self.assertEqual(a.state["map"]["id"], "forest")
        self.assertEqual(b.state["map"]["id"], "forest")
        self.assertEqual({p["id"] for p in a.state["players"]}, {a.id, b.id})
        self.assertEqual(a.state["world"]["mapCount"], 2)
        self.assertEqual((a.state["world"]["width"], a.state["world"]["height"]), (4200, 1120))

        manifest = a.welcome["manifest"]
        self.assertEqual({z["id"] for z in manifest["zones"]}, {"forest", "corridor", "ruins"})
        assets = {}
        for zone in manifest["zones"]:
            async with self.session.get(self.base + zone["assetUrl"]) as response:
                self.assertEqual(response.status, 200)
                assets[zone["id"]] = await response.json()
                self.assertEqual(assets[zone["id"]]["id"], zone["id"])
        self.assertNotEqual(assets["forest"]["palette"], assets["ruins"]["palette"])
        self.assertGreater(len(assets["ruins"]["obstacles"]), len(assets["forest"]["obstacles"]))
        async with self.session.get(self.base + "/maps/missing.json") as response:
            self.assertEqual(response.status, 404)

        await a.walk_to(a.player["x"], 560)
        await a.walk_to(1780, 560)
        await a.ws.send_json({"type": "power", "x": a.player["x"], "y": 560})
        await a.until(lambda _: a.player["powerRemaining"] > 3)
        before_crossing = (a.player["id"], a.player["hp"], a.player["kills"])
        first_leg = len(a.history)
        await a.walk_to(3400, 560)
        states_on_leg = a.history[first_leg:]
        crossing = next(state for state in states_on_leg if state["map"]["id"] == "corridor")
        crossing_player = next(p for p in crossing["players"] if p["id"] == a.id)
        self.assertEqual((crossing_player["id"], crossing_player["hp"], crossing_player["kills"]), before_crossing)
        self.assertGreater(crossing_player["powerRemaining"], 0)
        self.assertLess(crossing_player["powerRemaining"], 3.4)
        self.assertEqual(a.state["map"]["id"], "ruins")
        self.assertNotIn("forest", a.state["relevantZones"])
        self.assertNotIn(b.id, {p["id"] for p in a.state["players"]})
        await b.until(lambda state: a.id not in {p["id"] for p in state["players"]})
        self.assertEqual(a.state["world"]["online"], 2)
        self.assertEqual(a.state["zoneCounts"]["forest"], 1)
        self.assertEqual(a.state["zoneCounts"]["ruins"], 1)

        # B crosses independently; both streams must discover the same entities.
        await b.walk_to(b.player["x"], 560)
        await b.walk_to(3350, 560)
        await a.until(lambda state: b.id in {p["id"] for p in state["players"]})
        self.assertEqual(b.state["map"]["id"], "ruins")
        self.assertIn(a.id, {p["id"] for p in b.state["players"]})
        self.assertEqual({m["id"] for m in a.state["monsters"]}, {m["id"] for m in b.state["monsters"]})
        self.assertTrue(any(m["kind"] not in {"slime", "wisp", "golem"} for m in a.state["monsters"]))

        # Bring an existing ruin creature into reach in the isolated fixture.
        # Damage, cooldowns and kills are then produced entirely by real inputs.
        monster = next(m for m in self.world.monsters if m.public()["zoneId"] == "ruins")
        monster.x = monster.home_x = a.player["x"] + 30
        monster.y = monster.home_y = 560
        monster.detection = 200
        await a.until(lambda _: a.player["hp"] < server.PLAYER_MAX_HP)
        await a.input(aim=(monster.x, monster.y))
        await a.ws.send_json({"type": "power", "x": monster.x, "y": monster.y})
        deadline = time.monotonic() + 7
        while a.player["kills"] == 0:
            self.assertLess(time.monotonic(), deadline, "Ruin monster did not die from server-authoritative combat")
            await a.ws.send_json({"type": "basic"})
            await asyncio.sleep(0.5)
        await b.until(lambda state: any(m["id"] == monster.id and m["dead"] for m in state["monsters"]))
        self.assertTrue(any(e["kind"] == "death" and e.get("target") == monster.id for e in a.events))
        self.assertTrue(any(e["kind"] == "death" and e.get("target") == monster.id for e in b.events))
        after_combat = (a.player["id"], a.player["name"], a.player["hp"], a.player["kills"])
        self.assertGreater(after_combat[2], 0)
        self.assertEqual(after_combat[3], 1)

        await a.walk_to(500, 560)
        self.assertEqual(a.state["map"]["id"], "forest")
        self.assertEqual((a.player["id"], a.player["name"], a.player["hp"], a.player["kills"]), after_combat)
        self.assertEqual(b.state["map"]["id"], "ruins")
        for explorer in (a, b):
            self.assertFalse(explorer.ws.closed)
            self.assertEqual(explorer.state["world"]["online"], 2)
            visited = {state["map"]["id"] for state in explorer.history}
            self.assertEqual(visited, {"forest", "corridor", "ruins"})
            for previous, current in zip(explorer.history, explorer.history[1:]):
                old = next(p for p in previous["players"] if p["id"] == explorer.id)
                new = next(p for p in current["players"] if p["id"] == explorer.id)
                step = math.hypot(new["x"] - old["x"], new["y"] - old["y"])
                elapsed = current["serverTime"] - previous["serverTime"]
                self.assertLessEqual(step, server.PLAYER_SPEED * (elapsed + 0.04) + 0.3,
                                     f"Position jumped: {old} -> {new}")
                self.assertTrue(all(p["zoneId"] in current["relevantZones"] for p in current["players"]))
                self.assertTrue(all(m["zoneId"] in current["relevantZones"] for m in current["monsters"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
