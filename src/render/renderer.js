import { VIEW_W, VIEW_H, ROOM_W, ROOM_H } from '../config.js';
import { clamp } from '../util/math.js';
import { rnd } from '../util/rng.js';
import { Composer } from './compose.js';
import { PART_LABEL as ZONE_LABEL } from '../game/game.js';

// Browser presentation: pixel frame on a low-res canvas (CSS upscaled,
// pixelated), plus a full-resolution canvas on top for crisp comic text.
export class Renderer {
  constructor(canvas, fx, game) {
    canvas.width = VIEW_W;
    canvas.height = VIEW_H;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.img = this.ctx.createImageData(VIEW_W, VIEW_H);
    this.frame = new Uint32Array(this.img.data.buffer);
    this.fx = fx;
    this.fctx = fx.getContext('2d');
    this.scale = 1;
    this.composer = new Composer(game.grid);
  }

  resize(devicePxPerCell) {
    this.scale = devicePxPerCell;
    this.fx.width = VIEW_W * devicePxPerCell;
    this.fx.height = VIEW_H * devicePxPerCell;
  }

  draw(game, mouse) {
    const sh = game.shake;
    const camX = Math.round(clamp(game.cam.x + (rnd() - 0.5) * sh, 0, ROOM_W - VIEW_W));
    const camY = Math.round(clamp(game.cam.y + (rnd() - 0.5) * sh, 0, ROOM_H - VIEW_H));
    this.composer.compose(game, this.frame, camX, camY);
    this.ctx.putImageData(this.img, 0, 0);

    const f = this.fctx;
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.clearRect(0, 0, this.fx.width, this.fx.height);
    f.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    for (const t of game.enemies) if (t.alive && t.charge > 0) this.drawTelegraph(f, t, game, camX, camY);
    for (const p of game.popups) this.drawPopup(f, p, camX, camY);
    if (game.player.alive) {
      this.drawTargetInfo(f, game, mouse, camX, camY);
      this.drawCrosshair(f, game.player, mouse);
    }
  }

  // "About to fire" warning: dashed laser to the first wall + muzzle glint.
  drawTelegraph(f, t, game, camX, camY) {
    const c = Math.cos(t.ta), s = Math.sin(t.ta);
    const tip = t.turretR + t.barrelLen;
    const sx = t.x + t.turretOff * Math.cos(t.a) + c * tip, sy = t.y + t.turretOff * Math.sin(t.a) + s * tip;
    let x = sx, y = sy;
    for (let k = 0; k < 160; k++) {
      x += c * 2; y += s * 2;
      if (game.grid.isSolid(Math.floor(x), Math.floor(y))) break;
    }
    const prog = 1 - t.charge / t.chargeMax;
    f.save();
    f.strokeStyle = '#ff2d2d';
    f.globalAlpha = 0.3 + 0.7 * prog;
    f.lineWidth = 0.4 + prog * 0.8;
    f.setLineDash([3, 2]);
    f.lineDashOffset = -game.tick * 0.6;
    f.beginPath(); f.moveTo(sx - camX, sy - camY); f.lineTo(x - camX, y - camY); f.stroke();
    f.setLineDash([]);
    f.globalAlpha = 1;
    const r = 1.5 + prog * 4;
    f.translate(sx - camX, sy - camY);
    f.rotate(game.tick * 0.2);
    f.beginPath();
    for (let i = 0; i < 8; i++) {
      const rr = i % 2 ? r * 0.3 : r;
      f.lineTo(Math.cos((i / 8) * Math.PI * 2) * rr, Math.sin((i / 8) * Math.PI * 2) * rr);
    }
    f.closePath();
    f.fillStyle = '#fff'; f.fill();
    f.lineWidth = 0.5; f.strokeStyle = '#000'; f.stroke();
    f.restore();
  }

