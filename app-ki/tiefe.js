// Tiefenschätzung aus einem einzelnen Foto mit „Depth Anything V2 Small“ (lokal im Browser, ONNX/WebAssembly).
// Modell und Rechenkern liegen im Projektordner (modelle/, lib/ort/). Es gibt keine Verbindung nach außen,
// das Foto verlässt den Rechner nicht.
//
// Ergebnis: relative inverse Tiefe (Disparität) je Bildpunkt – groß = nah, klein = fern.
// Den echten Maßstab (Meter) bestimmt erst gelaende.js über die Bodenebene und die Kamerahöhe.
import * as ort from './lib/ort/ort.wasm.min.mjs';

const MODELL_URL = new URL('./modelle/depth-anything-v2-small-q8.onnx', import.meta.url).href;
const MITTEL = [0.485, 0.456, 0.406], STREUUNG = [0.229, 0.224, 0.225]; // aus preprocessor_config.json

ort.env.wasm.wasmPaths = new URL('./lib/ort/', import.meta.url).href;
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
ort.env.wasm.proxy = false;

let sitzung = null;
async function sitzungHolen(fortschritt) {
  if (sitzung) return sitzung;
  fortschritt?.('KI-Modell wird geladen (einmalig, ca. 27 MB vom eigenen Rechner/Server) …');
  sitzung = await ort.InferenceSession.create(MODELL_URL, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  return sitzung;
}

/** Eingabegröße: kürzere Seite 518 px, beide Seiten Vielfache von 14 (wie im Original-Vorverarbeiter). */
function eingabeGroesse(w, h) {
  const s = 518 / Math.min(w, h);
  const r14 = (x) => Math.max(14, Math.round((x * s) / 14) * 14);
  let bw = r14(w), bh = r14(h);
  const max = 784; // längere Seite begrenzen (Rechenzeit auf Laptops)
  if (Math.max(bw, bh) > max) { const f = max / Math.max(bw, bh); bw = Math.round((bw * f) / 14) * 14; bh = Math.round((bh * f) / 14) * 14; }
  return [bw, bh];
}

/**
 * Berechnet die Disparität eines Bildes.
 * Rückgabe: { daten: Float32Array (breite × hoehe), breite, hoehe, min, max }
 */
export async function tiefeSchaetzen(img, fortschritt) {
  const s = await sitzungHolen(fortschritt);
  fortschritt?.('Tiefe wird berechnet …');
  const [w, h] = eingabeGroesse(img.naturalWidth, img.naturalHeight);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data, n = w * h;
  const eingabe = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) eingabe[k * n + i] = (px[i * 4 + k] / 255 - MITTEL[k]) / STREUUNG[k];
  // Rechnen erst im nächsten Bild starten, damit die Fortschrittsanzeige sichtbar wird
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const t0 = performance.now();
  const ergebnis = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', eingabe, [1, 3, h, w]) });
  const aus = ergebnis[s.outputNames[0]];
  const [oh, ow] = aus.dims.slice(-2);
  const daten = Float32Array.from(aus.data);
  let min = Infinity, max = -Infinity;
  for (const v of daten) { if (v < min) min = v; if (v > max) max = v; }
  return { daten, breite: ow, hoehe: oh, min, max, ms: Math.round(performance.now() - t0) };
}
