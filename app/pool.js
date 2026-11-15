// Parametrischer Aufbau eines Beckens (rechteck / rund / oval) inkl. Einstieg und Einbauteilen.
// Koordinaten: x = Länge, z = Breite, y = Höhe. Beckenkante liegt bei y = 0, der Boden bei y = -Tiefe.
// Alle Maße in Metern. Maße, Farben und Treppen-Richtwerte kommen aus der JSON-Datei.
import * as THREE from 'three';
import { wasserNormal, kaustikTextur } from './materialien.js';

export const WASSERSTAND = -0.10; // Vorgabe: Wasserspiegel unter der Beckenkante (m); je nach Skimmer überschrieben (cfg.wasserstand)

/** Einheitliche Beckenmaße aus einem Größeneintrag der JSON-Datei. */
export function masse(pool, g) {
  if (pool.form === 'rund') return { form: 'rund', L: g.durchmesser, B: g.durchmesser, T: g.tiefe };
  return { form: pool.form, L: g.laenge, B: g.breite, T: g.tiefe };
}

/** Beckenumriss als Punkte (x, z), um "off" Meter nach außen versetzt. */
export function umrissPunkte(m, off = 0, seg = 72) {
  const pts = [];
  if (m.form === 'rechteck') {
    const x = m.L / 2 + off, z = m.B / 2 + off;
    return [new THREE.Vector2(-x, -z), new THREE.Vector2(x, -z), new THREE.Vector2(x, z), new THREE.Vector2(-x, z)];
  }
  if (m.form === 'rund') {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2, r = m.L / 2 + off;
      pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
    }
    return pts;
  }
  // oval: gerade Seiten, halbrunde Enden (Radius = Breite / 2)
  const r = m.B / 2 + off, hl = (m.L - m.B) / 2, half = Math.round(seg / 2);
  for (let i = 0; i <= half; i++) { const a = -Math.PI / 2 + (i / half) * Math.PI; pts.push(new THREE.Vector2(hl + Math.cos(a) * r, Math.sin(a) * r)); }
  for (let i = 0; i <= half; i++) { const a = Math.PI / 2 + (i / half) * Math.PI; pts.push(new THREE.Vector2(-hl + Math.cos(a) * r, Math.sin(a) * r)); }
  return pts;
}

/** Flache Form (x/z-Punkte) als Geometrie in der x/z-Ebene (Normale nach oben). */
export function flaecheGeo(pts, loecher = []) {
  const toShape = (arr, S) => new (S)(arr.map((p) => new THREE.Vector2(p.x, -p.y)));
  const shape = toShape(pts, THREE.Shape);
  loecher.forEach((h) => shape.holes.push(toShape(h, THREE.Path)));
  return shape;
}

