// Fotos automatisch miteinander verknüpfen (nur lokal, ohne Internet).
//
// Idee: Aus der Tiefe jedes Fotos entsteht ein „Grundriss“ des Gartens von oben – überall dort, wo etwas
// Senkrechtes steht (Hecke, Hauswand, Zaun, Baum, Gartenhaus), liegen Punkte. Wo diese Dinge auf dem Boden stehen,
// lässt sich aus der Bodenebene recht genau bestimmen. Die Grundrisse der Fotos werden dann wie Puzzleteile
// übereinandergelegt: Für tausende Drehungen und Verschiebungen wird geprüft, wie gut die Punkte des neuen Fotos
// auf die Punkte der schon platzierten Fotos fallen. Die beste Lage gewinnt – ausgehend von GPS und Kompass
// (wenn vorhanden), sonst über alle Richtungen.
import { tiefeBei, weltPunkt } from './gelaende.js';
import * as THREE from 'three';

const MAX_ENTFERNUNG = 22;       // weiter entfernte Punkte sind zu ungenau (m)
const ZELLE = 0.2;               // Rasterweite des Abstandsfelds (m)

/**
 * Grundriss eines Fotos in seinem eigenen Koordinatensystem (Kamera bei x = z = 0, Blick nach −z):
 * Punkte senkrechter Dinge (0,3 … 4 m hoch), auf 10 cm zusammengefasst, mit Gewicht (nahe Punkte zählen mehr).
 */
export function grundriss(b, p) {
  const t = b.tiefe, k = b.kalib, P = new THREE.Vector3(), zellen = new Map();
  for (let v = 0.02; v <= 0.98; v += 1 / 220) for (let u = 0.01; u <= 0.99; u += 1 / 300) {
    const z = tiefeBei(t, k, p, u, v);
    if (z >= Math.min(MAX_ENTFERNUNG, p.ferne * 0.9)) continue;
    weltPunkt(k, p, u, v, z, P);
    if (P.y < 0.3 || P.y > 4) continue;
    const kx = Math.round(P.x * 10), kz = Math.round(P.z * 10), key = kx * 100000 + kz;
    const w = 1 / (1 + (z / 12) ** 2);                       // Tiefenfehler wächst mit der Entfernung
    const e = zellen.get(key);
    if (e) e[2] += w; else zellen.set(key, [kx / 10, kz / 10, w]);
  }
  const pts = [...zellen.values()];
  // Gewicht je Zelle begrenzen (eine große Hauswand soll nicht alles dominieren)
  for (const q of pts) q[2] = Math.min(q[2], 1.5);
  return pts;
}

/** Punkte eines Fotos in Weltlage (Drehung yaw in Grad, + = rechts; Standort pos). */
function inWelt(pts, yaw, pos) {
  const y = THREE.MathUtils.degToRad(yaw), c = Math.cos(y), s = Math.sin(y);
  return pts.map(([x, z, w]) => [x * c - z * s + pos.x, x * s + z * c + pos.z, w]);
}

/** Nähe-Feld der Referenzpunkte: 1 direkt auf einem Punkt, nach außen abfallend (Abstandstransformation). */
function naeheFeld(ref, sigma) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of ref) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const rand = 4; x0 -= rand; z0 -= rand; x1 += rand; z1 += rand;
  const nx = Math.ceil((x1 - x0) / ZELLE) + 1, nz = Math.ceil((z1 - z0) / ZELLE) + 1;
  const d = new Float32Array(nx * nz).fill(1e9);
  for (const [x, z] of ref) { const i = Math.round((x - x0) / ZELLE), j = Math.round((z - z0) / ZELLE); d[j * nx + i] = 0; }
  // Zwei-Pass-Chamfer-Abstand (in Zellen)
  const a = 1, b = Math.SQRT2;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    let v = d[j * nx + i];
    if (i > 0) v = Math.min(v, d[j * nx + i - 1] + a);
    if (j > 0) { v = Math.min(v, d[(j - 1) * nx + i] + a); if (i > 0) v = Math.min(v, d[(j - 1) * nx + i - 1] + b); if (i < nx - 1) v = Math.min(v, d[(j - 1) * nx + i + 1] + b); }
    d[j * nx + i] = v;
  }
  for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    let v = d[j * nx + i];
    if (i < nx - 1) v = Math.min(v, d[j * nx + i + 1] + a);
    if (j < nz - 1) { v = Math.min(v, d[(j + 1) * nx + i] + a); if (i < nx - 1) v = Math.min(v, d[(j + 1) * nx + i + 1] + b); if (i > 0) v = Math.min(v, d[(j + 1) * nx + i - 1] + b); }
    d[j * nx + i] = v;
  }
  const f = new Float32Array(nx * nz), k = (ZELLE * ZELLE) / (2 * sigma * sigma);
  for (let i = 0; i < f.length; i++) f[i] = Math.exp(-d[i] * d[i] * k);
  return { f, nx, nz, x0, z0 };
}