  // Hovering an enemy shows its part status, and names the zone under the
  // crosshair (weak spots flagged).
  drawTargetInfo(f, game, m, camX, camY) {
    const wx = camX + m.x, wy = camY + m.y;
    let best = null, bd = Infinity;
    for (const e of game.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - wx, e.y - wy);
      if (d < e.bound + 8 && d < bd) { bd = d; best = e; }
    }
    if (!best) return;
    const rows = [['HUL', 'hull'], ['TRK', 'trackL'], ['TRK', 'trackR'], ['TUR', 'turret'], ['GUN', 'cannon'], ['ENG', 'engine'], ['AMO', 'ammo']];
    let px = best.x - camX + best.bound + 6, py = best.y - camY - 22;
    if (px + 34 > VIEW_W) px = best.x - camX - best.bound - 40;
    py = Math.max(2, Math.min(VIEW_H - 40, py));
    f.save();
    f.fillStyle = 'rgba(0,0,0,0.8)';
    f.fillRect(px, py, 34, 37);
    f.strokeStyle = '#fff'; f.lineWidth = 0.6; f.strokeRect(px, py, 34, 37);
    f.font = '5px Bangers, Impact, sans-serif';
    f.textBaseline = 'middle';
    rows.forEach(([label, k], i) => {
      const y = py + 4 + i * 5;
      const fr = best.frac(k);
      f.fillStyle = fr <= 0 ? '#ff2d2d' : '#fff';
      f.fillText(label, px + 2, y + 0.3);
      f.strokeStyle = fr <= 0 ? '#ff2d2d' : '#fff';
      f.lineWidth = 0.4;
      f.strokeRect(px + 13, y - 1.5, 19, 3);
      f.fillStyle = fr < 0.35 ? '#ff2d2d' : '#fff';
      f.fillRect(px + 13, y - 1.5, 19 * fr, 3);
    });
    const zone = best.hitTest(wx, wy);
    if (zone) {
      const weak = zone === 'ammo' || zone === 'engine';
      f.font = '7px Bangers, Impact, sans-serif';
      f.textBaseline = 'middle';
      f.lineWidth = 1.6; f.strokeStyle = '#000';
      const text = (ZONE_LABEL[zone] || zone) + (weak ? ' - WEAK SPOT' : '');
      f.strokeText(text, m.x + 10, m.y - 9);
      f.fillStyle = weak ? '#ff2d2d' : '#fff';
      f.fillText(text, m.x + 10, m.y - 9);
    }
    f.restore();
  }

  drawPopup(f, p, camX, camY) {
    const grow = Math.min(1, p.t / 6);
    const fade = p.t > p.life - 15 ? (p.life - p.t) / 15 : 1;
    f.save();
    f.globalAlpha = Math.max(0, fade);
    f.translate(p.x - camX, p.y - camY - p.t * 0.15);
    f.rotate(p.rot);
    const sc = 0.5 + 0.5 * grow + (p.t < 6 ? 0.25 * grow : 0);
    f.scale(sc, sc);
    f.font = `${p.size}px Bangers, Impact, "Arial Black", sans-serif`;
    f.textAlign = 'center';
    f.textBaseline = 'middle';
    if (p.burst) {
      const r = f.measureText(p.text).width * 0.62 + p.size * 0.3;
      f.beginPath();
      const n = 14;
      for (let i = 0; i <= n * 2; i++) {
        const a = (i / (n * 2)) * Math.PI * 2;
        const rr = i % 2 ? r * 0.72 : r * (1 + ((i * 7) % 5) * 0.06);
        f.lineTo(Math.cos(a) * rr, Math.sin(a) * rr * 0.62);
      }
      f.closePath();
      f.fillStyle = '#fff';
      f.fill();
      f.lineWidth = 1.2;
      f.strokeStyle = '#000';
      f.stroke();
    }
    f.lineJoin = 'round';
    f.lineWidth = p.size * 0.2;
    f.strokeStyle = '#000';
    f.strokeText(p.text, 0, 0);
    f.fillStyle = p.red ? '#ff2d2d' : '#fff';
    f.fillText(p.text, 0, 0);
    f.restore();
  }

  drawCrosshair(f, player, m) {
    const ready = 1 - Math.max(0, player.reload) / (player.reloadMax || 1);
    f.save();
    f.translate(m.x, m.y);
    f.lineWidth = 0.7;
    f.strokeStyle = '#ff2d2d';
    f.beginPath(); f.arc(0, 0, 5, 0, Math.PI * 2); f.stroke();
    f.beginPath();
    f.moveTo(-8, 0); f.lineTo(-3, 0); f.moveTo(3, 0); f.lineTo(8, 0);
    f.moveTo(0, -8); f.lineTo(0, -3); f.moveTo(0, 3); f.lineTo(0, 8);
    f.stroke();
    if (ready < 1) {
      f.lineWidth = 1.2;
      f.beginPath(); f.arc(0, 0, 7, -Math.PI / 2, -Math.PI / 2 + ready * Math.PI * 2); f.stroke();
    }
    const heat = Math.min(1, player.mgHeat / 60); // machine gun heat, lower arc
    if (heat > 0.02) {
      f.lineWidth = 1;
      f.strokeStyle = player.overheat ? '#ff2d2d' : '#fff';
      f.beginPath(); f.arc(0, 0, 10, Math.PI * 0.75, Math.PI * 0.75 - heat * Math.PI * 0.5, true); f.stroke();
    }
    f.restore();
  }
}
