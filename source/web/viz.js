const SQ = Math.SQRT1_2, HALF_PI = Math.PI / 2;
const db = (a) => (a > 1e-9 ? 20 * Math.log10(a) : -200);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const MONO = [255, 112, 48], WIDE = [63, 163, 192], ANTI = [108, 100, 212], RED = [255, 65, 54];
const CONDENSED = `"Avenir Next Condensed", "Bahnschrift SemiCondensed", "Arial Narrow", sans-serif`;
const NOTES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

function fit(canvas, k = 1) {
  const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * dpr * k)), h = Math.max(1, Math.round(r.height * dpr * k));
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w;
  canvas.height = h;
  return true;
}

function angleColour(theta) {
  const a = Math.abs(theta) / HALF_PI;
  return a <= 0.5 ? mix(MONO, WIDE, a * 2) : a <= 0.75 ? mix(WIDE, ANTI, (a - 0.5) * 4) : mix(ANTI, RED, (a - 0.75) * 4);
}
const corrColour = (c) => (c >= 0 ? mix(WIDE, MONO, c) : mix(WIDE, RED, -c));

export class Stream {
  constructor(url, capacity = 1 << 15) {
    this.url = url;
    this.cap = capacity;
    this.ring = new Float32Array(capacity * 2);
    this.total = 0;
    this.sampleRate = 48000;
    this.voices = 0;
    this.tails = 0;
    this.flags = 0;
    this.dropped = 0;
    this.batch = new Float32Array(0);
    this.seq = 0;
    this.busy = false;
    this.lastData = 0;
    this.fresh = false;
  }

  pull() {
    if (this.busy) return;
    this.busy = true;
    fetch(`${this.url}?n=${this.seq++}`, { cache: "no-store" })
      .then((r) => r.arrayBuffer())
      .then((buffer) => this.ingest(buffer))
      .catch(() => {})
      .finally(() => { this.busy = false; });
  }

  ingest(buffer) {
    if (buffer.byteLength < 32) return;
    const v = new DataView(buffer);
    if (v.getUint32(0, true) !== 0x6373454a || v.getUint16(4, true) !== 1) return;
    const header = v.getUint16(6, true);
    this.sampleRate = v.getFloat32(8, true) || this.sampleRate;
    const frames = Math.min(v.getUint32(12, true), (buffer.byteLength - header) >> 3);
    this.dropped += v.getUint32(16, true);
    this.voices = v.getUint16(20, true);
    this.tails = v.getUint16(22, true);
    this.flags = v.getUint32(24, true);
    const samples = new Float32Array(buffer, header, frames * 2);
    for (let i = 0; i < frames; ++i) {
      const w = ((this.total + i) % this.cap) * 2;
      this.ring[w] = samples[2 * i];
      this.ring[w + 1] = samples[2 * i + 1];
    }
    this.total += frames;
    this.batch = samples;
    this.fresh = true;
    if (frames) this.lastData = performance.now();
  }

  tail(n, left, right) {
    const start = this.total - n;
    for (let i = 0; i < n; ++i) {
      const w = (((start + i) % this.cap) + this.cap) % this.cap * 2;
      left[i] = this.ring[w];
      right[i] = this.ring[w + 1];
    }
  }

  get idle() { return performance.now() - this.lastData > 1200; }
}

export class Analysis {
  constructor() {
    this.ll = this.rr = this.lr = 0;
    this.ms = [0, 0];
    this.batchPeak = [0, 0];
    this.peak = [-200, -200];
    this.hold = [-200, -200];
    this.holdAt = [0, 0];
    this.clipUntil = [0, 0];
    this.corr = 0;
    this.corrShown = 0;
    this.balShown = 0;
  }

