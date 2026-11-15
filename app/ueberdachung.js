// Teleskop-Überdachungen (Azure Flat Compact, Parade High/Low): Größenwahl und 3D-Aufbau.
// Alle Maße stammen aus der JSON-Datei. Gewählt wird die kleinste Größe, in die der Pool
// samt Umrandung passt (Regel vom 2026-11-15).
import * as THREE from 'three';

const fmt = (z) => String(Math.round(z * 100) / 100).replace('.', ',');

/** Einheitliche Größenliste: { B: Breite quer, L: Länge längs, h: Höhe, schiene } oder null (Größen fehlen/individuell). */
function groessenListe(u) {
  if (!Array.isArray(u.groessen)) return null;
  return u.groessen.map((g) => ({
    B: g.innen_breite ?? g.breite, L: g.innen_laenge ?? g.laenge, h: g.hoehe,
    schiene: g.schiene_laenge ?? (g.innen_laenge ?? g.laenge) + 3,
  }));
}

/** Kleinste passende Größe. Rückgabe { ok, groesse } oder { ok: false, grund }. */
export function waehleGroesse(u, m, randBreite) {
  if (u.bedingungen?.grund_offen && u.offen) return { ok: false, grund: u.bedingungen.grund_offen };
  const aussenL = m.L + 2 * randBreite, aussenB = m.B + 2 * randBreite;
  const liste = groessenListe(u);
  if (!liste) { // "individuell": wird passend zum Becken gefertigt
    return { ok: true, groesse: { B: aussenB + 0.2, L: aussenL + 0.2, h: 0.75, schiene: aussenL + 3.2 }, individuell: true };
  }
  const passend = liste.filter((g) => g.B >= aussenB - 1e-6 && g.L >= aussenL - 1e-6).sort((a, b) => a.B * a.L - b.B * b.L);
  if (passend.length) return { ok: true, groesse: passend[0] };
  const gross = liste[liste.length - 1];
  return { ok: false, grund: `Der Pool mit Umrandung (${fmt(aussenL)} × ${fmt(aussenB)} m) passt in keine Größe dieser Überdachung (größte: ${fmt(gross.L)} × ${fmt(gross.B)} m).` };
}

/**
 * Baut die Überdachung (liegt auf dem Boden, Becken in der Mitte).
 * opts: { profilHex, schiene: 'links'|'rechts', offen: boolean }
 */
export function baueUeberdachung(u, g, opts) {
  const group = new THREE.Group();
  const n = typeof u.elemente === 'number' ? u.elemente : 4;
  const einseitig = /nur auf einer Seite/.test(u.typ);
  const W = g.B, Lc = g.L, hMax = g.h;

  const profil = new THREE.MeshStandardMaterial({ color: opts.profilHex, roughness: 0.45, metalness: 0.3 });
  const glas = new THREE.MeshPhysicalMaterial({ color: 0xcfe8f5, transparent: true, opacity: 0.26, roughness: 0.08, side: THREE.DoubleSide, depthWrite: false });

  const elLen = (Lc / n) * 1.25;
  const ext = Math.max(g.schiene - Lc, 0.5);                    // Schienenverlängerung am Ende (x+)
  const xZu = (i) => -Lc / 2 + elLen / 2 + (i * (Lc - elLen)) / Math.max(n - 1, 1);
  const xAuf = (i) => Lc / 2 + ext - elLen / 2 - (n - 1 - i) * 0.12;

  for (let i = 0; i < n; i++) {
    const h = hMax * (0.6 + (0.4 * i) / Math.max(n - 1, 1));      // ineinander geschobene Elemente
    const R = (W * W / 4 + h * h) / (2 * h), a = Math.asin(W / (2 * R)), hoehe0 = R * Math.cos(a);
    const el = new THREE.Group();
    // Scheibe: Kreisabschnitt quer zum Becken
    const schale = new THREE.CylinderGeometry(R, R, elLen, 28, 1, true, Math.PI / 2 - a, 2 * a).rotateZ(Math.PI / 2).translate(0, -hoehe0, 0);
    el.add(new THREE.Mesh(schale, glas));
    // Profilbögen an beiden Enden
    for (const sx of [-1, 1]) {
      const bogen = new THREE.TorusGeometry(R, 0.012, 6, 28, 2 * a).rotateZ(Math.PI / 2 - a).rotateY(Math.PI / 2).translate(sx * elLen / 2, -hoehe0, 0);
      el.add(new THREE.Mesh(bogen, profil));
    }
    el.position.x = opts.offen ? xAuf(i) : xZu(i);
    group.add(el);
  }

  // Laufschienen: beidseitig oder nur auf der gewählten Seite
  const schienenLaenge = Lc + ext, cx = -Lc / 2 + schienenLaenge / 2;
  const seiten = einseitig ? [opts.schiene === 'rechts' ? 1 : -1] : [-1, 1];
  for (const sz of seiten) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(schienenLaenge, 0.04, 0.09), profil);
    r.position.set(cx, 0.02, sz * (W / 2 + 0.01));
    group.add(r);
  }
  group.traverse((o) => { if (o.isMesh && o.material === profil) o.castShadow = true; });
  return group;
}
