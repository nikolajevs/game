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

  if (def.behavior === 'passive') {
    let threat = n.alertT > 0 ? g.getCreature(n.target) : null;
    if (!threat || threat.dead) threat = g.nearestPlayer(n.x, n.y, def.flee, false);
    if (threat) {
      const dx = n.x - threat.x;
      const dy = n.y - threat.y;
      const d = Math.hypot(dx, dy) || 1;
      mx = dx / d;
      my = dy / d;
      speed *= 1.25;
      n.angle = Math.atan2(my, mx);
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
      const radius = def.behavior === 'territorial' ? def.aggro : night ? def.nightAggro : def.aggro;
      const cand = g.nearestPlayer(n.x, n.y, radius, true);
      if (cand) {
        n.target = cand.id;
        target = cand;
      }
    }
    if (target && def.behavior === 'territorial' && Math.hypot(target.x - n.homeX, target.y - n.homeY) > 600) {
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
          g.melee(n, n.stats.meleeDmg);
        }
      } else if (d <= reach && n.cd.melee <= 0 && !(n.stunT > 0)) {
        n.windupT = n.kind === 'colossus' ? 0.56 : 0.3;
        mx = 0;
        my = 0;
      }
      if (n.windupT <= 0 && n.stats.spit && n.cd.spit <= 0 && d > 120 && d < 380) {
        n.cd.spit = n.stats.spit.cd * 1.8;
        g.spit(n);
      }
    } else if (Math.hypot(n.x - n.homeX, n.y - n.homeY) > (n.leash || (def.behavior === 'territorial' ? 220 : Infinity))) {
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

  // сухопутные существа не заходят в воду
  if ((mx || my) && !n.stats.swim) {
    const ax = n.x + mx * (n.stats.radius + 16);
    const ay = n.y + my * (n.stats.radius + 16);
    if (isWater(g.tileAt(ax, ay)) && !isWater(g.tileAt(n.x, n.y))) {
      n.wanderT = 0;
      mx = 0;
      my = 0;
    }
  }

  g.moveCreature(n, mx, my, speed, dt);
}
