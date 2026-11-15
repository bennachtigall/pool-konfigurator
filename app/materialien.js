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
  _wasser.wrapS = _wasser.wrapT = THREE.RepeatWrapping; _wasser.repeat.set(0.45, 0.45); _wasser.anisotropy = 8;
  return _wasser;
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