/** Senkrechte Wand über dem Umriss (von y = oben bis y = unten), beidseitig sichtbar. */
function wandGeo(pts, oben, unten) {
  const pos = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    pos.push(a.x, oben, a.y, a.x, unten, a.y, b.x, unten, b.y, a.x, oben, a.y, b.x, unten, b.y, b.x, oben, b.y);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Wandpunkt an einem Beckenende (vorz = +1: Ende bei +x, -1: Ende bei -x) auf Höhe z, Normale zeigt nach innen. */
function endpunkt(m, vorz, z) {
  const { L, B, form } = m;
  if (form === 'rechteck') return { x: vorz * L / 2, z, nx: -vorz, nz: 0 };
  const r = form === 'rund' ? L / 2 : B / 2, mitte = form === 'rund' ? 0 : vorz * (L - B) / 2;
  const x = mitte + vorz * Math.sqrt(Math.max(r * r - z * z, 0));
  const l = Math.hypot(x - mitte, z) || 1;
  return { x, z, nx: -(x - mitte) / l, nz: -z / l };
}

/** Beckenfläche in m² (Rechteck, Oval = Rechteck + Kreis, Rund). */
export function beckenflaeche(m) {
  if (m.form === 'rund') return Math.PI * (m.L / 2) ** 2;
  if (m.form === 'oval') return (m.L - m.B) * m.B + Math.PI * (m.B / 2) ** 2;
  return m.L * m.B;
}

/** Anzahl Skimmer: Standard 1, bei größeren Becken 2 (Schwelle aus der JSON-Datei). */
export function skimmerAnzahl(m, regel) {
  return beckenflaeche(m) >= regel.zwei_skimmer_ab_flaeche_m2 ? 2 : 1;
}

/**
 * Orte für die Beleuchtung. seite: lang_a, lang_b, beide (beide langen Seiten), kurz_einstieg, kurz_gegenueber.
 * lage (0..1) verschiebt die Gruppe entlang der Wand, mehrere Scheinwerfer sitzen mit Abstand nebeneinander.
 * Eine Seite ist der Normalfall (z. B. 2 Scheinwerfer an der langen Seite); bei "beide" wechseln sie sich ab.
 */
export function ledOrte(m, seite, lage, anzahl) {
  const { L, B, form } = m;
  const seiten = seite === 'beide' ? ['lang_a', 'lang_b'] : [seite];
  const orte = [];
  seiten.forEach((s, si) => {
    const n = Math.ceil((anzahl - si) / seiten.length);
    for (let i = 0; i < n; i++) orte.push(ledOrt(m, s, lage, i - (n - 1) / 2));
  });
  return orte;
}

function ledOrt(m, seite, lage, idx) {
  const { L, B, form } = m;
  if (form === 'rund') {
    const basis = { lang_a: 270, lang_b: 90, kurz_einstieg: 180, kurz_gegenueber: 0 }[seite] ?? 270;
    const a = (basis * Math.PI) / 180 + (lage - 0.5) * Math.PI + (idx * 1.2) / (L / 2);
    return { x: Math.cos(a) * L / 2, z: Math.sin(a) * L / 2, nx: -Math.cos(a), nz: -Math.sin(a) };
  }
  if (seite === 'kurz_einstieg' || seite === 'kurz_gegenueber') {
    const grenze = B / 2 - 0.35;
    const z = Math.max(-grenze, Math.min(grenze, (lage - 0.5) * B * 0.7 + idx * 0.8));
    return endpunkt(m, seite === 'kurz_einstieg' ? -1 : 1, z);
  }
  const gerade = form === 'oval' ? L - B : L, grenze = gerade / 2 - 0.3;
  const x = Math.max(-grenze, Math.min(grenze, (lage - 0.5) * gerade * 0.8 + idx * 1.2));
  return seite === 'lang_b' ? { x, z: B / 2, nx: 0, nz: -1 } : { x, z: -B / 2, nx: 0, nz: 1 };
}

/**
 * Orte für Skimmer, Düsen und Licht an der Beckenwand (x, z, Normale nach innen).
 * Skimmer: Schmalseite gegenüber dem Einstieg (Einstieg bei -x). Düsen: an den Längsseiten nahe dem Einstieg.
 */
export function wandOrte(m, anzSkimmer) {
  const { L, B, form } = m;
  const skimmer = anzSkimmer === 2 ? [-B / 4, B / 4].map((z) => endpunkt(m, 1, z)) : [endpunkt(m, 1, 0)];
  let duesen, led;
  if (form === 'rund') {
    const ort = (deg) => { const a = (deg * Math.PI) / 180; return { x: Math.cos(a) * L / 2, z: Math.sin(a) * L / 2, nx: -Math.cos(a), nz: -Math.sin(a) }; };
    duesen = [180 - 85, 180 - 55, 180 + 55, 180 + 85].map(ort);
    led = [90, 270, 120, 240].map(ort);
  } else {
    const x0 = -L / 2, zw = B / 2;
    const lang = (x, z) => ({ x, z, nx: 0, nz: z > 0 ? -1 : 1 });
    const gerade = form === 'oval' ? (L - B) : L; // Länge der geraden Wand
    const xa = x0 + (form === 'oval' ? B / 2 : 0);
    duesen = [xa + 1.6, xa + 2.6].flatMap((x) => [lang(Math.min(x, xa + gerade - 0.3), zw), lang(Math.min(x, xa + gerade - 0.3), -zw)]);
    led = [0.5, 0.5, 0.75, 0.75].map((f, i) => lang(xa + gerade * f, i % 2 ? -zw : zw));
  }
  return { skimmer, duesen, led };
}

const HOCH = new THREE.Vector3(0, 1, 0);

/**
 * Baut das Becken.
 * cfg: { pool, groesse, wandHex, rauigkeit, einstieg, seite, richtwerte, einbauHex,
 *        mitRand, premiumSkimmer: {hex}|null, led: {typ, anzahl}|null }
 */
export function buildPool(cfg) {
  const m = masse(cfg.pool, cfg.groesse);
  const { L, B, T } = m;
  const WS = cfg.wasserstand ?? WASSERSTAND; // Wasserspiegel (y), hängt vom Skimmer-Typ ab
  const group = new THREE.Group();
  const outline = umrissPunkte(m);

  const wand = new THREE.MeshPhysicalMaterial({ color: cfg.wandHex, roughness: cfg.rauigkeit ?? 0.5, clearcoat: 0.25, clearcoatRoughness: 0.35, side: THREE.DoubleSide });
  const einbau = new THREE.MeshStandardMaterial({ color: cfg.einbauHex, roughness: 0.5 });
  const edelstahl = new THREE.MeshStandardMaterial({ color: 0xe6eaec, metalness: 0.25, roughness: 0.35 });

  // Becken innen: Boden + Wand
  const boden = new THREE.Mesh(new THREE.ShapeGeometry(flaecheGeo(outline)).rotateX(-Math.PI / 2), wand);
  boden.position.y = -T; boden.receiveShadow = true;
  const waende = new THREE.Mesh(wandGeo(outline, 0, -T), wand);
  waende.receiveShadow = true;
  group.add(boden, waende);

  // Wasser: bei hoher Qualität echtes Brechen des Lichts (Transmission) mit Farbtiefe je nach Wassertiefe,
  // sonst einfache halbtransparente Fläche (schneller auf schwacher Grafik)
  const wasserFarbe = new THREE.Color(cfg.wasserHex ?? 0x2e9fd8);
  const wasserMat = cfg.realistisch
    ? new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 1, thickness: T * 0.9, ior: 1.333, roughness: 0.02,
        attenuationColor: wasserFarbe, attenuationDistance: 1.6, specularIntensity: 1, envMapIntensity: 1,
        normalMap: wasserNormal(), normalScale: new THREE.Vector2(0.025, 0.025) })
    : new THREE.MeshPhysicalMaterial({ color: wasserFarbe.clone().multiplyScalar(0.8), transparent: true, opacity: 0.8, roughness: 0.12, clearcoat: 0.25, ior: 1.33,
        specularIntensity: 0.5, envMapIntensity: 0.45, normalMap: wasserNormal(), normalScale: new THREE.Vector2(0.07, 0.07) });
  const wasser = new THREE.Mesh(new THREE.ShapeGeometry(flaecheGeo(umrissPunkte(m, -0.01))).rotateX(-Math.PI / 2), wasserMat);
  // Lichtmuster am Boden (nur bei hoher Qualität)
  if (cfg.realistisch) {
    const k = kaustikTextur().clone(); k.needsUpdate = true; k.repeat.set(L / 1.6, B / 1.6);
    const kaustik = new THREE.Mesh(new THREE.ShapeGeometry(flaecheGeo(umrissPunkte(m, -0.02))).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: k, color: 0x9fd8ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    // UVs in Weltmetern, damit das Muster nicht gestreckt ist
    const pos = kaustik.geometry.attributes.position, uv = kaustik.geometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / L + 0.5, pos.getZ(i) / B + 0.5);
    kaustik.position.y = -T + 0.004; kaustik.name = 'Kaustik'; kaustik.userData.kaustik = k;
    group.add(kaustik);
  }
  wasser.name = 'Wasser'; wasser.position.y = WS; wasser.renderOrder = cfg.realistisch ? 0 : 2;
  group.add(wasser);

  // Schlichte Beckenkante, solange keine Umrandung gewählt ist
  if (cfg.mitRand) {
    const rand = new THREE.Mesh(
      new THREE.ExtrudeGeometry(flaecheGeo(umrissPunkte(m, 0.12), [outline]), { depth: 0.04, bevelEnabled: false }).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.8 })
    );
    rand.position.y = -0.01; rand.receiveShadow = true;
    group.add(rand);
  }

  // Skimmer, Einlaufdüsen, Beleuchtung
  const orte = wandOrte(m, cfg.skimmerAnzahl ?? 1);
  const dunkel = new THREE.MeshStandardMaterial({ color: 0x1b2a33, roughness: 0.6 });
  const ausrichten = (mesh, o, tiefe) => {
    mesh.position.set(o.x + o.nx * 0.01, tiefe, o.z + o.nz * 0.01);
    mesh.quaternion.setFromUnitVectors(HOCH, new THREE.Vector3(o.nx, 0, o.nz));
    group.add(mesh);
  };
  // Teil an der Wand: Mitte (x,z) + Abstand "nach innen" (+) bzw. nach außen (-), gedreht wie die Wand
  const anWand = (mesh, o, innen, y) => {
    mesh.position.set(o.x + o.nx * innen, y, o.z + o.nz * innen);
    mesh.rotation.y = Math.atan2(o.nx, o.nz);
    group.add(mesh);
  };
  for (const o of orte.skimmer) {
    if (cfg.premiumSkimmer) {
      // Premium: nur ein schmaler Schlitz auf Wasserhöhe, Deckel in Einschubfarbe schließt bündig mit der Kante ab
      anWand(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.035, 0.012), dunkel), o, 0.004, WS);
      anWand(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.006, 0.07), new THREE.MeshStandardMaterial({ color: cfg.premiumSkimmer.hex, roughness: 0.4 })), o, -0.045, 0.03);
    } else {
      // Standard: Frontplatte in der Wand mit dunkler Wassereinlauf-Öffnung, Deckel oben auf der Kante
      anWand(new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.24, 0.012), einbau), o, 0.004, WS - 0.05);
      anWand(new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.07, 0.014), dunkel), o, 0.006, WS - 0.01);
      anWand(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.008, 0.30), einbau), o, -0.20, 0.028);
    }
  }
  const duesenGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.03, 16);
  orte.duesen.forEach((o) => ausrichten(new THREE.Mesh(duesenGeo, einbau), o, -0.55));
  if (cfg.led && cfg.led.anzahl > 0) {
    const ledMat = new THREE.MeshStandardMaterial({ color: cfg.led.hex, emissive: cfg.led.hex, emissiveIntensity: 1.4 });
    const ledGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.03, 20);
    ledOrte(m, cfg.led.seite ?? 'lang_a', cfg.led.lage ?? 0.5, cfg.led.anzahl).forEach((o) => ausrichten(new THREE.Mesh(ledGeo, ledMat), o, WS - 0.6));
  }

  baueEinstieg(group, { m, einstieg: cfg.einstieg, seite: cfg.seite, r: cfg.richtwerte, wand, edelstahl, ws: WS });
  group.traverse((o) => { if (o.isMesh && o !== wasser) { o.castShadow = o !== boden && o !== waende; } });
  return group;
}

