// Geschlossener Poolkörper für das freie 3D-Modell und den GLB-Export.
// Je nach Aufbau (Feld "aufbau" in der JSON-Datei):
//   "steine"          Systemstein-/Kompaktpool: Wand aus einzelnen Styroporsteinen im Läuferverband
//   "pp_fertigbecken" Polypropylen-Fertigbecken: Außenhaut mit Versteifungsrippen und Rohren (nach Baustellenfotos)
//   sonst             einfacher, glatter Betonkörper
import * as THREE from 'three';
import { umrissPunkte, flaecheGeo } from './pool.js';

/** Dicke der Außenwand (m): so weit ragt der Körper über den Beckenrand hinaus. */
export function koerperDicke(aufbau, off = 0.12) {
  if (aufbau?.typ === 'steine') return aufbau.wanddicke_m;
  if (aufbau?.typ === 'pp_fertigbecken') return (aufbau.wand_platte_mm + aufbau.daemmung_mm) / 1000;
  return off;
}

/** Baut den Körper passend zum Aufbau des Pools. */
export function baueKoerper(m, aufbau, off = 0.12) {
  if (aufbau?.typ === 'steine') return steinKoerper(m, aufbau);
  if (aufbau?.typ === 'pp_fertigbecken') return ppKoerper(m, aufbau);
  return allgemeinKoerper(m, off);
}

const mat = (hex, r = 0.9, met = 0) => new THREE.MeshStandardMaterial({ color: hex, roughness: r, metalness: met });

function allgemeinKoerper(m, off) {
  const group = new THREE.Group(), material = mat(0xbfc3c6);
  const aussen = umrissPunkte(m, off), innen = umrissPunkte(m, 0);
  const ring = new THREE.Mesh(new THREE.ExtrudeGeometry(flaecheGeo(aussen, [innen]), { depth: m.T + 0.05, bevelEnabled: false }).rotateX(-Math.PI / 2), material);
  ring.position.y = -(m.T + 0.05);
  const platte = new THREE.Mesh(new THREE.ExtrudeGeometry(flaecheGeo(aussen), { depth: 0.05, bevelEnabled: false }).rotateX(-Math.PI / 2), material);
  platte.position.y = -(m.T + 0.05);
  ring.name = 'Poolkoerper_Wand'; platte.name = 'Poolkoerper_Boden';
  group.add(ring, platte);
  return group;
}

/** Stoßfugen: teilt eine Länge in Steinsegmente; "versatz" verschiebt die erste Fuge (Läuferverband). */
function reihe(laenge, sl, versatz) {
  const fugen = [0];
  for (let p = versatz > 0 ? versatz : sl; p < laenge - 1e-6; p += sl) fugen.push(p);
  fugen.push(laenge);
  const segmente = [];
  for (let i = 0; i < fugen.length - 1; i++) if (fugen[i + 1] - fugen[i] > 0.02) segmente.push([fugen[i], fugen[i + 1]]);
  return segmente;
}

