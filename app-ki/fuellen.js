// Verdeckte Bereiche mit KI ergänzen: „LaMa“ (Large Mask Inpainting, OpenCV-Modellsammlung, Apache 2.0).
// Läuft lokal im Browser (ONNX/WebAssembly), das Foto verlässt den Rechner nicht.
//
// Wofür: Hinter Bäumen, Büschen und Hausecken zeigt ein Foto nichts. Beim Umschauen wird dort die Hintergrundebene
// sichtbar. Statt die Lücke nur zu verwischen, malt LaMa plausibel weiter, was dahinter liegen dürfte
// (Rasen, Hecke, Wand, Himmel) – passend zu Mustern und Farben ringsum.
// Das eigentliche Rechnen läuft in einem Web Worker (fuellen-worker.js), damit die Seite bedienbar bleibt.
const N = 512; // feste Eingabegröße des Modells

let rechner = null, naechsteId = 1;
const auftraege = new Map();
function rechnerHolen() {
  if (rechner) return rechner;
  rechner = new Worker(new URL('./fuellen-worker.js', import.meta.url), { type: 'module' });
  rechner.onmessage = (e) => {
    const a = auftraege.get(e.data.id); if (!a) return;
    if (e.data.art === 'status') a.fortschritt?.(e.data.text);
    else { auftraege.delete(e.data.id); e.data.art === 'fertig' ? a.ok(e.data) : a.fehler(new Error(e.data.text)); }
  };
  rechner.onerror = (e) => { for (const a of auftraege.values()) a.fehler(new Error(e.message || 'Hintergrund-Rechner ausgefallen')); auftraege.clear(); rechner = null; };
  return rechner;
}
function rechnen(bild, maske, fortschritt) {
  return new Promise((ok, fehler) => {
    const id = naechsteId++;
    auftraege.set(id, { ok, fehler, fortschritt });
    rechnerHolen().postMessage({ id, bild, maske }, [bild.buffer, maske.buffer]);
  });
}

/**
 * Ergänzt die markierten Stellen eines Bildes.
 * bild: Canvas (beliebige Größe), maske: Uint8Array (bild.width × bild.height, 1 = ergänzen).
 * Rückgabe: neues Canvas gleicher Größe; unmarkierte Bildpunkte bleiben unverändert.
 */
export async function lamaFuellen(bild, maske, fortschritt) {
  const w = bild.width, h = bild.height;
  let anteil = 0; for (const m of maske) anteil += m; anteil /= maske.length;
  if (anteil < 0.002) return bild;                        // nichts zu ergänzen

  // Eingabe: Bild auf 512 × 512 skalieren (RGB 0…1), Maske ebenso (etwas verbreitert, damit Kantenreste mitgefüllt werden)
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(bild, 0, 0, N, N);
  const px = g.getImageData(0, 0, N, N).data;
  const m512 = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) m512[y * N + x] = maske[Math.min(h - 1, Math.floor((y * h) / N)) * w + Math.min(w - 1, Math.floor((x * w) / N))];
  const breit = verbreitern(m512, N, 4);
  const bildT = new Float32Array(3 * N * N), maskeT = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    for (let k = 0; k < 3; k++) bildT[k * N * N + i] = px[i * 4 + k] / 255;
    maskeT[i] = breit[i];
  }
  const aus = await rechnen(bildT, maskeT, fortschritt);
  const d = aus.daten, skala = maxWert(d) <= 1.5 ? 255 : 1; // Ausgabe 0…255 (manche Exporte 0…1)

  // Ergebnis auf 512 × 512 malen, auf Originalgröße bringen und nur in der Maske (weich überblendet) übernehmen
  const erg = g.createImageData(N, N);
  for (let i = 0; i < N * N; i++) { for (let k = 0; k < 3; k++) erg.data[i * 4 + k] = d[k * N * N + i] * skala; erg.data[i * 4 + 3] = 255; }
  g.putImageData(erg, 0, 0);
  const ziel = document.createElement('canvas'); ziel.width = w; ziel.height = h;
  const zg = ziel.getContext('2d', { willReadFrequently: true }); zg.drawImage(bild, 0, 0);
  const alt = zg.getImageData(0, 0, w, h);
  zg.imageSmoothingQuality = 'high'; zg.drawImage(c, 0, 0, w, h);
  const neu = zg.getImageData(0, 0, w, h), weich = weichzeichnen(verbreitern(maske, w, 2, h), w, h, 2);
  for (let i = 0; i < w * h; i++) {
    const a = weich[i];
    for (let k = 0; k < 3; k++) neu.data[i * 4 + k] = alt.data[i * 4 + k] * (1 - a) + neu.data[i * 4 + k] * a;
  }
  zg.putImageData(neu, 0, 0);
  return ziel;
}

function maxWert(d) { let m = -Infinity; for (let i = 0; i < d.length; i += 97) m = Math.max(m, d[i]); return m; }

/** Maske um r Bildpunkte verbreitern (quadratisch). */
function verbreitern(m, w, r, h = w) {
  const a = new Uint8Array(w * h), b = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let k = -r; k <= r && !v; k++) { const xx = x + k; if (xx >= 0 && xx < w) v = m[y * w + xx]; } a[y * w + x] = v; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let k = -r; k <= r && !v; k++) { const yy = y + k; if (yy >= 0 && yy < h) v = a[yy * w + x]; } b[y * w + x] = v; }
  return b;
}
/** Weiche Kante (Mittelwert über ±r) als Gewicht 0…1. */
function weichzeichnen(m, w, h, r) {
  const a = new Float32Array(w * h), b = new Float32Array(w * h), n = 2 * r + 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let k = -r; k <= r; k++) s += m[y * w + Math.min(w - 1, Math.max(0, x + k))]; a[y * w + x] = s / n; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let k = -r; k <= r; k++) s += a[Math.min(h - 1, Math.max(0, y + k)) * w + x]; b[y * w + x] = s / n; }
  return b;
}