/** Treppen, Sitzbänke und Leitern nach den bestätigten Richtwerten. */
function baueEinstieg(group, { m, einstieg, seite, r, wand, edelstahl, ws }) {
  const { L, B, T } = m;
  const s = seite === 'rechts' ? 1 : -1;      // Ecke an der Schmalseite (z-Richtung)
  const x0 = -L / 2;                          // Schmalseite mit dem Einstieg
  const h = r.stufenhoehe_m, d = r.stufentiefe_m;
  const n = Math.max(1, Math.min(r.stufenanzahl_bei_1_5m_tiefe, Math.floor((T - 0.2) / h)));
  const w = Math.min(r.ecktreppe_schenkel_m, B * 0.7);
  const bank = r.sitzstufe_sitzbank;
  const doppelt = wand.clone(); doppelt.side = THREE.DoubleSide;

  const block = (xa, xb, za, zb, oben) => { // massiver Block vom Boden bis zur Oberkante "oben"
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(xb - xa, oben + T, zb - za), wand);
    mesh.position.set((xa + xb) / 2, (oben - T) / 2, (za + zb) / 2);
    group.add(mesh);
  };
  const zEcke = (breite) => (s < 0 ? [-B / 2, -B / 2 + breite] : [B / 2 - breite, B / 2]);
  const zRest = (breite) => (s < 0 ? [-B / 2 + breite, B / 2] : [-B / 2, B / 2 - breite]);
  const sitzbank = (breite) => { const [za, zb] = zRest(breite); block(x0, x0 + bank.tiefe_m, za, zb, ws - bank.hoehe_unter_wasserspiegel_m); };
  const keil = (form, i) => { // Dreieck oder Viertelkreis in der Ecke, Höhe passend zur Stufe i
    const leg = (w * i) / n, sh = new THREE.Shape();
    sh.moveTo(0, 0); sh.lineTo(leg, 0);
    if (form === 'rund') sh.absarc(0, 0, leg, 0, (s * Math.PI) / 2, s < 0); else sh.lineTo(0, s * leg);
    sh.closePath();
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: T - h * i, bevelEnabled: false }).rotateX(-Math.PI / 2), doppelt);
    mesh.position.set(x0, -T, s * B / 2); // Form-y wird zu Welt -z, Extrusion zu +y
    group.add(mesh);
  };

  const art = einstieg;
  if (/leiter/.test(art) || !art) {
    // Einhängeleiter: Holme steigen auf der Kante an, biegen über die Beckenkante und führen innen an der Wand ins Wasser
    const zc = s * Math.min(0.6, B / 4);
    const wandX = m.form === 'rechteck' ? x0 : endpunkt(m, -1, zc).x;
    const xa = wandX - 0.20, xb = wandX + 0.12;         // Standfuß auf der Kante, Innenholm im Becken
    const oben = 0.72, rr = 0.13, unten = -Math.min(T - 0.15, 1.15), rohr = 0.022;
    const pfad = (z) => {
      const P = (x, y) => new THREE.Vector3(x, y, z), c = new THREE.CurvePath();
      c.add(new THREE.LineCurve3(P(xa, 0.02), P(xa, oben - rr)));
      c.add(new THREE.QuadraticBezierCurve3(P(xa, oben - rr), P(xa, oben), P(xa + rr, oben)));
      c.add(new THREE.LineCurve3(P(xa + rr, oben), P(xb - rr, oben)));
      c.add(new THREE.QuadraticBezierCurve3(P(xb - rr, oben), P(xb, oben), P(xb, oben - rr)));
      c.add(new THREE.LineCurve3(P(xb, oben - rr), P(xb, unten)));
      return c;
    };
    for (const dz of [-0.22, 0.22]) {
      group.add(new THREE.Mesh(new THREE.TubeGeometry(pfad(zc + dz), 48, rohr, 10), edelstahl));
      const fuss = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 16), edelstahl); // Rosette auf der Kante
      fuss.position.set(xa, 0.02, zc + dz); group.add(fuss);
    }
    const sprosse = new THREE.CylinderGeometry(0.018, 0.018, 0.44, 12).rotateX(Math.PI / 2);
    for (let y = -0.25; y > unten + 0.1; y -= 0.30) { // Stufen nur im Wasserbereich
      const sp = new THREE.Mesh(sprosse, edelstahl); sp.position.set(xb, y, zc); group.add(sp);
    }
    return;
  }
  const volleBreite = ['stufen_volle_breite', 'durchgehende_treppe', 'stufenanlage'].includes(art);
  const diagonal = art.includes('diagonal') || art === 'diagonaltreppe';
  const rund = art.includes('rund');
  const mitBank = art.includes('sitzbank') || art.includes('sitzstufe');

  for (let i = 1; i <= n; i++) {
    if (volleBreite) block(x0, x0 + i * d, -B / 2, B / 2, -h * i);
    else if (diagonal) keil('diagonal', i);
    else if (rund) keil('rund', i);
    else if (art === 'seitliche_treppe') { const [za, zb] = zEcke(Math.min(r.seitliche_treppe_breite_m, B * 0.7)); block(x0, x0 + i * d, za, zb, -h * i); } // an der Schmalseite, links oder rechts
    else { const [za, zb] = zEcke(w); block(x0, x0 + i * d, za, zb, -h * i); }
  }
  if (mitBank) sitzbank(w);
}
