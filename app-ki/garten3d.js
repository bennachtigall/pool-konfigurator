// Kundengarten 3D: aus 1–4 Gartenfotos (oder einem 360°-Panorama) wird eine Umgebung rund um den Pool gebaut,
// in der man sich frei umschauen kann. Die Fotos werden zu einem Rundum-Bild (Panorama) zusammengesetzt und auf
// eine Kuppel mit flachem Boden projiziert. Nah am Pool liegt ein echter 3D-Boden (Rasen, Pflaster, Kies).
// Wasser, Glas und Metall spiegeln die Garten-Umgebung.
//
// Grenzen (ehrlich): Aus normalen Fotos lässt sich lokal keine echte 3D-Geometrie (Bäume, Haus) berechnen. Die Fotos
// wirken wie eine Kulisse in der gewählten Entfernung. Am besten funktioniert ein 360°-Panorama, das vom späteren
// Pool-Standort aus aufgenommen wurde, oder 4 Fotos in die 4 Richtungen vom selben Standort.
//
// Datenschutz: Die Fotos werden nur lokal geöffnet (Objekt-URL), nie hochgeladen und nicht mit der Konfiguration gespeichert.
import * as THREE from 'three';
import { GroundedSkybox } from './lib/GroundedSkybox.js';
import { umrissPunkte, flaecheGeo } from './pool.js';
import { rauTextur } from './materialien.js';

export const GARTEN_STANDARD = {
  bildwinkel: 65, horizont: 0.5, hoehe: 1.6, radius: 30, drehung: 0,
  boden: 'rasen', bodenRadius: 9, sonneRichtung: 210, sonneHoehe: 45, helligkeit: 1,
};
export const RICHTUNGEN = [{ wert: 0, text: 'Vorn' }, { wert: 90, text: 'Rechts' }, { wert: 180, text: 'Hinten' }, { wert: 270, text: 'Links' }];

const bilder = []; // { img, url, name, richtung, panorama }
export const gartenBilder = () => bilder;

/** Fügt Fotos hinzu (max. 4). Ein Bild mit Seitenverhältnis ab ca. 1,9 : 1 gilt als 360°-Panorama. */
export async function bilderHinzu(dateien) {
  const neu = [];
  for (const d of dateien) {
    if (bilder.length + neu.length >= 4) break;
    if (!d.type.startsWith('image/')) continue;
    const url = URL.createObjectURL(d);
    const img = await new Promise((ok, f) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => f(new Error(`„${d.name}“ konnte nicht geöffnet werden.`)); i.src = url; });
    const panorama = img.naturalWidth / img.naturalHeight >= 1.9;
    const belegt = new Set([...bilder, ...neu].map((b) => b.richtung));
    const richtung = RICHTUNGEN.map((r) => r.wert).find((w) => !belegt.has(w)) ?? 0;
    neu.push({ img, url, name: d.name, richtung, panorama });
  }
  bilder.push(...neu);
  version++;
  return neu.length;
}
export function bildEntfernen(i) { const [b] = bilder.splice(i, 1); if (b) URL.revokeObjectURL(b.url); version++; }
export function bildRichtung(i, grad) { bilder[i].richtung = grad; version++; }

let version = 0;          // ändert sich bei jedem neuen/entfernten Foto
let cache = { schluessel: '', textur: null, env: null };

/** Durchschnittsfarbe eines Bildstreifens (für Himmel und Boden zwischen den Fotos). */
function streifenFarbe(img, y0, y1) {
  const c = document.createElement('canvas'); c.width = 16; c.height = 4;
  const g = c.getContext('2d');
  g.drawImage(img, 0, img.naturalHeight * y0, img.naturalWidth, img.naturalHeight * (y1 - y0), 0, 0, 16, 4);
  const d = g.getImageData(0, 0, 16, 4).data; let r = 0, gg = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4; return `rgb(${(r / n) | 0},${(gg / n) | 0},${(b / n) | 0})`;
}