  feed(batch, sampleRate) {
    const frames = batch.length >> 1;
    if (!frames) return;
    let ll = 0, rr = 0, lr = 0, pl = 0, pr = 0;
    for (let i = 0; i < batch.length; i += 2) {
      const l = batch[i], r = batch[i + 1];
      ll += l * l; rr += r * r; lr += l * r;
      const al = Math.abs(l), ar = Math.abs(r);
      if (al > pl) pl = al;
      if (ar > pr) pr = ar;
    }
    const slow = Math.exp(-frames / (0.3 * sampleRate)), fast = Math.exp(-frames / (0.06 * sampleRate));
    this.ll = this.ll * slow + ll;
    this.rr = this.rr * slow + rr;
    this.lr = this.lr * slow + lr;
    this.ms[0] = this.ms[0] * fast + (1 - fast) * (ll / frames);
    this.ms[1] = this.ms[1] * fast + (1 - fast) * (rr / frames);
    this.batchPeak[0] = Math.max(this.batchPeak[0], pl);
    this.batchPeak[1] = Math.max(this.batchPeak[1], pr);
  }

  step(dt, now) {
    for (let c = 0; c < 2; ++c) {
      const p = db(this.batchPeak[c]);
      this.peak[c] = Math.max(p, this.peak[c] - 26 * dt);
      if (p >= this.hold[c]) { this.hold[c] = p; this.holdAt[c] = now; }
      else if (now - this.holdAt[c] > 1200) this.hold[c] -= 16 * dt;
      if (this.batchPeak[c] >= 0.999) this.clipUntil[c] = now + 1500;
      this.batchPeak[c] = 0;
    }
    const energy = Math.sqrt(this.ll * this.rr);
    this.signal = energy > 1e-7;
    this.corr = this.signal ? clamp(this.lr / energy, -1, 1) : 0;
    const rl = Math.sqrt(this.ll), rr = Math.sqrt(this.rr);
    this.balance = this.signal ? (rr - rl) / (rr + rl) : 0;
    this.balanceDb = this.signal ? db(rr) - db(rl) : 0;
    const mid = (this.ll + this.rr + 2 * this.lr) / 4, side = (this.ll + this.rr - 2 * this.lr) / 4;
    this.width = mid > 1e-12 ? Math.sqrt(Math.max(0, side) / mid) : 0;
    const k = 1 - Math.exp(-dt * 14);
    this.corrShown += (this.corr - this.corrShown) * k;
    this.balShown += (this.balance - this.balShown) * k;
  }
}

