import { Analysis, Signal, Stream, Vectorscope } from "./viz.js";

if (!window.__JUCE__) await import("./mock.js");

const $ = (id) => document.getElementById(id);
const pending = new Map();
let nextPromise = 0;
window.__JUCE__?.backend?.addEventListener("__juce__complete", ({ promiseId, result }) => {
  pending.get(promiseId)?.(result);
  pending.delete(promiseId);
});
const native = (name) => (...params) => {
  const backend = window.__JUCE__?.backend;
  if (!backend) return Promise.resolve(null);
  return new Promise((resolve) => {
    const resultId = nextPromise++;
    pending.set(resultId, resolve);
    backend.emitEvent("__juce__invoke", { name, params, resultId });
  });
};
const getView = native("getView"), setView = native("setView");

function tabs(host, items, onChange) {
  const buttons = items.map(({ label, value }) => {
    const b = document.createElement("button");
    b.className = "tab";
    b.textContent = label;
    b.addEventListener("click", () => { set(value); onChange(value); });
    host.appendChild(b);
    return { b, value };
  });
  const rest = document.createElement("div");
  rest.className = "tab-rest";
  host.appendChild(rest);
  const set = (value) => buttons.forEach((x) => x.b.setAttribute("aria-pressed", String(x.value === value)));
  return { set };
}

const dbOf = (a) => (a > 1e-9 ? 20 * Math.log10(a) : -200);
const meterHeight = (db) => Math.min(1, Math.max(0, (db + 60) / 66));
const dbText = (db) => (db <= -100 ? "−∞" : `${db < 0 ? "−" : "+"}${Math.abs(db).toFixed(1)}`);

async function boot() {
  const stream = new Stream("scope.bin");
  const analysis = new Analysis();
  const scope = new Vectorscope($("scope"));
  const signal = new Signal($("sigCanvas"), $("sigHud"));
  const saved = (await getView()) ?? { view: "liss", signal: "spec" };
  scope.mode = saved.view;
  signal.mode = saved.signal;
  const persist = () => setView(scope.mode, signal.mode);
  const scopeMode = tabs($("scopeMode"), [{ label: "Lissajous", value: "liss" }, { label: "Polar", value: "polar" },
    { label: "Level", value: "level" }], (m) => { scope.setMode(m); persist(); });
  const sigMode = tabs($("sigMode"), [{ label: "Spectrum", value: "spec" }, { label: "Wave", value: "wave" }],
    (m) => { signal.setMode(m); persist(); });
  scopeMode.set(scope.mode);
  sigMode.set(signal.mode);

  const zoom = $("scopeZoom"), auto = $("scopeAuto");
  const syncZoom = () => auto.setAttribute("aria-pressed", String(scope.auto));
  scope.onZoom = syncZoom;
  auto.addEventListener("click", (e) => { e.stopPropagation(); scope.auto = !scope.auto; syncZoom(); });

  const meters = ["meterL", "meterR"].map((id) => {
    const root = $(id);
    return { root, rms: root.querySelector(".rms"), pk: root.querySelector(".pk"), hold: root.querySelector(".hold") };
  });
  const bars = [$("corr"), $("bal")].map((b) => ({ fill: b.querySelector(".hb-fill"), dot: b.querySelector(".hb-dot"), out: b.querySelector("output") }));
  const width = $("width"), peaks = [$("peakL"), $("peakR")], scopeRoot = $("scope");
  const EMPTY = new Float32Array(0);
  let idleFrames = 0, textClock = 0, last = performance.now();

  const placeBar = ({ fill, dot }, v) => {
    const x = 50 + v * 50;
    dot.style.left = `${x}%`;
    fill.style.left = `${Math.min(50, x)}%`;
    fill.style.width = `${Math.abs(v) * 50}%`;
  };

  const frame = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    stream.pull();
    const batch = stream.fresh ? stream.batch : EMPTY;
    stream.fresh = false;
    analysis.feed(batch, stream.sampleRate);
    analysis.step(dt, now);
    scope.draw(batch, dt);
    idleFrames = stream.idle ? idleFrames + 1 : 0;
    if (idleFrames < 240) signal.draw(stream, dt);
    scopeRoot.classList.toggle("idle", stream.idle && !analysis.signal);
    meters.forEach((m, c) => {
      m.rms.style.height = `${meterHeight(dbOf(Math.sqrt(analysis.ms[c]))) * 100}%`;
      m.pk.style.height = `${meterHeight(analysis.peak[c]) * 100}%`;
      m.hold.style.bottom = `calc(${meterHeight(analysis.hold[c]) * 100}% - 1px)`;
      m.root.classList.toggle("clip", now < analysis.clipUntil[c]);
    });
    const negative = analysis.corrShown < 0;
    placeBar(bars[0], analysis.corrShown);
    bars[0].dot.style.setProperty("--dc", negative ? "var(--danger)" : "var(--orange)");
    bars[0].fill.style.background = negative ? "rgba(255,65,54,.8)" : "rgba(255,93,31,.8)";
    placeBar(bars[1], analysis.balShown);
    bars[1].dot.style.setProperty("--dc", "var(--teal)");
    bars[1].fill.style.background = "rgba(63,163,192,.8)";
    if ((textClock += dt) > 0.08) {
      textClock = 0;
      bars[0].out.textContent = analysis.signal ? `${analysis.corr >= 0 ? "+" : "−"}${Math.abs(analysis.corr).toFixed(2)}` : "—";
      const b = analysis.balanceDb;
      bars[1].out.textContent = !analysis.signal ? "—" : Math.abs(b) < 0.1 ? "C" : `${b < 0 ? "L" : "R"} ${Math.abs(b).toFixed(1)}`;
      width.textContent = analysis.signal ? `${Math.round(analysis.width * 100)}%` : "—";
      peaks.forEach((p, c) => { p.textContent = dbText(analysis.hold[c]); });
      zoom.textContent = `×${scope.gain.toFixed(1)}`;
    }
    requestAnimationFrame(frame);
  };
  const resize = () => { scope.resize(); signal.resize(); };
  addEventListener("resize", resize);
  requestAnimationFrame(() => { resize(); requestAnimationFrame(frame); });
}

boot();