/** Anteil der (gewichteten) Punkte, die bei Drehung yaw und Verschiebung (tx, tz) nahe an Referenzpunkten liegen. */
function bewerten(feld, rx, rz, w, wSumme, tx, tz) {
  const { f, nx, nz, x0, z0 } = feld, inv = 1 / ZELLE;
  let s = 0;
  for (let n = 0; n < rx.length; n++) {
    const i = ((rx[n] + tx - x0) * inv + 0.5) | 0, j = ((rz[n] + tz - z0) * inv + 0.5) | 0;
    if (i >= 0 && j >= 0 && i < nx && j < nz) s += f[j * nx + i] * w[n];
  }
  return s / wSumme;
}

/** Zufällige, gewichtete Auswahl von höchstens n Punkten (reproduzierbar). */
function auswahl(pts, n) {
  if (pts.length <= n) return pts;
  let z = 987654321; const rnd = () => ((z = (z * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  return pts.map((q) => [q, rnd() ** (1 / q[2])]).sort((a, b) => b[1] - a[1]).slice(0, n).map((q) => q[0]);
}

/**
 * Sucht die beste Lage (yaw, pos) eines Fotos gegenüber den Referenzpunkten.
 * start: { yaw, pos } (Vorgabe aus GPS/Kompass oder Standard), breit: true = ohne GPS über alle Richtungen suchen.
 */
async function lageSuchen(eigene, ref, start, breit, fortschritt) {
  const pause = () => new Promise((r) => setTimeout(r, 0));
  const vorbereiten = (pts, yaw) => {
    const y = THREE.MathUtils.degToRad(yaw), c = Math.cos(y), s = Math.sin(y);
    const rx = new Float32Array(pts.length), rz = new Float32Array(pts.length), w = new Float32Array(pts.length); let ws = 0;
    pts.forEach(([x, z, g], n) => { rx[n] = x * c - z * s; rz[n] = x * s + z * c; w[n] = g; ws += g; });
    return { rx, rz, w, ws };
  };
  // Vorwissen: GPS ist auf einige Meter genau (Angabe im Foto), der Kompass auf etwa ±12°. Abweichungen kosten
  // Punkte (je Standardabweichung 0,12) – so gewinnt eine andere Lage nur, wenn sie deutlich besser passt.
  const sPos = Math.max(2, start.genauigkeit ?? 4), sYaw = 12;
  const strafe = (yaw, tx, tz) => breit ? 0 : 0.06 * (((tx - start.pos.x) ** 2 + (tz - start.pos.z) ** 2) / (sPos * sPos) + ((((yaw - start.yaw + 540) % 360) - 180) / sYaw) ** 2);

  // 1) Grobe Suche: weiches Feld, wenige Punkte, großes Raster
  const grobFeld = naeheFeld(ref, 0.6), grob = auswahl(eigene, 350);
  const yawSchritt = breit ? 4 : 1.5, yawBereich = breit ? 180 : 30, tBereich = breit ? 16 : Math.min(9, 2.5 * sPos), tSchritt = breit ? 0.5 : 0.3;
  const kandidaten = [];
  let schritt = 0; const gesamt = Math.round((2 * yawBereich) / yawSchritt) + 1;
  for (let dy = -yawBereich; dy <= yawBereich; dy += yawSchritt) {
    const yaw = start.yaw + dy, v = vorbereiten(grob, yaw);
    for (let tx = start.pos.x - tBereich; tx <= start.pos.x + tBereich; tx += tSchritt)
      for (let tz = start.pos.z - tBereich; tz <= start.pos.z + tBereich; tz += tSchritt) {
        const s = bewerten(grobFeld, v.rx, v.rz, v.w, v.ws, tx, tz) - strafe(yaw, tx, tz);
        if (kandidaten.length < 12 || s > kandidaten[kandidaten.length - 1].s) {
          kandidaten.push({ s, yaw, tx, tz }); kandidaten.sort((a, b) => b.s - a.s);
          // nur deutlich verschiedene Kandidaten behalten
          for (let i = kandidaten.length - 1; i > 0; i--) for (let j = 0; j < i; j++)
            if (Math.abs(kandidaten[i].yaw - kandidaten[j].yaw) < 6 && Math.hypot(kandidaten[i].tx - kandidaten[j].tx, kandidaten[i].tz - kandidaten[j].tz) < 1.5) { kandidaten.splice(i, 1); break; }
          if (kandidaten.length > 12) kandidaten.length = 12;
        }
      }
    if (++schritt % 6 === 0) { fortschritt?.(schritt / gesamt * 0.7); await pause(); }
  }
  // 2) Feine Suche um die besten Kandidaten: schärferes Feld, mehr Punkte, kleine Schritte
  const feinFeld = naeheFeld(ref, 0.25), fein = auswahl(eigene, 1200);
  let beste = null;
  for (const [n, k] of kandidaten.slice(0, 6).entries()) {
    let { yaw, tx, tz } = k, s0 = -Infinity;
    for (const [yB, yS, tB, tS] of [[3, 0.5, 0.8, 0.1], [0.6, 0.15, 0.2, 0.04]]) {
      for (let dy = -yB; dy <= yB + 1e-9; dy += yS) {
        const v = vorbereiten(fein, k.yaw + dy);
        for (let ax = -tB; ax <= tB + 1e-9; ax += tS) for (let az = -tB; az <= tB + 1e-9; az += tS) {
          const s = bewerten(feinFeld, v.rx, v.rz, v.w, v.ws, k.tx + ax, k.tz + az) - strafe(k.yaw + dy, k.tx + ax, k.tz + az);
          if (s > s0) { s0 = s; yaw = k.yaw + dy; tx = k.tx + ax; tz = k.tz + az; }
        }
      }
      Object.assign(k, { yaw, tx, tz });
    }
    if (!beste || s0 > beste.s) beste = { s: s0, yaw, pos: { x: tx, z: tz } };
    fortschritt?.(0.7 + ((n + 1) / 6) * 0.3); await pause();
  }
  // Güte an der Startlage zum Vergleich
  const v0 = vorbereiten(fein, start.yaw);
  beste.startWert = bewerten(feinFeld, v0.rx, v0.rz, v0.w, v0.ws, start.pos.x, start.pos.z);
  beste.zweiter = kandidaten[1]?.s ?? 0; beste.erster = kandidaten[0]?.s ?? 0;
  return beste;
}

/**
 * Verknüpft alle Fotos: Foto 1 bleibt fest, jedes weitere wird an die schon platzierten angelegt.
 * bilder: ki.bilder (mit tiefe, kalib, yaw, pos, exif); param(b) liefert die Projektions-Einstellungen.
 * Rückgabe je Foto: { yaw, pos, guete (0..1), sicher } – übernommen wird nur, was sicher passt.
 */
export async function fotosVerknuepfen(bilder, param, fortschritt) {
  const risse = bilder.map((b) => grundriss(b, param(b)));
  const ergebnis = [{ yaw: bilder[0].yaw, pos: { ...bilder[0].pos }, guete: 1, sicher: true, punkte: risse[0].length }];
  let ref = inWelt(risse[0], bilder[0].yaw, bilder[0].pos);
  for (let i = 1; i < bilder.length; i++) {
    const b = bilder[i], mitGps = b.quelle === 'gps' || b.quelle === 'auto';
    if (risse[i].length < 40 || ref.length < 40) { ergebnis.push({ yaw: b.yaw, pos: { ...b.pos }, guete: 0, sicher: false, punkte: risse[i].length }); continue; }
    const gen = Math.hypot(b.exif?.genauigkeit ?? 4, bilder[0].exif?.genauigkeit ?? 4); // Lage relativ zu Foto 1: beide Fehler zählen
    const r = await lageSuchen(risse[i], ref, { yaw: b.yaw, pos: b.pos, genauigkeit: gen }, !mitGps, (f) => fortschritt?.((i - 1 + f) / (bilder.length - 1), i));
    // Sicher, wenn genug Punkte passen und die Lösung eindeutig ist (nicht nur knapp besser als eine ganz andere Lage)
    const sicher = r.s > (mitGps ? 0.2 : 0.3) && r.s > r.startWert + 0.03; // ohne GPS strenger (Suche über alle Richtungen)
    ergebnis.push({ yaw: r.yaw, pos: r.pos, guete: r.s, start: r.startWert, sicher, punkte: risse[i].length });
    if (!sicher) Object.assign(ergebnis[i], { yaw: b.yaw, pos: { ...b.pos } }); // unsicher: Lage aus GPS/Kompass behalten
    if (sicher) ref = ref.concat(inWelt(risse[i], r.yaw, r.pos));
  }
  return { ergebnis, risse };
}

/** Kontrollbild: Grundrisse aller Fotos von oben in ihren Farben (für Fehlersuche und den Lageplan). */
export function grundrissBild(risse, lagen, farben, groesse = 600) {
  const c = document.createElement('canvas'); c.width = c.height = groesse;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, groesse, groesse);
  const alle = risse.flatMap((r, i) => inWelt(r, lagen[i].yaw, lagen[i].pos));
  const xs = alle.map((q) => q[0]), zs = alle.map((q) => q[1]);
  const mx = (Math.min(...xs) + Math.max(...xs)) / 2, mz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const m = groesse / (Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) + 4);
  risse.forEach((r, i) => {
    g.fillStyle = farben[i] + '99';
    for (const [x, z] of inWelt(r, lagen[i].yaw, lagen[i].pos)) g.fillRect(groesse / 2 + (x - mx) * m, groesse / 2 + (z - mz) * m, 2, 2);
    const [px, pz] = [groesse / 2 + (lagen[i].pos.x - mx) * m, groesse / 2 + (lagen[i].pos.z - mz) * m];
    g.fillStyle = farben[i]; g.beginPath(); g.arc(px, pz, 6, 0, 7); g.fill();
    const y = THREE.MathUtils.degToRad(lagen[i].yaw);
    g.strokeStyle = farben[i]; g.lineWidth = 2; g.beginPath(); g.moveTo(px, pz); g.lineTo(px + Math.sin(y) * 30, pz - Math.cos(y) * 30); g.stroke();
  });
  return c;
}