export class Vectorscope {
  constructor(root) {
    this.root = root;
    this.grat = root.querySelector(".grat");
    this.beam = root.querySelector(".beam");
    this.bloom = root.querySelector(".bloom");
    this.g = this.grat.getContext("2d");
    this.b = this.beam.getContext("2d");
    this.o = this.bloom.getContext("2d");
    this.mode = "liss";
    this.gain = 1;
    this.auto = true;
    this.envelope = 0;
    this.last = null;
    this.bins = 96;
    this.level = new Float32Array(this.bins);
    this.holdLevel = new Float32Array(this.bins);
    this.holdAt = new Float32Array(this.bins);
    this.scratch = new Float32Array(this.bins);
    this.points = Array.from({ length: 16 }, () => ({ xs: new Float32Array(8192), ys: new Float32Array(8192), n: 0 }));
    this.styles = Array.from({ length: 16 }, (_, i) => rgba(angleColour(((i + 0.5) / 16 - 0.5) * Math.PI), 0.35));
    this.onZoom = () => {};
    root.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.auto = false;
      this.gain = clamp(this.gain * Math.pow(1.0015, -e.deltaY), 0.25, 32);
      this.onZoom();
    }, { passive: false });
    root.addEventListener("dblclick", () => { this.auto = true; this.onZoom(); });
  }

  geometry() {
    const W = this.beam.width, H = this.beam.height;
    return this.mode === "liss" ? { W, H, cx: W / 2, cy: H / 2, R: W * 0.33 } : { W, H, cx: W / 2, cy: H * 0.86, R: W * 0.44 };
  }

  resize() {
    fit(this.grat);
    fit(this.beam);
    fit(this.bloom, 0.5);
    this.graticule();
  }

  setMode(mode) {
    this.mode = mode;
    this.last = null;
    this.b.clearRect(0, 0, this.beam.width, this.beam.height);
    this.level.fill(0);
    this.holdLevel.fill(0);
    this.graticule();
  }

  graticule() {
    const g = this.g, { W, H, cx, cy, R } = this.geometry(), dpr = W / 240;
    g.clearRect(0, 0, W, H);
    g.lineWidth = dpr;
    g.font = `700 ${10 * dpr}px ${CONDENSED}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const label = (text, x, y, alpha = 0.42) => { g.fillStyle = `rgba(240,230,216,${Math.min(1, alpha + 0.25)})`; g.fillText(text, x, y); };
    const line = (x0, y0, x1, y1, alpha, dash = []) => {
      g.strokeStyle = `rgba(240,228,212,${alpha})`;
      g.setLineDash(dash);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    };
    if (this.mode === "liss") {
      for (const [f, a] of [[0.5, 0.06], [1, 0.1], [Math.SQRT2, 0.05]]) {
        g.strokeStyle = `rgba(240,228,212,${a})`;
        g.setLineDash([]);
        g.beginPath(); g.arc(cx, cy, R * f, 0, Math.PI * 2); g.stroke();
      }
      const e = R * 1.36;
      line(cx, cy - e, cx, cy + e, 0.12);
      line(cx - e, cy, cx + e, cy, 0.12);
      const d = e * SQ;
      line(cx - d, cy - d, cx + d, cy + d, 0.09, [3 * dpr, 4 * dpr]);
      line(cx + d, cy - d, cx - d, cy + d, 0.09, [3 * dpr, 4 * dpr]);
      for (let i = -10; i <= 10; ++i) {
        const t = (i / 10) * R;
        line(cx + t, cy - 2 * dpr, cx + t, cy + 2 * dpr, 0.12);
        line(cx - 2 * dpr, cy + t, cx + 2 * dpr, cy + t, 0.12);
      }
      label("M", cx, 10 * dpr, 0.55);
      label("L", cx - d - 6 * dpr, cy - d - 6 * dpr);
      label("R", cx + d + 6 * dpr, cy - d - 6 * dpr);
      label("+S", 11 * dpr, cy - 8 * dpr);
      label("−S", W - 11 * dpr, cy - 8 * dpr);
    } else {
      g.fillStyle = "rgba(255,65,54,0.06)";
      for (const side of [-1, 1]) {
        g.beginPath(); g.moveTo(cx, cy);
        g.arc(cx, cy, R, side < 0 ? Math.PI : -Math.PI / 4, side < 0 ? -Math.PI * 3 / 4 : 0);
        g.closePath(); g.fill();
      }
      for (const dB of [0, -6, -12, -24, -36]) {
        const r = R * (1 + dB / 48);
        g.strokeStyle = `rgba(240,228,212,${dB === 0 ? 0.16 : 0.08})`;
        g.setLineDash(dB === 0 ? [] : [2 * dpr, 3 * dpr]);
        g.beginPath(); g.arc(cx, cy, r, Math.PI, 0); g.stroke();
        label(dB === 0 ? "0" : `${dB}`, cx + r + 1 * dpr, cy + 7 * dpr, 0.32);
      }
      for (const deg of [-90, -45, 0, 45, 90]) {
        const a = (deg * Math.PI) / 180;
        line(cx, cy, cx + R * 1.02 * Math.sin(a), cy - R * 1.02 * Math.cos(a), deg % 90 === 0 ? 0.12 : 0.1, deg === 0 ? [] : [3 * dpr, 3 * dpr]);
      }
      label("M", cx, cy - R - 8 * dpr, 0.55);
      label("L", cx - R * 0.74, cy - R * 0.74 - 4 * dpr);
      label("R", cx + R * 0.74, cy - R * 0.74 - 4 * dpr);
      label("S", cx - R - 8 * dpr, cy - 2 * dpr);
      label("S", cx + R + 8 * dpr, cy - 2 * dpr);
    }
    g.setLineDash([]);
  }

  draw(batch, dt) {
    const ctx = this.b, geo = this.geometry(), { W, H } = geo;
    const frames = batch.length >> 1;

    if (frames) {
      let peak = 0;
      for (let i = 0; i < batch.length; ++i) { const a = Math.abs(batch[i]); if (a > peak) peak = a; }
      this.envelope = Math.max(peak, this.envelope * Math.exp(-dt / 1.5));
    }
    if (this.auto) {
      const target = clamp(0.92 / Math.max(this.envelope * Math.SQRT2, 0.02), 0.5, 24);
      this.gain += (target - this.gain) * (target < this.gain ? 1 - Math.exp(-dt * 12) : 1 - Math.exp(-dt * 1.5));
    }

    const persistence = this.mode === "level" ? 0.5 : this.mode === "polar" ? 0.28 : 0.22;
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = `rgba(0,0,0,${1 - Math.pow(1 - persistence, dt * 60)})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";

    if (this.mode === "liss") this.lissajous(batch, frames, geo);
    else if (this.mode === "polar") this.polarSample(batch, frames, geo);
    else this.polarLevel(batch, frames, geo, dt);

    ctx.globalCompositeOperation = "source-over";
    this.o.clearRect(0, 0, this.bloom.width, this.bloom.height);
    this.o.drawImage(this.beam, 0, 0, this.bloom.width, this.bloom.height);
  }

  lissajous(batch, frames, { cx, cy, R, W }) {
    if (!frames) return;
    const ctx = this.b, k = R * this.gain * SQ, dpr = W / 240;
    ctx.lineWidth = 1.1 * dpr;
    ctx.lineJoin = "round";
    let px = this.last ? this.last[0] : cx + (batch[1] - batch[0]) * k;
    let py = this.last ? this.last[1] : cy - (batch[0] + batch[1]) * k;
    const chunk = 48;
    for (let s = 0; s < frames; s += chunk) {
      const e = Math.min(frames, s + chunk);
      let ll = 0, rr = 0, lr = 0;
      for (let i = s; i < e; ++i) { const l = batch[2 * i], r = batch[2 * i + 1]; ll += l * l; rr += r * r; lr += l * r; }
      const c = ll * rr > 1e-14 ? lr / Math.sqrt(ll * rr) : 1;
      ctx.strokeStyle = rgba(corrColour(c), 0.24);
      ctx.beginPath();
      ctx.moveTo(px, py);
      for (let i = s; i < e; ++i) {
        const l = batch[2 * i], r = batch[2 * i + 1];
        px = cx + (r - l) * k;
        py = cy - (l + r) * k;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    this.last = [px, py];
    ctx.fillStyle = "rgba(255,244,232,0.95)";
    ctx.beginPath(); ctx.arc(px, py, 1.6 * dpr, 0, Math.PI * 2); ctx.fill();
  }

  project(l, r) {
    let m = (l + r) * SQ, s = (r - l) * SQ;
    if (m < 0) { m = -m; s = -s; }
    return [Math.atan2(s, m), Math.hypot(s, m) * this.gain];
  }

  polarSample(batch, frames, { cx, cy, R, W }) {
    if (!frames) return;
    const ctx = this.b, size = 1.5 * (W / 240);
    for (const p of this.points) p.n = 0;
    for (let i = 0; i < frames; ++i) {
      const [theta, a] = this.project(batch[2 * i], batch[2 * i + 1]);
      const rn = clamp((db(a) + 48) / 48, 0, 1);
      if (rn <= 0) continue;
      const bucket = this.points[clamp(Math.floor(((theta + HALF_PI) / Math.PI) * 16), 0, 15)];
      if (bucket.n >= bucket.xs.length) continue;
      bucket.xs[bucket.n] = cx + R * rn * Math.sin(theta);
      bucket.ys[bucket.n++] = cy - R * rn * Math.cos(theta);
    }
    this.points.forEach((p, i) => {
      if (!p.n) return;
      ctx.fillStyle = this.styles[i];
      ctx.beginPath();
      for (let j = 0; j < p.n; ++j) ctx.rect(p.xs[j] - size / 2, p.ys[j] - size / 2, size, size);
      ctx.fill();
    });
  }

  polarLevel(batch, frames, { cx, cy, R, W }, dt) {
    const ctx = this.b, n = this.bins, now = performance.now(), dpr = W / 240;
    const fresh = this.scratch.fill(0);
    for (let i = 0; i < frames; ++i) {
      const [theta, a] = this.project(batch[2 * i], batch[2 * i + 1]);
      const bin = clamp(Math.floor(((theta + HALF_PI) / Math.PI) * n), 0, n - 1);
      if (a > fresh[bin]) fresh[bin] = a;
    }
    for (let b = 0; b < n; ++b) {
      const rn = clamp((db(fresh[b]) + 48) / 48, 0, 1);
      this.level[b] = Math.max(rn, this.level[b] - 0.55 * dt);
      if (rn >= this.holdLevel[b]) { this.holdLevel[b] = rn; this.holdAt[b] = now; }
      else if (now - this.holdAt[b] > 900) this.holdLevel[b] = Math.max(0, this.holdLevel[b] - 0.35 * dt);
    }
    const smooth = (arr, b) => (arr[Math.max(0, b - 1)] + 2 * arr[b] + arr[Math.min(n - 1, b + 1)]) / 4;
    const step = Math.PI / n;
    for (let b = 0; b < n; ++b) {
      const lv = smooth(this.level, b);
      if (lv <= 0.002) continue;
      const theta = -HALF_PI + (b + 0.5) * step, colour = angleColour(theta);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * lv);
      grad.addColorStop(0, rgba(colour, 0.02));
      grad.addColorStop(1, rgba(colour, 0.42));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R * lv, theta - HALF_PI - step * 0.42, theta - HALF_PI + step * 0.42);
      ctx.closePath();
      ctx.fill();
    }
    ctx.lineWidth = 1.2 * dpr;
    ctx.strokeStyle = "rgba(255,236,220,0.65)";
    ctx.beginPath();
    for (let b = 0; b < n; ++b) {
      const theta = -HALF_PI + (b + 0.5) * step, r = R * smooth(this.level, b);
      const x = cx + r * Math.sin(theta), y = cy - r * Math.cos(theta);
      b ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    for (let b = 0; b < n; b += 2) {
      const h = this.holdLevel[b];
      if (h <= 0.01) continue;
      const theta = -HALF_PI + (b + 0.5) * step;
      ctx.fillRect(cx + R * h * Math.sin(theta) - dpr * 0.8, cy - R * h * Math.cos(theta) - dpr * 0.8, dpr * 1.6, dpr * 1.6);
    }
  }
}

