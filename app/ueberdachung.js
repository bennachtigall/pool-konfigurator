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

/** Kreisabschnitt-Bogen als Profilband (Form in z/y, Tiefe entlang x). */
function bogenProfil(R, a, hoehe0, dicke, tiefe) {
  const sh = new THREE.Shape();
  sh.absarc(0, -hoehe0, R, Math.PI / 2 - a, Math.PI / 2 + a, false);
  sh.absarc(0, -hoehe0, R - dicke, Math.PI / 2 + a, Math.PI / 2 - a, true);
  sh.closePath();
  return new THREE.ExtrudeGeometry(sh, { depth: tiefe, bevelEnabled: false }).translate(0, 0, -tiefe / 2).rotateY(Math.PI / 2);
}

/**
 * Baut die Überdachung (liegt auf dem Boden, Becken in der Mitte).
 * opts: { profilHex, schiene: 'links'|'rechts', oeffnung: 0..1 }
 * Details: Profilrahmen an den Bögen, Hohlkammerrippen, Stirnwände mit Pfosten (Tür bei Azure), Laufrollen, Schienen.
 */
export function baueUeberdachung(u, g, opts) {
  const group = new THREE.Group();
  const n = typeof u.elemente === 'number' ? u.elemente : 4;
  const einseitig = /nur auf einer Seite/.test(u.typ);
  const mitTuer = u.id.startsWith('azure');
  const W = g.B, Lc = g.L, hMax = g.h;

  const profil = new THREE.MeshStandardMaterial({ color: opts.profilHex, roughness: 0.4, metalness: 0.45 });
  const glas = new THREE.MeshPhysicalMaterial({ color: 0xd8eef8, transparent: true, opacity: 0.24, roughness: 0.04, metalness: 0, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.6 });
  const wand = new THREE.MeshPhysicalMaterial({ color: 0xd8eef8, transparent: true, opacity: 0.3, roughness: 0.04, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.6 });
  const rolleMat = new THREE.MeshStandardMaterial({ color: 0x23272a, roughness: 0.6 });

  const elLen = (Lc / n) * 1.2;
  const ext = Math.max(g.schiene - Lc, 0.5);                   // Schienenverlängerung am Ende (x+)
  const xZu = (i) => -Lc / 2 + elLen / 2 + (i * (Lc - elLen)) / Math.max(n - 1, 1);
  const xAuf = (i) => Lc / 2 + ext - elLen / 2 - (n - 1 - i) * 0.12;
  const t = THREE.MathUtils.clamp(opts.oeffnung ?? 0, 0, 1);

  for (let i = 0; i < n; i++) {
    const h = hMax * (0.6 + (0.4 * i) / Math.max(n - 1, 1));  // ineinander geschobene Elemente
    const R = (W * W / 4 + h * h) / (2 * h), a = Math.asin(W / (2 * R)), hoehe0 = R * Math.cos(a);
    const el = new THREE.Group();
    // Polycarbonat-Hohlkammerplatte
    el.add(new THREE.Mesh(new THREE.CylinderGeometry(R, R, elLen, 40, 1, true, Math.PI / 2 - a, 2 * a).rotateZ(Math.PI / 2).translate(0, -hoehe0, 0), glas));
    // Profilbögen an beiden Enden (Rechteckprofil 5 × 3,5 cm)
    for (const sx of [-1, 1]) {
      const bogen = new THREE.Mesh(bogenProfil(R, a, hoehe0, 0.035, 0.05), profil);
      bogen.position.x = sx * (elLen / 2 - 0.025); el.add(bogen);
    }
    // Längsrippen der Hohlkammerplatte (alle ~0,6 m)
    const rippen = Math.max(3, Math.round((2 * a * R) / 0.6));
    for (let r = 1; r < rippen; r++) {
      const ang = Math.PI / 2 - a + (2 * a * r) / rippen;
      const rb = new THREE.Mesh(new THREE.BoxGeometry(elLen - 0.04, 0.012, 0.025), profil);
      rb.position.set(0, R * Math.sin(ang) - hoehe0 + 0.004, R * Math.cos(ang));
      rb.rotation.x = Math.PI / 2 - ang; // Rippe liegt tangential auf der Bogenfläche
      el.add(rb);
    }
    // Laufrollen unten an beiden Enden, Querstreben als Fußprofil
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
      const ro = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.035, 14).rotateX(Math.PI / 2), rolleMat);
      ro.position.set(sx * (elLen / 2 - 0.09), 0.03, sz * (W / 2 - 0.01)); el.add(ro);
    }
    // Stirnwände: erstes Element vorn, letztes hinten; Rahmen, Pfosten, bei Azure mit Tür
    const stirn = (sx) => {
      const sh = new THREE.Shape(); sh.absarc(0, -hoehe0, R, Math.PI / 2 - a, Math.PI / 2 + a, false); sh.closePath();
      const flaeche = new THREE.Mesh(new THREE.ShapeGeometry(sh, 40).rotateY(Math.PI / 2), wand);
      flaeche.position.x = sx * (elLen / 2 - 0.02); el.add(flaeche);
      for (const pz of (mitTuer ? [-W / 6, W / 6] : [0])) { // senkrechte Pfosten
        const hz = Math.sqrt(Math.max(R * R - pz * pz, 0)) - hoehe0;
        const po = new THREE.Mesh(new THREE.BoxGeometry(0.035, hz, 0.035), profil);
        po.position.set(sx * (elLen / 2 - 0.02), hz / 2, pz); el.add(po);
      }
      if (mitTuer) { // Türgriff in der mittleren Tür
        const gr = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.14, 0.02), new THREE.MeshStandardMaterial({ color: 0xcfd4d8, metalness: 0.7, roughness: 0.3 }));
        gr.position.set(sx * (elLen / 2 - 0.01), 0.55 * h, W / 6 - 0.08); el.add(gr);
      }
    };
    if (i === 0) stirn(-1);
    if (i === n - 1) stirn(1);
    el.position.x = THREE.MathUtils.lerp(xZu(i), xAuf(i), t);
    group.add(el);
  }

  // Laufschienen mit Rinne, Verlängerung und Endanschlägen
  const schienenLaenge = Lc + ext, cx = -Lc / 2 + schienenLaenge / 2;
  const seiten = einseitig ? [opts.schiene === 'rechts' ? 1 : -1] : [-1, 1];
  for (const sz of seiten) {
    const z = sz * (W / 2 + 0.01);
    const basis = new THREE.Mesh(new THREE.BoxGeometry(schienenLaenge, 0.03, 0.12), profil); basis.position.set(cx, 0.015, z);
    const rinne = new THREE.Mesh(new THREE.BoxGeometry(schienenLaenge, 0.012, 0.05), rolleMat); rinne.position.set(cx, 0.036, z);
    group.add(basis, rinne);
    for (const ex of [-Lc / 2, Lc / 2 + ext]) { const an = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.12), profil); an.position.set(ex, 0.03, z); group.add(an); }
  }
  group.traverse((o) => { if (o.isMesh && o.material === profil) o.castShadow = true; });
  return group;
}
