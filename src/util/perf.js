// Rolling performance stats shown in the HUD.
const N = 120;

export class Perf {
  constructor() {
    this.frames = new Float32Array(N);
    this.i = 0;
    this.update = 0;
    this.render = 0;
  }

  record(frameMs, updateMs, renderMs) {
    this.frames[this.i++ % N] = frameMs;
    this.update += (updateMs - this.update) * 0.1;
    this.render += (renderMs - this.render) * 0.1;
  }

  summary() {
    let sum = 0, max = 0;
    for (let k = 0; k < N; k++) { sum += this.frames[k]; if (this.frames[k] > max) max = this.frames[k]; }
    const avg = sum / N;
    return { fps: avg > 0 ? 1000 / avg : 0, avg, max, update: this.update, render: this.render };
  }
}
