import { VIEW_W, VIEW_H } from '../config.js';
import { g, BLACK, WHITE, RED, ICE_LIGHT, ICE_MID } from './palette.js';
import { hash } from '../util/rng.js';

const TREAD = g(0x5a);
const SHADOW = g(0x60);
const CHAR = g(0x38);

// Rasterizes a tank straight into the frame buffer (pixel-art rotation by
// inverse mapping). Every part is drawn from the same geometry used for hit
// tests, and reflects its damage state.
export function drawTank(frame, camX, camY, t, tick) {
  const c = Math.cos(t.a), s = Math.sin(t.a);
  const tc = Math.cos(t.ta), ts = Math.sin(t.ta);
  const { hl, hw, trackW, turretR } = t;
  const BL = t.parts.cannon.hp > 0 ? t.barrelLen : t.barrelLen * 0.45;
  const tx0 = t.x + t.turretOff * c, ty0 = t.y + t.turretOff * s;
  const R = Math.max(t.bound, Math.abs(t.turretOff) + turretR + BL) + 4;

  const body = g(t.s.body), bodyDark = g(Math.max(0, t.s.body - 0x2c)), top = g(t.s.top);
  const flashAll = t.hitT > 0;
  const fz = t.flashT > 0 && (tick & 2) ? t.flashZone : null;
  const hullFrac = t.frac('hull');
  const engDead = t.parts.engine.hp <= 0;
  const turretDead = t.parts.turret.hp <= 0;
  const brokenL = t.parts.trackL.hp <= 0, brokenR = t.parts.trackR.hp <= 0;
  // parts under 50% get scorched hatching, so damage reads at a glance
  const hurtTurret = t.frac('turret') < 0.5, hurtCannon = t.frac('cannon') < 0.5;
  const hurtL = t.frac('trackL') < 0.5, hurtR = t.frac('trackR') < 0.5;
  const hurtEngine = t.frac('engine') < 0.5;
  const frost = t.frost;
  const tr2 = turretR * turretR, tri2 = (turretR - 1.2) * (turretR - 1.2);
  const hatchR = turretR * 0.26;

  const x0 = Math.max(0, Math.floor(t.x - R - camX)), x1 = Math.min(VIEW_W - 1, Math.ceil(t.x + R - camX));
  const y0 = Math.max(0, Math.floor(t.y - R - camY)), y1 = Math.min(VIEW_H - 1, Math.ceil(t.y + R - camY));

  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const wx = px + camX + 0.5, wy = py + camY + 0.5;
      const dx = wx - t.x, dy = wy - t.y;
      const u = dx * c + dy * s, v = -dx * s + dy * c;
      const ex = wx - tx0, ey = wy - ty0;
      const tu = ex * tc + ey * ts, tv = -ex * ts + ey * tc;
      const d2 = tu * tu + tv * tv;
      let col = -1, zone = null, outline = false;

      if (tu > 0 && tu <= turretR + BL && Math.abs(tv) <= 1.6 && d2 > tri2) {
        zone = 'cannon';
        if (Math.abs(tv) > 0.85 || tu > turretR + BL - 1.2) { col = BLACK; outline = true; }
        else col = hurtCannon && ((px + py) & 1) ? CHAR : top;
      } else if (d2 <= tr2) {
        zone = 'turret';
        if (d2 > tri2) { col = BLACK; outline = true; }
        else {
          // two round hatches, like the reference art
          const hu = tu + turretR * 0.25, hv1 = tv - turretR * 0.38, hv2 = tv + turretR * 0.38;
          const h1 = Math.sqrt(hu * hu + hv1 * hv1), h2 = Math.sqrt(hu * hu + hv2 * hv2);
          if (Math.abs(h1 - hatchR) < 0.55 || Math.abs(h2 - hatchR) < 0.55) col = BLACK;
          else if (turretDead && ((px + py) & 1)) col = CHAR;
          else if (hurtTurret && (px + 2 * py) % 4 === 0) col = CHAR;
          else col = top;
        }
      } else if (Math.abs(u) <= hl && Math.abs(v) <= hw) {
        const au = Math.abs(u), av = Math.abs(v);
        if (au > hl - 1 || av > hw - 1) {
          col = BLACK; outline = true;
          if (av > hw - trackW && (v < 0 ? brokenL : brokenR) && hash(Math.floor(u + 64), v < 0 ? 1 : 2) % 3 === 0) col = -1;
        } else if (av > hw - trackW) {
          zone = v < 0 ? 'trackL' : 'trackR';
          const broken = v < 0 ? brokenL : brokenR;
          if (av < hw - trackW + 1) col = BLACK;
          else if (broken && hash(Math.floor(u + 64), v < 0 ? 1 : 2) % 3 === 0) col = -1; // snapped links
          else {
            const phase = v < 0 ? t.treadL : t.treadR;
            col = ((Math.floor(u - phase) % 3) + 3) % 3 === 0 ? BLACK : TREAD;
            if ((v < 0 ? hurtL : hurtR) && (px + py) % 3 === 0) col = WHITE; // torn, shiny metal
          }
        } else {
          const eu = u + hl; // distance from the rear
          zone = eu < t.engineLen ? 'engine' : eu < t.engineLen + t.ammoLen ? 'ammo' : 'hull';
          if (zone === 'engine') {
            col = engDead ? (((px + py) & 1) ? BLACK : CHAR) : ((Math.floor(eu) & 1) ? bodyDark : body);
            if (hurtEngine && !engDead && (px + 2 * py) % 4 === 0) col = CHAR;
          }
          else if (u > hl - 3) col = bodyDark;
          else col = body;
          if (hullFrac < 0.5 && (px + 2 * py) % 5 === 0) col = g(0x40);
          if (hullFrac < 0.25 && (2 * px + py) % 5 === 0) col = CHAR;
        }
      }

      const k = py * VIEW_W + px;
      if (col === -1) {
        // drop shadow, light from the top-left
        const sx = dx - 2.5, sy = dy - 2.5;
        const su = sx * c + sy * s, sv = -sx * s + sy * c;
        if (Math.abs(su) <= hl && Math.abs(sv) <= hw && ((px + py) & 1)) frame[k] = SHADOW;
        continue;
      }
      if (flashAll && !outline) col = WHITE;
      else if (fz && zone === fz && !outline) col = RED;
      else if (frost > 0.15 && !outline) { // frozen tank: ice crust, thicker the colder
        const pat = (px + py) & 3;
        if (pat === 0 || (frost > 0.6 && pat === 2)) col = ((px ^ py) & 4) ? ICE_LIGHT : ICE_MID;
      }
      frame[k] = col;
    }
  }
}
