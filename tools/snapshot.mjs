// Headless render of a game frame to PNG.
// Run: node tools/snapshot.mjs out.png [ticks] [seed]
import fs from 'node:fs';
import zlib from 'node:zlib';
import { VIEW_W, VIEW_H } from '../src/config.js';
import { Composer } from '../src/render/compose.js';
import { makeGame, botInput } from './sim.mjs';

const out = process.argv[2] || 'snapshot.png';
const TICKS = +(process.argv[3] || 300);
const game = makeGame(+(process.argv[4] || 12345));
for (let i = 0; i < TICKS; i++) game.update(botInput(game));

const frame = new Uint32Array(VIEW_W * VIEW_H);
new Composer(game.grid).compose(game, frame, Math.round(game.cam.x), Math.round(game.cam.y));

const SCALE = 2;
const W = VIEW_W * SCALE, H = VIEW_H * SCALE;
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0;
  for (let x = 0; x < W; x++) {
    const c = frame[Math.floor(y / SCALE) * VIEW_W + Math.floor(x / SCALE)];
    const o = y * (W * 4 + 1) + 1 + x * 4;
    raw[o] = c & 255; raw[o + 1] = (c >> 8) & 255; raw[o + 2] = (c >> 16) & 255; raw[o + 3] = 255;
  }
}
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
fs.writeFileSync(out, Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
]));
const alive = game.enemies.filter((e) => e.alive).length;
console.log(`wrote ${out} at tick ${TICKS}: state ${game.state}, room ${game.level}, enemies alive ${alive}/${game.enemies.length}, player hull ${game.player.parts.hull.hp.toFixed(0)}`);
