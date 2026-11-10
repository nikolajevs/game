// Поведение диких существ.
import { NPCS, isWater } from '../shared/config.js';

function wander(n, dt) {
  n.wanderT -= dt;
  if (n.wanderT <= 0) {
    n.wanderT = 2 + Math.random() * 4;
    if (Math.random() < 0.35) {
      n.wx = 0;
      n.wy = 0;
    } else {
      const a = Math.random() * Math.PI * 2;
      n.wx = Math.cos(a);
      n.wy = Math.sin(a);
    }
  }
  if (n.wx || n.wy) n.angle = Math.atan2(n.wy, n.wx);
  return [n.wx, n.wy];
}

export function updateNpc(g, n, dt, night) {
  const def = NPCS[n.kind];
  n.cd.melee = Math.max(0, n.cd.melee - dt);
  n.cd.spit = Math.max(0, n.cd.spit - dt);
  n.atkT = Math.max(0, n.atkT - dt);
  n.hitT = Math.max(0, n.hitT - dt);
  n.slowT = Math.max(0, n.slowT - dt);
  n.alertT = Math.max(0, n.alertT - dt);
  n.combatT = Math.max(0, n.combatT - dt);

  let mx = 0;
  let my = 0;
  let speed = def.speed;
  let target = null;
  // хозяева мест и лесные духи не уходят далеко от дома
  const homebound = def.behavior === 'territorial' || def.behavior === 'guardian';

  if (def.behavior === 'passive' || def.behavior === 'guide') {
    let threat = n.alertT > 0 ? g.getCreature(n.target) : null;
    if (!threat || threat.dead) threat = g.nearestPlayer(n.x, n.y, def.flee, false);
    // проводник в мир духов бежит только от своего игрока и далеко от своего места не уходит
    if (def.behavior === 'guide') {
      const o = g.getCreature(n.owner);
      threat = o && !o.dead && Math.hypot(o.x - n.x, o.y - n.y) < def.flee ? o : null;
      if (threat && Math.hypot(n.x - n.homeX, n.y - n.homeY) > n.leash) threat = null;
    }
    if (threat) {
      const dx = n.x - threat.x;
      const dy = n.y - threat.y;
      const d = Math.hypot(dx, dy) || 1;
      mx = dx / d;
      my = dy / d;
      speed *= 1.25;
      n.angle = Math.atan2(my, mx);
    } else if (def.behavior === 'guide' && Math.hypot(n.x - n.homeX, n.y - n.homeY) > n.leash * 0.7) {
      // оторвался — плывёт обратно к своему месту
      const d = Math.hypot(n.homeX - n.x, n.homeY - n.y) || 1;
      mx = (n.homeX - n.x) / d;
      my = (n.homeY - n.y) / d;
      n.angle = Math.atan2(my, mx);
      speed *= 0.5;
    } else {
      [mx, my] = wander(n, dt);
      speed *= 0.45;
    }
  } else {
    if (n.target) {
      target = g.getCreature(n.target);
      if (
        !target || target.dead ||
        Math.hypot(target.x - n.x, target.y - n.y) > 750 ||
        (target.type === 'player' && target.spawnProtect > 0)
      ) {
        n.target = null;
        target = null;
      }
    }
    if (!target) {
      const radius = homebound ? def.aggro : night ? def.nightAggro : def.aggro;
      const cand = g.nearestPlayer(n.x, n.y, radius, true);
      if (cand) {
        n.target = cand.id;
        target = cand;
      }
    }
    if (target && homebound && Math.hypot(target.x - n.homeX, target.y - n.homeY) > (def.behavior === 'guardian' ? 900 : 600)) {
      n.target = null;
      target = null;
    }
    // страж места бросает погоню далеко за его границей
    if (target && n.leash && Math.hypot(target.x - n.homeX, target.y - n.homeY) > n.leash + 520) {
      n.target = null;
      target = null;
    }
    if (!target) n.windupT = 0;

    if (target) {
      const dx = target.x - n.x;
      const dy = target.y - n.y;
      const d = Math.hypot(dx, dy) || 1;
      n.angle = Math.atan2(dy, dx);
      const reach = n.stats.radius + n.stats.reach + target.stats.radius;
      if (d > reach * 0.8) {
        mx = dx / d;
        my = dy / d;
      }
      if (n.windupT > 0) {
        n.windupT = Math.max(0, n.windupT - dt);
        if (d > reach * 1.25) n.windupT = 0;
        if (n.windupT > 0) {
          mx = 0;
          my = 0;
        } else if (d <= reach) {
          n.cd.melee = n.stats.attackCd;
          n.atkT = 0.22;
          n.atkR = false;
          g.melee(n, n.stats.meleeDmg);
        }
      } else if (def.dmg && d <= reach && n.cd.melee <= 0 && !(n.stunT > 0)) {
        n.windupT = def.windup || 0.3;
        mx = 0;
        my = 0;
      }
      const sh = def.shoot;
      if (sh) {
        // стрелок держит дистанцию: вплотную отходит, на своей дальности зависает
        if (sh.keep && n.windupT <= 0) {
          if (d < sh.keep * 0.6) {
            mx = -dx / d;
            my = -dy / d;
          } else if (d < sh.keep) {
            mx = 0;
            my = 0;
          }
        }
        if (n.windupT <= 0 && n.cd.spit <= 0 && d >= sh.min && d <= sh.range && !(n.stunT > 0)) {
          n.cd.spit = sh.cd * (0.85 + Math.random() * 0.3);
          g.npcShoot(n, target);
        }
      }
    } else if (Math.hypot(n.x - n.homeX, n.y - n.homeY) > (n.leash || (homebound ? 220 : Infinity))) {
      const dx = n.homeX - n.x;
      const dy = n.homeY - n.y;
      const d = Math.hypot(dx, dy) || 1;
      mx = dx / d;
      my = dy / d;
      n.angle = Math.atan2(my, mx);
      speed *= 0.6;
    } else {
      n.windupT = 0;
      [mx, my] = wander(n, dt);
      speed *= 0.45;
    }
  }

  if (n.slowT > 0) speed *= 0.6;
  // оглушён (ЭМИ): стоит на месте и не бьёт, но отлетает от толчков
  if (n.stunT > 0) {
    n.windupT = 0;
    mx = 0;
    my = 0;
  }

  // упёрся в стену или дерево на пути к цели — обходит сбоку
  if (n.sideT > 0) {
    n.sideT -= dt;
    const c = Math.cos(1.25 * n.side);
    const s = Math.sin(1.25 * n.side);
    [mx, my] = [mx * c - my * s, mx * s + my * c];
  }

  // сухопутные существа не заходят в воду
  if ((mx || my) && !n.stats.swim && !n.fly) {
    const ax = n.x + mx * (n.stats.radius + 16);
    const ay = n.y + my * (n.stats.radius + 16);
    if (isWater(g.tileAt(ax, ay)) && !isWater(g.tileAt(n.x, n.y))) {
      n.wanderT = 0;
      mx = 0;
      my = 0;
    }
  }

  const px = n.x;
  const py = n.y;
  const hit = g.moveCreature(n, mx, my, speed, dt);
  if (hit && (mx || my) && !(n.sideT > 0) && Math.hypot(n.x - px, n.y - py) < speed * dt * 0.35) {
    n.sideT = 0.5 + Math.random() * 0.4;
    n.side = Math.random() < 0.5 ? -1 : 1;
  }
}