class FFT {
  constructor(n) {
    this.n = n;
    this.cos = new Float32Array(n / 2);
    this.sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; ++i) { this.cos[i] = Math.cos((2 * Math.PI * i) / n); this.sin[i] = Math.sin((2 * Math.PI * i) / n); }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; ++i) {
      let r = 0;
      for (let b = 0; b < bits; ++b) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
  }

  transform(re, im) {
    const n = this.n;
    for (let i = 0; i < n; ++i) {
      const j = this.rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; ++j, k += step) {
          const a = i + j, b = a + half;
          const tr = re[b] * this.cos[k] + im[b] * this.sin[k];
          const ti = im[b] * this.cos[k] - re[b] * this.sin[k];
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  }
}

export class Signal {
  constructor(canvas, hud) {
    this.canvas = canvas;
    this.hud = hud;
    this.ctx = canvas.getContext("2d");
    this.mode = "spec";
    this.span = 1024;
    this.N = 4096;
    this.fft = new FFT(this.N);
    this.window = new Float32Array(this.N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (this.N - 1)));
    this.L = new Float32Array(8192 + 4096);
    this.R = new Float32Array(8192 + 4096);
    this.re = new Float32Array(this.N);
    this.im = new Float32Array(this.N);
    this.mid = new Float32Array(this.N / 2).fill(-140);
    this.side = new Float32Array(this.N / 2).fill(-140);
    this.peak = new Float32Array(this.N / 2).fill(-140);
    this.hover = null;
    canvas.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      this.hover = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    });
    canvas.addEventListener("pointerleave", () => { this.hover = null; });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (this.mode === "wave") this.span = clamp(Math.round(this.span * Math.pow(1.002, e.deltaY)), 128, 8192);
    }, { passive: false });
  }

  resize() { fit(this.canvas); }
  setMode(mode) { this.mode = mode; }

  draw(stream, dt) {
    const { ctx, canvas } = this, W = canvas.width, H = canvas.height, dpr = W / (canvas.offsetWidth || W);
    ctx.clearRect(0, 0, W, H);
    ctx.font = `700 ${10.5 * dpr}px ${CONDENSED}`;
    if (this.mode === "wave") this.wave(stream, W, H, dpr);
    else this.spectrum(stream, W, H, dpr, dt);
  }

  wave(stream, W, H, dpr) {
    const { ctx } = this, n = this.span, search = Math.min(n, 4096), L = this.L, R = this.R;
    stream.tail(n + search, L, R);
    let start = search, triggered = false;
    for (let i = search - 1; i > 0; --i) {
      if (L[i - 1] + R[i - 1] < 0 && L[i] + R[i] >= 0) { start = i; triggered = true; break; }
    }
    let peak = 0.05;
    for (let i = start; i < start + n; ++i) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    const mid = H / 2, amp = (H * 0.42) / Math.min(1, peak * 1.1);
    ctx.strokeStyle = "rgba(240,228,212,0.08)";
    ctx.lineWidth = dpr;
    ctx.beginPath();
    for (let i = 1; i < 8; ++i) { const x = (i / 8) * W; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (const f of [-0.5, 0, 0.5]) { const y = mid - f * H * 0.84; ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    const trace = (buf, colour) => {
      ctx.beginPath();
      for (let x = 0; x < W; ++x) {
        const i = start + Math.floor((x / W) * n), y = mid - buf[i] * amp;
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.lineWidth = 4 * dpr; ctx.strokeStyle = rgba(colour, 0.12); ctx.stroke();
      ctx.lineWidth = 1.2 * dpr; ctx.strokeStyle = rgba(colour, 0.9); ctx.stroke();
    };
    ctx.globalCompositeOperation = "lighter";
    trace(R, [63, 163, 192]);
    trace(L, [255, 93, 31]);
    ctx.globalCompositeOperation = "source-over";
    const ms = (n / stream.sampleRate) * 1000;
    this.hud.innerHTML = `<span style="color:#ff5d1f">L</span> <span style="color:#3fa3c0">R</span> · ${ms.toFixed(1)} ms · ${triggered ? "trig M↑" : "free"}`;
  }

  spectrum(stream, W, H, dpr, dt) {
    const { ctx, N, re, im } = this, sr = stream.sampleRate, half = N / 2;
    stream.tail(N, this.L, this.R);
    for (let i = 0; i < N; ++i) {
      const w = this.window[i];
      re[i] = (this.L[i] + this.R[i]) * 0.5 * w;
      im[i] = (this.L[i] - this.R[i]) * 0.5 * w;
    }
    this.fft.transform(re, im);
    const scale = 4 / N, attack = 1 - Math.exp(-dt * 40), release = 1 - Math.exp(-dt * 5);
    for (let k = 1; k < half; ++k) {
      const a = re[k], b = im[k], c = re[N - k], d = im[N - k];
      const m = db(Math.hypot(a + c, b - d) * 0.5 * scale), s = db(Math.hypot(a - c, b + d) * 0.5 * scale);
      this.mid[k] += (m - this.mid[k]) * (m > this.mid[k] ? attack : release);
      this.side[k] += (s - this.side[k]) * (s > this.side[k] ? attack : release);
      this.peak[k] = Math.max(this.mid[k], this.peak[k] - 9 * dt);
    }
    const fMin = 20, fMax = Math.min(20000, sr / 2), lr = Math.log(fMax / fMin), top = 6 * dpr, bottom = H - 15 * dpr;
    const xOf = (f) => (Math.log(f / fMin) / lr) * W;
    const yOf = (v) => top + clamp((0 - v) / 90, 0, 1) * (bottom - top);
    ctx.lineWidth = dpr;
    ctx.strokeStyle = "rgba(240,228,212,0.08)";
    ctx.fillStyle = "rgba(240,228,212,0.6)";
    ctx.beginPath();
    for (const v of [-12, -24, -36, -48, -60, -72, -84]) { const y = yOf(v); ctx.moveTo(0, y); ctx.lineTo(W, y); }
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { const x = xOf(f); ctx.moveTo(x, top); ctx.lineTo(x, bottom); }
    ctx.stroke();
    ctx.textAlign = "center";
    for (const [f, t] of [[100, "100"], [1000, "1k"], [10000, "10k"]]) ctx.fillText(t, xOf(f), H - 3 * dpr);
    ctx.textAlign = "right";
    for (const v of [-24, -48, -72]) ctx.fillText(`${v}`, W - 3 * dpr, yOf(v) - 3 * dpr);

    const sample = (arr, x) => {
      const f0 = fMin * Math.exp((x / W) * lr), f1 = fMin * Math.exp(((x + 1) / W) * lr);
      const k0 = (f0 * N) / sr, k1 = (f1 * N) / sr;
      if (k1 - k0 < 1) {
        const i = Math.floor(k0), t = k0 - i;
        return arr[clamp(i, 1, half - 1)] * (1 - t) + arr[clamp(i + 1, 1, half - 1)] * t;
      }
      let v = -200;
      for (let k = Math.floor(k0); k <= Math.ceil(k1) && k < half; ++k) v = Math.max(v, arr[k]);
      return v;
    };
    const path = (arr, step) => {
      ctx.beginPath();
      for (let x = 0; x <= W; x += step) { const y = yOf(sample(arr, x)); x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    };
    const step = Math.max(1, Math.round(dpr));
    path(this.mid, step);
    ctx.lineTo(W, bottom); ctx.lineTo(0, bottom); ctx.closePath();
    const fill = ctx.createLinearGradient(0, top, 0, bottom);
    fill.addColorStop(0, "rgba(255,93,31,0.45)");
    fill.addColorStop(1, "rgba(255,93,31,0.03)");
    ctx.fillStyle = fill;
    ctx.fill();
    path(this.mid, step);
    ctx.lineWidth = 1.4 * dpr; ctx.strokeStyle = "rgba(255,130,70,1)"; ctx.stroke();
    path(this.side, step);
    ctx.lineWidth = 1.2 * dpr; ctx.strokeStyle = "rgba(63,163,192,0.9)"; ctx.stroke();
    path(this.peak, step * 2);
    ctx.lineWidth = dpr; ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.stroke();

    let hud = `<span style="color:#ff5d1f">MID</span> <span style="color:#3fa3c0">SIDE</span> · ${N} pt · ${(sr / 1000).toFixed(1)} kHz`;
    if (this.hover) {
      const x = this.hover.x * W, f = fMin * Math.exp(this.hover.x * lr), v = sample(this.mid, x);
      const note = 12 * Math.log2(f / 440) + 69, ni = Math.round(note);
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(x, yOf(v), 2.5 * dpr, 0, Math.PI * 2); ctx.fill();
      hud = `${f >= 1000 ? (f / 1000).toFixed(2) + " kHz" : f.toFixed(0) + " Hz"} · ${NOTES[((ni % 12) + 12) % 12]}${Math.floor(ni / 12) - 1} ${((note - ni) * 100).toFixed(0).padStart(3, " ")}¢ · ${v.toFixed(1)} dB`;
    }
    this.hud.innerHTML = hud;
  }
}