/** Styroporsteine: Lagen im Läuferverband, an den Ecken abwechselnd durchgehend (Eckverband). */
function steinKoerper(m, a) {
  const { L, B, T } = m;
  const [sl, t, sh0] = a.stein_m;                 // Länge, Dicke, Höhe eines Steins
  const n = Math.max(1, Math.round(T / sh0)), sh = T / n;
  const gruppe = new THREE.Group();
  const teile = [];
  for (let k = 0; k < n; k++) {
    const y = -T + sh * (k + 0.5), gerade = k % 2 === 0, versatz = gerade ? 0 : sl / 2;
    const lx = gerade ? L + 2 * t : L;           // lange Seiten laufen in geraden Lagen über die Ecken
    for (const sz of [-1, 1]) for (const [p, q] of reihe(lx, sl, versatz)) teile.push({ x: -lx / 2 + (p + q) / 2, y, z: sz * (B / 2 + t / 2), len: q - p, rot: 0 });
    const lz = gerade ? B : B + 2 * t;           // kurze Seiten in den ungeraden Lagen
    for (const sx of [-1, 1]) for (const [p, q] of reihe(lz, sl, versatz)) teile.push({ x: sx * (L / 2 + t / 2), y, z: -lz / 2 + (p + q) / 2, len: q - p, rot: Math.PI / 2 });
  }
  const steine = new THREE.InstancedMesh(new THREE.BoxGeometry(1, sh - 0.008, t - 0.006), mat(0xffffff, 0.95), teile.length);
  const o = new THREE.Object3D(), c = new THREE.Color();
  teile.forEach((s, i) => {
    o.position.set(s.x, s.y, s.z); o.rotation.set(0, s.rot, 0); o.scale.set(s.len - 0.008, 1, 1); o.updateMatrix();
    steine.setMatrixAt(i, o.matrix);
    steine.setColorAt(i, c.set(0xe9ebe6).offsetHSL(0, 0, (((i * 53) % 13) / 13 - 0.5) * 0.05)); // leichte Farbstreuung
  });
  steine.name = 'Styroporsteine';
  const bd = a.boden.dicke_m;                    // Bodenplatte (bauseits, Richtwert)
  const boden = new THREE.Mesh(new THREE.BoxGeometry(L + 2 * t, bd, B + 2 * t), mat(0x9a9d9f));
  boden.position.y = -T - bd / 2; boden.name = 'Bodenplatte';
  gruppe.add(steine, boden);
  return gruppe;
}

/** PP-Fertigbecken: Außenhaut (Platte + Isolation), senkrechte Rippen, waagerechte Rohre, blaue Eckleisten. */
function ppKoerper(m, a) {
  const { L, B, T } = m;
  const tw = (a.wand_platte_mm + a.daemmung_mm) / 1000, bp = (a.boden_platte_mm + a.daemmung_mm) / 1000;
  const r = a.rippen, gruppe = new THREE.Group();
  const haut = mat(0xe7e2d2, 0.8), rippe = mat(0xf4f4f1, 0.6), rohr = mat(0x3f4448, 0.6, 0.2), blau = mat(0x2c9be0, 0.5);
  const ring = new THREE.Mesh(new THREE.ExtrudeGeometry(flaecheGeo(umrissPunkte(m, tw), [umrissPunkte(m, 0)]), { depth: T + bp, bevelEnabled: false }).rotateX(-Math.PI / 2), haut);
  ring.position.y = -(T + bp); ring.name = 'PP_Aussenhaut';
  const boden = new THREE.Mesh(new THREE.ExtrudeGeometry(flaecheGeo(umrissPunkte(m, tw)), { depth: bp, bevelEnabled: false }).rotateX(-Math.PI / 2), haut);
  boden.position.y = -(T + bp); boden.name = 'PP_Boden';
  gruppe.add(ring, boden);

  const aussen = tw + r.tiefe_m / 2;
  const seiten = [ // [Länge der Seite, Mittelpunkt x, z, Drehung]
    [L, 0, -(B / 2 + aussen), 0], [L, 0, B / 2 + aussen, 0],
    [B, -(L / 2 + aussen), 0, Math.PI / 2], [B, L / 2 + aussen, 0, Math.PI / 2]];
  seiten.forEach(([len, cx, cz, rot], si) => {
    const anz = Math.max(2, Math.round(len / r.abstand_m)), alle = new THREE.Group();
    for (let i = 0; i <= anz; i++) { // senkrechte Rippen; jede vierte blau, wie auf den Fotos
      const rb = new THREE.Mesh(new THREE.BoxGeometry(r.breite_m, T, r.tiefe_m), i % 4 === 1 ? blau : rippe);
      rb.position.set(-len / 2 + (len * i) / anz, -T / 2, 0); alle.add(rb);
    }
    for (const f of [0.2, 0.5, 0.8]) { // waagerechte Rohre
      const rr = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 12).rotateZ(Math.PI / 2), rohr);
      rr.position.set(0, -T * f, r.tiefe_m / 2 + 0.03); alle.add(rr);
    }
    alle.position.set(cx, 0, cz); alle.rotation.y = rot;
    // Teile müssen nach außen zeigen: bei der Seite mit negativer Richtung umdrehen
    if (si === 0 || si === 2) alle.rotation.y = rot + Math.PI;
    gruppe.add(alle);
  });
  return gruppe;
}