/** Setzt die Fotos zu einem Rundum-Bild (equirektangular, 360° × 180°) zusammen. */
export function panoramaBauen(p, liste = bilder) {
  const W = 4096, H = 2048, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const pano = liste.find((b) => b.panorama);
  if (pano) { // echtes 360°-Panorama: Breite = 360°, Horizont aus dem Regler
    const img = pano.img, h = (img.naturalHeight / img.naturalWidth) * W; // Bildbreite = 360°, gleicher Maßstab in der Höhe
    g.fillStyle = streifenFarbe(img, 0, 0.05); g.fillRect(0, 0, W, H / 2);
    g.fillStyle = streifenFarbe(img, 0.95, 1); g.fillRect(0, H / 2, W, H / 2);
    g.drawImage(img, 0, H / 2 - h * p.horizont, W, h);
    return c;
  }
  const fotos = liste.filter((b) => !b.panorama).sort((a, b) => a.richtung - b.richtung);
  // Himmel- und Bodenfarbe als Grundlage
  const oben = fotos.map((b) => streifenFarbe(b.img, 0, 0.08)), unten = fotos.map((b) => streifenFarbe(b.img, 0.92, 1));
  const himmel = g.createLinearGradient(0, 0, 0, H / 2); himmel.addColorStop(0, '#9ec6ea'); himmel.addColorStop(1, oben[0]);
  g.fillStyle = himmel; g.fillRect(0, 0, W, H / 2);
  g.fillStyle = unten[0]; g.fillRect(0, H / 2, W, H / 2);
  // Größe eines Fotos im Rundum-Bild aus dem Bildwinkel
  const pw = (p.bildwinkel / 360) * W;
  const lage = (b) => {
    const r = b.img.naturalHeight / b.img.naturalWidth;
    const vWinkel = (2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(p.bildwinkel / 2)) * r) * 180) / Math.PI;
    const ph = (vWinkel / 180) * H;
    return { x: (b.richtung / 360) * W + W / 2 - pw / 2, y: H / 2 - ph * p.horizont, w: pw, h: ph };
  };
  // Lücken zwischen den Fotos mit gespiegelten, ausgeblendeten Kopien der Nachbarn füllen
  const zeichneGespiegelt = (b, l, rechts, breite) => {
    const t = document.createElement('canvas'); t.width = Math.max(1, breite | 0); t.height = l.h | 0;
    const tg = t.getContext('2d');
    tg.save(); tg.scale(-1, 1);
    if (rechts) tg.drawImage(b.img, -l.w, 0, l.w, l.h);          // Spiegelung an der rechten Kante: Spalte 0 = rechter Bildrand
    else tg.drawImage(b.img, -t.width, 0, l.w, l.h);            // Spiegelung an der linken Kante: letzte Spalte = linker Bildrand
    tg.restore();
    const m = tg.createLinearGradient(0, 0, t.width, 0);
    const f = Math.max(0, 1 - 140 / t.width);                       // nur der äußere Streifen (ca. 140 px) wird ausgeblendet
    m.addColorStop(rechts ? 0 : 1, 'rgba(0,0,0,1)'); m.addColorStop(rechts ? f : 1 - f, 'rgba(0,0,0,1)'); m.addColorStop(rechts ? 1 : 0, 'rgba(0,0,0,0)');
    tg.globalCompositeOperation = 'destination-in'; tg.fillStyle = m; tg.fillRect(0, 0, t.width, t.height);
    for (const dx of [-W, 0, W]) g.drawImage(t, (rechts ? l.x + l.w : l.x - t.width) + dx, l.y);
  };
  fotos.forEach((b, i) => {
    const l = lage(b), naechstes = fotos[(i + 1) % fotos.length];
    let luecke = ((naechstes.richtung - b.richtung + 360) % 360 || 360) / 360 * W - pw;
    if (fotos.length === 1) luecke = W - pw;
    if (luecke > 2) { const br = Math.min(luecke / 2 + 70, l.w); zeichneGespiegelt(b, l, true, br); zeichneGespiegelt(naechstes, lage(naechstes), false, br); } // bis zur Mitte der Lücke, dort überblenden
  });
  // Boden unterhalb der Fotos einheitlich mit der Bodenfarbe füllen (sonst können gespiegelte Lücken-Füllungen
  // oder Himmelsreste in den Boden der Kuppel geraten), weicher Übergang am unteren Fotorand
  if (p.bodenFuellen) {
    const unterkante = Math.min(...fotos.map((b) => { const l = lage(b); return l.y + l.h; }));
    const gr = g.createLinearGradient(0, unterkante - 40, 0, unterkante + 60);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, unten[0]);
    g.fillStyle = gr; g.fillRect(0, unterkante - 40, W, 100);
    g.fillStyle = unten[0]; g.fillRect(0, unterkante + 60, W, H);
  }
  // Fotos selbst, mit weichen Rändern, darunter die unterste Bildzeile zum Boden hin verlängert
  fotos.forEach((b) => {
    const l = lage(b);
    for (const dx of [-W, 0, W]) {
      if (!p.bodenFuellen) g.drawImage(b.img, 0, b.img.naturalHeight - 2, b.img.naturalWidth, 2, l.x + dx, l.y + l.h - 1, l.w, H - (l.y + l.h)); // Boden-Verlängerung
      g.drawImage(b.img, 0, 0, b.img.naturalWidth, 2, l.x + dx, 0, l.w, l.y + 1);                                             // Himmel-Verlängerung
      g.drawImage(b.img, l.x + dx, l.y, l.w, l.h);
    }
  });
  return c;
}

