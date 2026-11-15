// Umrandung aus Beckenrandsteinen. Steinmaße und Farben kommen aus der JSON-Datei.
// Rechteckbecken: Steine werden an jeder Seite auf die Länge verteilt (Eckstein-Optik).
// Ovalbecken: Steine werden als Radiensteine entlang der Kurve gelegt.
import * as THREE from 'three';
import { rauTextur } from './materialien.js';
import { masse, umrissPunkte } from './pool.js';

/** Steinmaße (m) aus dem Datenblatt-Eintrag. */
export function steinMasse(u) {
  if (u.masse_mm) {
    const mm = u.masse_mm;
    return { l: mm.laenge / 1000, b: mm.breite / 1000, h: (mm.hoehe ?? mm.hoehe_hinten) / 1000, nase: mm.hoehe_schwallkante ? { h: mm.hoehe_schwallkante / 1000, v: (mm.ueberstand_kante ?? 20) / 1000 } : null };
  }
  const g = u.steine.find((x) => x.typ === 'gerade');
  return { l: g.masse_cm[0] / 100, b: g.masse_cm[1] / 100, h: u.staerke_cm / 100, nase: null };
}

/** Farbwert eines Umrandungsfarbe-Eintrags (id oder Objekt mit id). */
export function umrandungsFarbe(daten, f) {
  return daten.farben_3d.umrandung[typeof f === 'string' ? f : f.id];
}

/**
 * Baut die Umrandung.
 * Rückgabe: { group, breite } – "breite" ist die Steinbreite (Abstand Becken bis Außenkante).
 */
export function baueUmrandung(pool, groesse, u, hex) {
  const m = masse(pool, groesse);
  const st = steinMasse(u);
  const bw = st.b;
  const group = new THREE.Group();

  // Platzierungen sammeln: Mitte (x,z), Drehung um y, Steinlänge, Richtung nach innen
  const platz = [];
  if (m.form === 'rechteck') {
    const seite = (laenge, cx, cz, rot, inx, inz) => {
      const anz = Math.max(1, Math.round(laenge / st.l)), len = laenge / anz;
      for (let i = 0; i < anz; i++) {
        const t = -laenge / 2 + len * (i + 0.5);
        platz.push({ x: cx + (rot ? 0 : t), z: cz + (rot ? t : 0), rot, len: len - 0.004, inx, inz });
      }
    };
    seite(m.L + 2 * bw, 0, -(m.B / 2 + bw / 2), 0, 0, 1);
    seite(m.L + 2 * bw, 0, +(m.B / 2 + bw / 2), 0, 0, -1);
    seite(m.B, -(m.L / 2 + bw / 2), 0, Math.PI / 2, 1, 0);
    seite(m.B, +(m.L / 2 + bw / 2), 0, Math.PI / 2, -1, 0);
  } else {
    // Linienzug in der Mitte der Steinreihe, gleichmäßig nach Bogenlänge verteilt
    const pts = umrissPunkte(m, bw / 2, 96);
    const segLen = pts.map((p, i) => p.distanceTo(pts[(i + 1) % pts.length]));
    const gesamt = segLen.reduce((a, b) => a + b, 0);
    const anz = Math.max(8, Math.round(gesamt / st.l)), len = gesamt / anz;
    for (let k = 0; k < anz; k++) {
      let rest = (k + 0.5) * len, i = 0;
      while (rest > segLen[i]) { rest -= segLen[i]; i++; }
      const a = pts[i], b = pts[(i + 1) % pts.length], f = rest / segLen[i];
      const x = a.x + (b.x - a.x) * f, z = a.y + (b.y - a.y) * f;
      const tx = b.x - a.x, tz = b.y - a.y, tl = Math.hypot(tx, tz);
      const il = Math.hypot(x, z) || 1;
      platz.push({ x, z, rot: Math.atan2(-tz, tx), len: len * 1.02, inx: -x / il, inz: -z / il, tx: tx / tl, tz: tz / tl });
    }
  }

  // Alle Steine als eine InstancedMesh (schont die Grafik)
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, bumpMap: rauTextur(1), bumpScale: 0.6 });
  const steine = new THREE.InstancedMesh(new THREE.BoxGeometry(1, st.h, bw), mat, platz.length);
  const basis = new THREE.Color(hex), farbe = new THREE.Color();
  const obenY = 0.02;
  const tmp = new THREE.Object3D();
  platz.forEach((p, i) => {
    tmp.position.set(p.x, obenY - st.h / 2, p.z);
    tmp.rotation.set(0, p.rot, 0);
    tmp.scale.set(p.len, 1, 1);
    tmp.updateMatrix();
    steine.setMatrixAt(i, tmp.matrix);
    // leichte Farbabweichung pro Stein, wie bei echten Steinen
    farbe.copy(basis).offsetHSL(0, 0, (((i * 37) % 11) / 11 - 0.5) * 0.04);
    steine.setColorAt(i, farbe);
  });
  steine.receiveShadow = true;
  group.add(steine);

  // Schwallkante (Bordo Standard / Expo): schmale Leiste, die ins Becken ragt
  if (st.nase) {
    const nase = new THREE.InstancedMesh(new THREE.BoxGeometry(1, st.nase.h, st.nase.v), mat, platz.length);
    platz.forEach((p, i) => {
      tmp.position.set(p.x + p.inx * (bw / 2 + st.nase.v / 2 - 0.0), obenY - st.nase.h / 2, p.z + p.inz * (bw / 2 + st.nase.v / 2));
      tmp.rotation.set(0, p.rot, 0);
      tmp.scale.set(p.len, 1, 1);
      tmp.updateMatrix();
      nase.setMatrixAt(i, tmp.matrix);
      nase.setColorAt(i, basis);
    });
    group.add(nase);
  }
  return { group, breite: bw };
}
