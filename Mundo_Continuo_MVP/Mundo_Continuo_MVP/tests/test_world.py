"""Deterministic tests for authoritative combat and continuous world movement."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import (
    World, Player, Monster, BASIC_DAMAGE, POWER_DAMAGE, POWER_RANGE,
    PLAYER_RADIUS, PLAYER_SPEED, SPAWN,
)
from map_manager import MAPS

class WorldTests(unittest.TestCase):
    def setUp(self):
        self.w = World()
        self.p = Player(id="test", name="Tester", ws=None)  # type: ignore
        self.p.joined = True
        self.w.players[self.p.id] = self.p
        self.m = self.w.monsters[0]

    def test_no_aggro_outside_home_radius(self):
        self.p.x, self.p.y = 50, 50
        before = (self.m.x, self.m.y, self.p.hp)
        self.w.tick(.05, 500)
        self.assertEqual(before, (self.m.x, self.m.y, self.p.hp))

    def test_basic_attack_cone_and_cooldown(self):
        self.p.x, self.p.y = self.m.x-75, self.m.y
        self.p.dx, self.p.dy = 1, 0
        self.w.attack_basic(self.p, 500)
        self.assertEqual(self.m.hp, self.m.max_hp-BASIC_DAMAGE)
        self.w.attack_basic(self.p, 500.1)
        self.assertEqual(self.m.hp, self.m.max_hp-BASIC_DAMAGE)
        self.p.dx, self.p.dy = -1, 0
        self.w.attack_basic(self.p, 501)
        self.assertEqual(self.m.hp, self.m.max_hp-BASIC_DAMAGE)

    def test_power_does_not_teleport_beyond_range(self):
        self.p.x, self.p.y = 200, 600
        self.w.attack_power(self.p, 10000, 600, 500)
        nova = [e for e in self.w.events if e['kind']=='nova']
        self.assertEqual(len(nova),1)
        self.assertLessEqual(nova[0]['x']-self.p.x, POWER_RANGE+0.1)

    def test_monster_attacks_only_in_territory(self):
        self.p.x, self.p.y = self.m.home_x-35, self.m.home_y
        self.w.tick(.05, 500)
        self.assertLess(self.p.hp,100)  # Creature hits a target within its reach.
        hp=self.p.hp
        self.p.x, self.p.y = 20, 20
        self.w.tick(.05, 502)
        self.assertEqual(self.p.hp,hp)


class ConnectedWorldTests(unittest.TestCase):
    def setUp(self):
        self.world = World()
        # Movement tests isolate geography from combat; combat has its own tests.
        self.world.monsters.clear()
        self.player = Player(id="persistent-id", name="Explorador", ws=None)
        self.player.joined = True
        self.world.players[self.player.id] = self.player
        self.now = 500.0

    def walk(self, mx, my, frames=1):
        self.player.move_x, self.player.move_y = mx, my
        positions = [(self.player.x, self.player.y)]
        for _ in range(frames):
            self.now += 1 / 30
            self.player.last_input = self.now
            self.world.tick(1 / 30, self.now)
            positions.append((self.player.x, self.player.y))
        return positions

    def test_both_seams_preserve_character_and_position(self):
        self.player.hp = 73
        self.player.kills = 9
        self.player.basic_ready = 501.25
        self.player.power_ready = 503.4
        original = (
            self.player.id, self.player.name, self.player.hp,
            self.player.kills, self.player.basic_ready, self.player.power_ready,
        )
        for start_x, direction, expected_zone in (
            (1799.0, 1, "corridor"), (2399.0, 1, "ruins"),
            (2401.0, -1, "corridor"), (1801.0, -1, "forest"),
        ):
            with self.subTest(start=start_x, direction=direction):
                self.player.x, self.player.y = start_x, 560.0
                self.walk(direction, 0)
                self.assertAlmostEqual(self.player.x, start_x + direction * PLAYER_SPEED / 30)
                self.assertEqual(self.player.y, 560.0)
                self.assertEqual(self.player.public(self.now)["zoneId"], expected_zone)
                self.assertEqual(original, (
                    self.player.id, self.player.name, self.player.hp,
                    self.player.kills, self.player.basic_ready, self.player.power_ready,
                ))
                self.assertIs(self.world.players["persistent-id"], self.player)

    def test_map_edges_only_open_inside_corridor(self):
        for start_x, direction, edge in ((1760, 1, 1800 - PLAYER_RADIUS),
                                         (2440, -1, 2400 + PLAYER_RADIUS)):
            with self.subTest(start=start_x):
                self.player.x, self.player.y = start_x, 300
                self.walk(direction, 0, frames=45)
                if direction > 0:
                    self.assertLessEqual(self.player.x, edge + 0.01)
                else:
                    self.assertGreaterEqual(self.player.x, edge - 0.01)
                self.assertEqual(self.player.y, 300)

    def test_corridor_walls_keep_player_inside_walkable_space(self):
        for direction, limit in ((-1, 440 + PLAYER_RADIUS), (1, 680 - PLAYER_RADIUS)):
            with self.subTest(direction=direction):
                self.player.x, self.player.y = 2100, 560
                self.walk(0, direction, frames=45)
                if direction < 0:
                    self.assertGreaterEqual(self.player.y, limit - 0.01)
                else:
                    self.assertLessEqual(self.player.y, limit + 0.01)

    def test_entire_connection_is_continuous_in_both_directions(self):
        self.player.x, self.player.y = 1740, 560
        zones = {self.player.public(self.now)["zoneId"]}
        for direction in (1, -1):
            for _ in range(100):
                before = self.player.x
                self.walk(direction, 0)
                self.assertAlmostEqual(self.player.x - before, direction * PLAYER_SPEED / 30)
                zones.add(self.player.public(self.now)["zoneId"])
        self.assertEqual(zones, {"forest", "corridor", "ruins"})
        self.assertAlmostEqual(self.player.x, 1740)

    def test_client_position_fields_cannot_teleport_to_another_map(self):
        before = (self.player.x, self.player.y)
        self.world.handle_action(self.player, {
            "type": "input", "mx": 0, "my": 0,
            "x": 3400, "y": 560, "zoneId": "ruins",
            "aimX": 3400, "aimY": 560,
        })
        self.assertEqual(before, (self.player.x, self.player.y))
        self.assertEqual(self.player.public(self.now)["zoneId"], "forest")

    def creature(self, x, y):
        monster = Monster(id="test-creature", kind="sentinel", home_x=x, home_y=y,
                          x=x, y=y, hp=100, max_hp=100, speed=65, detection=200, attack=10)
        self.world.monsters.append(monster)
        return monster

    def test_combat_reaches_across_the_corridor_ruins_seam(self):
        self.player.x, self.player.y = 2380, 560
        self.player.dx, self.player.dy = 1, 0
        monster = self.creature(2420, 560)
        self.world.attack_basic(self.player, self.now)
        self.assertEqual(monster.hp, monster.max_hp - BASIC_DAMAGE)
        self.world.attack_power(self.player, monster.x, monster.y, self.now)
        self.assertEqual(monster.hp, monster.max_hp - BASIC_DAMAGE - POWER_DAMAGE)

    def test_ruins_wall_blocks_movement_and_attacks_around_its_corner(self):
        self.player.x, self.player.y = 2880, 350
        self.walk(1, 0, frames=45)
        self.assertLessEqual(self.player.x, 2900 - PLAYER_RADIUS)
        self.assertGreater(self.player.x, 2870)

        self.player.x, self.player.y = 2880, 420
        monster = self.creature(2920, 458)
        self.assertTrue(MAPS.walkable(self.player.x, self.player.y))
        self.assertTrue(MAPS.walkable(monster.x, monster.y))
        self.assertFalse(MAPS.line_of_sight(self.player.x, self.player.y, monster.x, monster.y))
        length = ((monster.x - self.player.x) ** 2 + (monster.y - self.player.y) ** 2) ** .5
        self.player.dx = (monster.x - self.player.x) / length
        self.player.dy = (monster.y - self.player.y) / length
        self.world.attack_basic(self.player, self.now)
        self.world.attack_power(self.player, monster.x, monster.y, self.now)
        self.assertEqual(monster.hp, monster.max_hp)

    def test_respawn_stays_in_ruins_and_preserves_kills_and_cooldown(self):
        self.player.x, self.player.y = 3400, 560
        self.player.hp = 0
        self.player.dead_until = 501
        self.player.kills = 4
        self.player.power_ready = 510
        self.world.tick(.05, 502)
        self.assertEqual(self.player.public(502)["zoneId"], "ruins")
        self.assertEqual((self.player.x, self.player.y), (2500, 580))
        self.assertEqual((self.player.hp, self.player.kills, self.player.power_ready), (100, 4, 510))

    def test_one_event_batch_reaches_all_nearby_viewers_and_excludes_distant_zones(self):
        self.player.x, self.player.y = 3400, 560
        neighbor = Player(id="neighbor", name="Nearby", ws=None, x=3350, y=560, joined=True)
        distant = Player(id="distant", name="Distant", ws=None, x=300, y=560, joined=True)
        self.world.players[neighbor.id] = neighbor
        self.world.players[distant.id] = distant
        self.world.effects("nova", 3420, 560, radius=92)
        self.world.effects("slash", 300, 560, dx=1, dy=0)
        batch = self.world.drain_events()
        a = self.world.snapshot(self.now, self.player, events=batch)
        b = self.world.snapshot(self.now, neighbor, events=batch)
        c = self.world.snapshot(self.now, distant, events=batch)
        self.assertEqual([e["kind"] for e in a["events"]], ["nova"])
        self.assertEqual(a["events"], b["events"])
        self.assertEqual([e["kind"] for e in c["events"]], ["slash"])
        self.assertEqual(self.world.drain_events(), [])
        self.assertEqual({p["id"] for p in a["players"]}, {self.player.id, neighbor.id})
        self.assertEqual({p["id"] for p in c["players"]}, {distant.id})
        self.assertTrue(all(state["world"]["online"] == 3 for state in (a, b, c)))

if __name__ == '__main__':
    unittest.main()