/** Bodentexturen für den Bereich direkt um den Pool. */
const bodenCache = {};
function bodenTextur(art) {
  if (bodenCache[art]) return bodenCache[art];
  const N = 512, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d');
  if (art === 'pflaster') {
    g.fillStyle = '#7d7a74'; g.fillRect(0, 0, N, N);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) {
      const v = 150 + Math.random() * 40; g.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
      g.fillRect(x * 128 + (y % 2) * 64 + 3, y * 64 + 3, 122, 58);
    }
  } else if (art === 'kies') {
    g.fillStyle = '#a49c8c'; g.fillRect(0, 0, N, N);
    for (let i = 0; i < 9000; i++) { const v = 120 + Math.random() * 110; g.fillStyle = `rgb(${v},${v - 6},${v - 16})`; g.beginPath(); g.ellipse(Math.random() * N, Math.random() * N, 2 + Math.random() * 3, 1.5 + Math.random() * 2, Math.random() * 3, 0, 7); g.fill(); }
  } else { // Rasen
    g.fillStyle = '#4f7f31'; g.fillRect(0, 0, N, N);
    for (let i = 0; i < 26000; i++) { const x = Math.random() * N, y = Math.random() * N, l = 3 + Math.random() * 6; g.strokeStyle = `hsl(${78 + Math.random() * 30} ${38 + Math.random() * 25}% ${22 + Math.random() * 26}%)`; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 3, y - l); g.stroke(); }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return (bodenCache[art] = t);
}
let _ausblend = null;
function ausblendTextur() { // runder, weicher Übergang des Bodens in die Foto-Umgebung
  if (_ausblend) return _ausblend;
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), gr = g.createRadialGradient(N / 2, N / 2, N * 0.3, N / 2, N / 2, N / 2);
  gr.addColorStop(0, '#fff'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(0, 0, N, N);
  return (_ausblend = new THREE.CanvasTexture(c));
}

/**
 * Baut bzw. aktualisiert die Umgebung. Rückgabe: { kuppel, env } (env = Spiegelungskarte) oder null ohne Fotos.
 * Die Kuppel wird nur neu berechnet, wenn sich Fotos oder Projektions-Einstellungen ändern.
 */
export function gartenUmgebung(renderer, p) {
  if (!bilder.length) return null;
  const schluessel = [version, p.bildwinkel, p.horizont].join('|');
  if (cache.schluessel !== schluessel) {
    cache.textur?.dispose(); cache.env?.dispose();
    const t = new THREE.CanvasTexture(panoramaBauen(p));
    t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; // sonst Himmelsfarbe am Kuppelboden (Pol der Kugel)
    const pmrem = new THREE.PMREMGenerator(renderer);
    cache = { schluessel, textur: t, env: pmrem.fromEquirectangular(t).texture };
    pmrem.dispose();
  }
  const kuppel = new GroundedSkybox(cache.textur, p.hoehe, p.radius, 96);
  kuppel.position.y = p.hoehe - 0.02;                 // Kuppelboden knapp unter dem Gelände
  kuppel.rotation.y = THREE.MathUtils.degToRad(p.drehung);
  kuppel.material.toneMapped = false;                 // Fotofarben unverändert lassen
  kuppel.renderOrder = -2; kuppel.name = 'Garten_Kuppel';
  return { kuppel, env: cache.env };
}

/** Boden um den Pool: Tiefen-Fläche (verdeckt Außenwände), Schattenfläche und optional ein echter Belag mit weichem Rand. */
export function gartenBoden(m, off, p) {
  const g = new THREE.Group(), gross = p.radius;
  const kreis = (r) => Array.from({ length: 96 }, (_, i) => new THREE.Vector2(Math.cos((i / 96) * Math.PI * 2) * r, Math.sin((i / 96) * Math.PI * 2) * r));
  const loch = umrissPunkte(m, off);
  const geoGross = new THREE.ShapeGeometry(flaecheGeo(kreis(gross), [loch])).rotateX(-Math.PI / 2);
  const tiefe = new THREE.Mesh(geoGross, new THREE.MeshBasicMaterial({ colorWrite: false }));
  tiefe.renderOrder = -1; tiefe.position.y = -0.004;
  const schatten = new THREE.Mesh(geoGross, new THREE.ShadowMaterial({ opacity: 0.4 }));
  schatten.receiveShadow = true; schatten.position.y = -0.003;
  g.add(tiefe, schatten);
  if (p.boden !== 'foto') {
    const R = Math.max(p.bodenRadius, Math.max(m.L, m.B) / 2 + off + 1);
    const geo = new THREE.ShapeGeometry(flaecheGeo(kreis(R), [loch]), 1).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, uv = geo.attributes.uv, uv2 = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) { uv.setXY(i, pos.getX(i) / 2, pos.getZ(i) / 2); uv2[i * 2] = pos.getX(i) / (2 * R) + 0.5; uv2[i * 2 + 1] = pos.getZ(i) / (2 * R) + 0.5; }
    geo.setAttribute('uv1', new THREE.BufferAttribute(uv2, 2));
    const am = ausblendTextur(); am.channel = 1;
    const belag = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: bodenTextur(p.boden), bumpMap: rauTextur(1), bumpScale: 0.6, roughness: 0.95, transparent: true, alphaMap: am, depthWrite: false }));
    belag.receiveShadow = true; belag.position.y = -0.002; belag.renderOrder = -0.5; belag.name = 'Garten_Boden';
    g.add(belag);
  }
  return g;
}
