// Gemeinsame Texturen für realistischere Oberflächen (alles prozedural, keine Bilddateien, keine Verbindung nach außen).
import * as THREE from 'three';

/** Normalmap für die Wasseroberfläche: überlagerte Wellen, nahtlos kachelbar. */
let _wasser = null;
export function wasserNormal() {
  if (_wasser) return _wasser;
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N);
  const wellen = [[3, 1, 0.9, 0.3], [2, 4, 0.6, 1.7], [5, 3, 0.4, 2.9], [7, 6, 0.25, 4.1], [1, 7, 0.3, 5.3], [9, 2, 0.18, 0.7]]; // [kx, ky, Amplitude, Phase]
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let dx = 0, dy = 0;
    for (const [kx, ky, A, ph] of wellen) {
      const arg = ((kx * x + ky * y) / N) * Math.PI * 2 + ph, d = Math.cos(arg) * A * Math.PI * 2 / N;
      dx += d * kx; dy += d * ky;
    }
    const l = Math.hypot(dx * 8, dy * 8, 1), i = (y * N + x) * 4;
    img.data[i] = ((-dx * 8) / l * 0.5 + 0.5) * 255; img.data[i + 1] = ((-dy * 8) / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  _wasser = new THREE.CanvasTexture(c);
  _wasser.wrapS = _wasser.wrapT = THREE.RepeatWrapping; _wasser.repeat.set(1.4, 1.4); // feine Wellen (ca. 70 cm Kachel) _wasser.anisotropy = 8;
  return _wasser;
}

/**
 * Wellen-Normalmap für das Spiegelwasser: viele Wellen in zufälligen Richtungen (feste Startzahl, also immer gleich),
 * größere Wellen flacher, kleine Kräusel feiner – dadurch kein sichtbares Kachelmuster. Nahtlos kachelbar.
 */
const _wellen = {};
export function wasserWellen(startzahl = 1) {
  if (_wellen[startzahl]) return _wellen[startzahl];
  let z = (startzahl * 0x9e3779b9) >>> 0; // kleiner Zufallsgenerator (mulberry32), immer gleiche Folge
  const zufall = () => { z = (z + 0x6d2b79f5) >>> 0; let t = z; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const N = 512, wellen = [];
  for (let i = 0; i < 56; i++) {
    const k = 2 + Math.floor(Math.pow(zufall(), 1.6) * 22);              // Wellenzahl je Kachel (2 … 23)
    const w = zufall() * Math.PI * 2;
    const kx = Math.round(Math.cos(w) * k), ky = Math.round(Math.sin(w) * k);
    if (!kx && !ky) continue;
    wellen.push([kx, ky, 1.1 / Math.pow(Math.hypot(kx, ky), 1.15), zufall() * Math.PI * 2]);
  }
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N);
  const st = 1.3; // Steilheit der Wellen (Poolwasser ist ruhig)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let dx = 0, dy = 0;
    for (const [kx, ky, A, ph] of wellen) {
      const arg = ((kx * x + ky * y) / N) * Math.PI * 2 + ph, d = Math.cos(arg) * A;
      dx += d * kx; dy += d * ky;
    }
    dx *= st / 40; dy *= st / 40;
    const l = Math.hypot(dx, dy, 1), i = (y * N + x) * 4;
    img.data[i] = (-dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (-dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return (_wellen[startzahl] = t);
}

/** Körnige Rauheits-/Bump-Textur für Stein, Beton und Styropor. */
const _rau = {};
export function rauTextur(korn = 1) {
  if (_rau[korn]) return _rau[korn];
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, N, N);
  for (let i = 0; i < 9000 * korn; i++) { const v = 90 + Math.random() * 90; g.fillStyle = `rgb(${v},${v},${v})`; const s = 1 + Math.random() * 2 * korn; g.fillRect(Math.random() * N, Math.random() * N, s, s); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2); t.anisotropy = 8;
  return (_rau[korn] = t);
}

/**
 * Lichtmuster am Beckenboden (Kaustik): kachelbares Voronoi-Netz mit hellen, dünnen Linien.
 * Wird additiv über den Boden gelegt und in der Qualität "Ultra" langsam bewegt.
 */
let _kaustik = null;
export function kaustikTextur() {
  if (_kaustik) return _kaustik;
  const N = 256, Z = 26, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N);
  const pts = Array.from({ length: Z }, () => [Math.random() * N, Math.random() * N]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let d1 = 1e9, d2 = 1e9;
    for (const [px, py] of pts) for (let ox = -N; ox <= N; ox += N) for (let oy = -N; oy <= N; oy += N) { // kachelbar
      const dx = x - px - ox, dy = y - py - oy, d = dx * dx + dy * dy;
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    const kante = Math.sqrt(d2) - Math.sqrt(d1);              // klein an den Zellgrenzen
    const v = Math.max(0, 1 - kante / 6) ** 2.2 * 255;
    const i = (y * N + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  _kaustik = new THREE.CanvasTexture(c);
  _kaustik.wrapS = _kaustik.wrapT = THREE.RepeatWrapping; _kaustik.colorSpace = THREE.SRGBColorSpace; _kaustik.anisotropy = 8;
  return _kaustik;
}
