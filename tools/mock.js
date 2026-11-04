const SR = 48000;
let last = performance.now(), t = 0;
const realFetch = window.fetch.bind(window);
window.fetch = (url, options) => {
  if (!String(url).includes("scope.bin")) return realFetch(url, options);
  const now = performance.now(), frames = Math.min(8192, Math.round(((now - last) / 1000) * SR));
  last = now;
  const buffer = new ArrayBuffer(32 + frames * 8), view = new DataView(buffer);
  view.setUint32(0, 0x6373454a, true); view.setUint16(4, 1, true); view.setUint16(6, 32, true); view.setFloat32(8, SR, true);
  view.setUint32(12, frames, true); view.setUint32(24, 1, true);
  const samples = new Float32Array(buffer, 32);
  for (let i = 0; i < frames; ++i, t += 1 / SR) {
    const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.3 * t);
    const a = Math.sin(2 * Math.PI * 220 * t + 2 * Math.sin(2 * Math.PI * 440 * t) * env);
    const b = Math.sin(2 * Math.PI * 330.7 * t), c = Math.sin(2 * Math.PI * 277.2 * t + 0.3);
    samples[2 * i] = 0.35 * a + 0.2 * b + 0.15 * c;
    samples[2 * i + 1] = 0.35 * a + 0.12 * b - 0.2 * c;
  }
  return Promise.resolve(new Response(buffer));
};
