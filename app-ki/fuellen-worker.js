// Hintergrund-Rechner (Web Worker) für die KI „LaMa“: rechnet abseits der Bedienoberfläche, damit die Seite
// während der Berechnung bedienbar bleibt. Bekommt Bild und Maske als Zahlenfelder (512 × 512) und gibt das
// ergänzte Bild zurück. Lokal, ohne Verbindung nach außen.
import * as ort from './lib/ort/ort.wasm.min.mjs';

ort.env.wasm.wasmPaths = new URL('./lib/ort/', import.meta.url).href;
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
ort.env.wasm.proxy = false;

const MODELL_URL = new URL('./modelle/inpainting_lama_2025jan.onnx', import.meta.url).href;
const N = 512;
let sitzung = null;

self.onmessage = async (e) => {
  const { id, bild, maske } = e.data;
  try {
    if (!sitzung) {
      self.postMessage({ id, art: 'status', text: 'KI zum Ergänzen verdeckter Bereiche wird geladen (einmalig, ca. 93 MB vom eigenen Rechner/Server) …' });
      sitzung = await ort.InferenceSession.create(MODELL_URL, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    }
    self.postMessage({ id, art: 'status', text: 'Verdeckte Bereiche werden ergänzt (lokal, im Hintergrund) …' });
    const ein = {};
    for (const name of sitzung.inputNames) ein[name] = /mask/i.test(name) ? new ort.Tensor('float32', maske, [1, 1, N, N]) : new ort.Tensor('float32', bild, [1, 3, N, N]);
    const aus = (await sitzung.run(ein))[sitzung.outputNames[0]];
    const daten = Float32Array.from(aus.data);
    self.postMessage({ id, art: 'fertig', daten, dims: aus.dims }, [daten.buffer]);
  } catch (err) {
    self.postMessage({ id, art: 'fehler', text: String(err?.message || err) });
  }
};
