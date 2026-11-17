// Parametrischer Aufbau eines Beckens (rechteck / rund / oval) inkl. Einstieg und Einbauteilen.
// Koordinaten: x = Länge, z = Breite, y = Höhe. Beckenkante liegt bei y = 0, der Boden bei y = -Tiefe.
// Alle Maße in Metern. Maße, Farben und Treppen-Richtwerte kommen aus der JSON-Datei.
import * as THREE from 'three';
import { wasserNormal, wasserWellen, kaustikTextur } from './materialien.js';
import { Water } from './lib/Water2.js';

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
 * Orte für die Beleuchtung: gleichmäßig über die gewählte Wand verteilt (nicht dicht nebeneinander).
 * seite: lang_a, lang_b, beide, kurz_einstieg, kurz_gegenueber. lage (0..1) verschiebt die Verteilung leicht.
 * frei: { xVon } – an den Längsseiten beginnt der freie Bereich erst hinter der Treppe.
 */
export function ledOrte(m, seite, lage, anzahl, frei = {}, rand = 0.5) {
  const { L, B, form } = m;
  if (form === 'rund') {
    const basis = { lang_a: 270, lang_b: 90, kurz_einstieg: 180, kurz_gegenueber: 0, beide: 270 }[seite] ?? 270;
    const spanne = seite === 'beide' ? 300 : Math.min(150, anzahl * 50);               // Bogen, über den verteilt wird
    return Array.from({ length: anzahl }, (_, i) => {
      const a = THREE.MathUtils.degToRad(basis + (lage - 0.5) * 60 + (anzahl > 1 ? -spanne / 2 + (spanne * i) / (anzahl - 1) : 0));
      return { x: Math.cos(a) * L / 2, z: Math.sin(a) * L / 2, nx: -Math.cos(a), nz: -Math.sin(a) };
    });
  }
  const verteilen = (von, bis, n) => { // n Punkte gleichmäßig, Abstand zum Rand = halber Abstand untereinander
    const len = Math.max(bis - von, 0.01), versatz = (lage - 0.5) * (len / Math.max(n, 1)) * 0.8;
    return Array.from({ length: n }, (_, i) => THREE.MathUtils.clamp(von + (len * (i + 0.5)) / n + versatz, von, bis));
  };
  if (seite === 'kurz_einstieg' || seite === 'kurz_gegenueber') {
    const r = (form === 'oval' ? B / 2 : B / 2) - rand;
    return verteilen(-r, r, anzahl).map((z) => endpunkt(m, seite === 'kurz_einstieg' ? -1 : 1, z));
  }
  const gerade = form === 'oval' ? L - B : L;
  const von = Math.max(-gerade / 2 + rand, frei.xVon ?? -Infinity), bis = gerade / 2 - rand;
  const langA = (x) => ({ x, z: -B / 2, nx: 0, nz: 1 }), langB = (x) => ({ x, z: B / 2, nx: 0, nz: -1 });
  if (seite === 'beide') return verteilen(von, bis, anzahl).map((x, i) => (i % 2 ? langB(x) : langA(x)));
  return verteilen(von, bis, anzahl).map(seite === 'lang_b' ? langB : langA);
}

/**
 * Belegung der Einstiegsseite (Schmalseite bei −x) durch Treppe/Leiter/Sitzbank, damit Düsen und Licht ausweichen.
 * Rückgabe: { oben: [[z0,z1]…], unten: [[z0,z1]…], tiefe } – gesperrte Bereiche für die obere/untere Düsenreihe,
 * tiefe = wie weit die Treppe ins Becken ragt (für Teile an den Längsseiten).
 */
export function einstiegsBelegung(m, einstieg, seite, r) {
  const { B, T } = m, s = seite === 'rechts' ? 1 : -1;
  if (!einstieg || /leiter/.test(einstieg)) {
    const zc = s * Math.min(0.6, B / 4);
    return { oben: [[zc - 0.4, zc + 0.4]], unten: [[zc - 0.4, zc + 0.4]], tiefe: 0.3 };
  }
  const n = Math.max(1, Math.min(r.stufenanzahl_bei_1_5m_tiefe, Math.floor((T - 0.2) / r.stufenhoehe_m)));
  const w = Math.min(r.ecktreppe_schenkel_m, B * 0.7), tiefe = Math.max(n * r.stufentiefe_m, w) + 0.2;
  if (['stufen_volle_breite', 'durchgehende_treppe', 'stufenanlage'].includes(einstieg)) return { oben: [[-B, B]], unten: [[-B, B]], tiefe: n * r.stufentiefe_m + 0.2 };
  const breite = einstieg === 'seitliche_treppe' ? Math.min(r.seitliche_treppe_breite_m, B * 0.7) : w;
  const ecke = s < 0 ? [-B / 2, -B / 2 + breite + 0.25] : [B / 2 - breite - 0.25, B / 2];
  const bank = /sitz/.test(einstieg) ? (s < 0 ? [-B / 2 + breite, B / 2] : [-B / 2, B / 2 - breite]) : null;
  return { oben: [ecke], unten: bank ? [ecke, bank] : [ecke], tiefe };
}

/** Freie Abschnitte in [von, bis] ohne die gesperrten Bereiche. */
function freieAbschnitte(von, bis, gesperrt) {
  let teile = [[von, bis]];
  for (const [a, b] of gesperrt) teile = teile.flatMap(([p, q]) => (b <= p || a >= q ? [[p, q]] : [[p, Math.min(a, q)], [Math.max(b, p), q]]).filter(([x, y]) => y - x > 0.05));
  return teile;
}
/** k Punkte gleichmäßig über mehrere Abschnitte verteilen (Abstand ≥ minAbstand, sonst weniger Punkte). */
function aufAbschnitte(teile, k, minAbstand) {
  const gesamt = teile.reduce((s, [a, b]) => s + b - a, 0);
  k = Math.min(k, Math.max(0, Math.floor(gesamt / minAbstand)));
  const pos = [];
  for (let i = 0; i < k; i++) {
    let t = (gesamt * (i + 0.5)) / k;
    for (const [a, b] of teile) { if (t <= b - a) { pos.push(a + t); break; } t -= b - a; }
  }
  return pos;
}

/**
 * Einlaufdüsen: immer auf der dem Skimmer gegenüberliegenden Seite (Skimmer bei +x, Düsen bei −x).
 * Obere Reihe ca. 30 cm unter der Kante; passen nicht alle auf die Wand, kommt eine untere Reihe dazu,
 * danach die Längsseiten direkt hinter der Treppe. Rückgabe: [{ x, z, nx, nz, y }].
 */
export function duesenOrte(m, anzahl, belegung, regel) {
  const { L, B, T, form } = m;
  const yOben = -regel.obere_reihe_unter_kante_m, yUnten = -T + regel.untere_reihe_ueber_boden_m;
  if (form === 'rund') { // gegenüber dem Skimmer (Skimmer bei 0°), Bogen um 180°, Leiterbereich meiden
    const R = L / 2, ort = (deg, y) => { const a = THREE.MathUtils.degToRad(deg); return { x: Math.cos(a) * R, z: Math.sin(a) * R, nx: -Math.cos(a), nz: -Math.sin(a), y }; };
    const winkel = [150, 210, 125, 235].slice(0, anzahl);
    return winkel.map((w) => ort(w, yOben));
  }
  const rand = 0.3, grenze = form === 'oval' ? B / 2 - 0.35 : B / 2 - rand;
  const orte = [];
  const oben = aufAbschnitte(freieAbschnitte(-grenze, grenze, belegung.oben), anzahl, regel.min_abstand_m);
  oben.forEach((z) => orte.push({ ...endpunkt(m, -1, z), y: yOben }));
  if (orte.length < anzahl) {
    const unten = aufAbschnitte(freieAbschnitte(-grenze, grenze, belegung.unten), anzahl - orte.length, regel.min_abstand_m);
    unten.forEach((z) => orte.push({ ...endpunkt(m, -1, z), y: yUnten }));
  }
  // Rest: an den Längsseiten direkt hinter der Treppe, abwechselnd links/rechts
  const xLang = -L / 2 + (form === 'oval' ? B / 2 : 0) + Math.max(belegung.tiefe, 0.4) + 0.3;
  for (let i = 0; orte.length < anzahl; i++) {
    const z = i % 2 ? B / 2 : -B / 2, x = xLang + Math.floor(i / 2) * regel.min_abstand_m;
    orte.push({ x, z, nx: 0, nz: z > 0 ? -1 : 1, y: yOben });
  }
  return orte;
}

/** Anzahl Einlaufdüsen: Datenblattangabe des Pools, sonst Richtwert nach Beckenfläche. */
export function duesenAnzahl(pool, m, regel) {
  if (pool.anzahl_einlaufduesen) return pool.anzahl_einlaufduesen;
  const f = beckenflaeche(m);
  return regel.nach_flaeche_m2.find(([bis]) => f < bis)[1];
}

/** Einlaufdüse: weißer Flansch, Topf und schwenkbare Kugel mit Austrittsöffnung (ca. Ø 11 cm). */
function duesenModell(mat) {
  const g = new THREE.Group();
  const dunkel = new THREE.MeshStandardMaterial({ color: 0x20282c, roughness: 0.7 });
  const flansch = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.058, 0.012, 32), mat); flansch.position.y = 0.006;
  const topf = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.012, 24, 1, true), dunkel); topf.position.y = 0.012;
  const kugel = new THREE.Mesh(new THREE.SphereGeometry(0.026, 24, 16), mat); kugel.position.y = 0.012;
  const loch = new THREE.Mesh(new THREE.CircleGeometry(0.009, 16).rotateX(-Math.PI / 2), dunkel); loch.position.y = 0.0385;
  g.add(flansch, topf, kugel, loch);
  return g;
}

/** Unterwasserscheinwerfer (flacher LED-Spot, ca. Ø 17 cm): Flansch, Reflektorring, leuchtende Linse. */
function ledModell(hex, durchmesser) {
  const r = durchmesser / 2, g = new THREE.Group();
  const weiss = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.35 });
  const flansch = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.03, 0.014, 40), weiss); flansch.position.y = 0.007;
  const reflektor = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r * 0.8, 0.004, 40), new THREE.MeshStandardMaterial({ color: 0xdfe6ea, metalness: 0.8, roughness: 0.2 })); reflektor.position.y = 0.015;
  const linse = new THREE.Mesh(new THREE.SphereGeometry(r * 0.72, 32, 8, 0, Math.PI * 2, 0, 0.35).scale(1, 0.25, 1),
    new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 2.2, roughness: 0.15 }));
  linse.position.y = 0.006;
  g.add(flansch, reflektor, linse);
  const licht = new THREE.PointLight(hex, 1.6, 4.5, 2); licht.position.y = 0.25; g.add(licht); // Lichtkegel ins Wasser
  return g;
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
 *        spiegelWasser, spiegelAufloesung, sonne (Richtung), himmel (Funktion → Hintergrund für die Spiegelung),
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

  // Wasser: drei Stufen
  //  – Spiegelwasser (Hoch/Ultra im Garten): echte Spiegelung von Himmel, Haus und Hecke und echte Lichtbrechung
  //    (Wand, Stufen und Boden erscheinen durch die Wellen leicht verzerrt), Anteil je nach Blickwinkel (Fresnel),
  //    dazu Sonnenglitzern auf den Wellen. Kostet zwei zusätzliche Bilder je Rendern.
  //  – sonst: halbtransparente Fläche mit Umgebungsspiegelung (schnell, auch für Foto-Montage und Querschnitt)
  const wasserFarbe = new THREE.Color(cfg.wasserHex ?? 0x2e9fd8);
  // Unter Wasser: Wand, Boden und Treppen werden mit der Tiefe gleichmäßig in Wasserfarbe getönt
  if (cfg.realistisch) unterWasserToenung(wand, wasserFarbe, WS);
  const wasserGeo = new THREE.ShapeGeometry(flaecheGeo(umrissPunkte(m, -0.01)));
  let wasser;
  if (cfg.spiegelWasser) {
    // Spiegel und Brechung berechnen ihre Ebene aus der Lage des Objekts: Fläche daher als Objekt drehen, nicht die Geometrie
    const n0 = wasserWellen(1), n1 = wasserWellen(2); // zwei verschiedene Wellenbilder, die ineinander überblenden
    wasser = new Water(wasserGeo, {
      color: new THREE.Color(0xffffff).lerp(wasserFarbe, 0.18), // leichte Tönung; die Tiefenfarbe kommt von der Unterwasser-Tönung
      scale: 0.42, flowDirection: new THREE.Vector2(0.6, 0.35), flowSpeed: 0.012, reflectivity: 0.02,
      textureWidth: cfg.spiegelAufloesung ?? 512, textureHeight: cfg.spiegelAufloesung ?? 512,
      normalMap0: n0, normalMap1: n1, verzerrung: 0.02, spiegelStaerke: 0.7, sonne: cfg.sonne, himmel: cfg.himmel,
    });
    wasser.rotation.x = -Math.PI / 2;
    wasser.userData.entsorgen = () => wasser.dispose(); // Wellenbilder bleiben (werden wiederverwendet)
  } else {
    const wasserMat = new THREE.MeshPhysicalMaterial({
      color: wasserFarbe, transparent: true, opacity: cfg.realistisch ? 0.22 : 0.7,
      roughness: 0.02, metalness: 0, ior: 1.333, specularIntensity: 1, clearcoat: 1, clearcoatRoughness: 0.02,
      envMapIntensity: cfg.realistisch ? 0.8 : 0.45, depthWrite: false,
      normalMap: wasserNormal(), normalScale: new THREE.Vector2(0.06, 0.06) });
    wasser = new THREE.Mesh(wasserGeo.rotateX(-Math.PI / 2), wasserMat);
  }
  // Lichtmuster am Boden (nur bei hoher Qualität)
  if (cfg.realistisch) {
    const k = kaustikTextur().clone(); k.needsUpdate = true; k.repeat.set(L / 1.6, B / 1.6);
    const kaustik = new THREE.Mesh(new THREE.ShapeGeometry(flaecheGeo(umrissPunkte(m, -0.02))).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: k, color: 0x9fd8ff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    // UVs in Weltmetern, damit das Muster nicht gestreckt ist
    const pos = kaustik.geometry.attributes.position, uv = kaustik.geometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / L + 0.5, pos.getZ(i) / B + 0.5);
    kaustik.position.y = -T + 0.012; kaustik.name = 'Kaustik'; kaustik.userData.kaustik = k;
    group.add(kaustik);
  }
  wasser.name = 'Wasser'; wasser.position.y = WS; wasser.renderOrder = 2;
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
  // Einlaufdüsen gegenüber dem Skimmer, Treppe/Leiter werden ausgespart
  const belegung = einstiegsBelegung(m, cfg.einstieg, cfg.seite, cfg.richtwerte);
  const dRegel = cfg.duesenRegel ?? { nach_flaeche_m2: [[15, 2], [30, 3], [9999, 4]], obere_reihe_unter_kante_m: 0.3, untere_reihe_ueber_boden_m: 0.35, min_abstand_m: 0.6 };
  duesenOrte(m, duesenAnzahl(cfg.pool, m, dRegel), belegung, dRegel).forEach((o) => ausrichten(duesenModell(einbau), o, o.y));
  if (cfg.led && cfg.led.anzahl > 0) {
    const lr = cfg.ledRegel ?? { unter_wasserspiegel_m: 0.6, randabstand_m: 0.5, durchmesser_m: 0.17 };
    const frei = { xVon: -L / 2 + (m.form === 'oval' ? B / 2 : 0) + belegung.tiefe + 0.3 };
    ledOrte(m, cfg.led.seite ?? 'lang_a', cfg.led.lage ?? 0.5, cfg.led.anzahl, frei, lr.randabstand_m)
      .forEach((o) => ausrichten(ledModell(cfg.led.hex, lr.durchmesser_m), o, WS - lr.unter_wasserspiegel_m));
  }

  baueEinstieg(group, { m, einstieg: cfg.einstieg, seite: cfg.seite, r: cfg.richtwerte, wand, edelstahl, ws: WS });
  group.traverse((o) => { if (o.isMesh && o !== wasser) { o.castShadow = o !== boden && o !== waende && o.parent === group; } }); // Kleinteile werfen keine Schatten
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
  doppelt.onBeforeCompile = wand.onBeforeCompile; doppelt.customProgramCacheKey = wand.customProgramCacheKey; // Unterwasser-Tönung mitnehmen

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

/**
 * Tönt ein Material unterhalb des Wasserspiegels wie echtes Wasser (Lambert-Beer):
 * Licht wird auf dem Weg durchs Wasser je Farbe unterschiedlich geschluckt (Rot zuerst, Blau zuletzt) und
 * durch Streulicht in Wasserfarbe ersetzt. Der Weg ist umso länger, je tiefer die Stelle liegt und je flacher
 * man auf das Wasser schaut. Über Wasser bleibt die Farbe unverändert.
 */
function unterWasserToenung(mat, farbe, ws) {
  mat.onBeforeCompile = (shader) => {
    const lin = farbe.clone().convertSRGBToLinear();
    // Schluckrate je Meter: klares Wasser (Rot 0,45 · Grün 0,09 · Blau 0,035 je m) plus etwas Tönung aus der Wasserfarbe
    const rein = [0.45, 0.09, 0.035];
    const schluck = [lin.r, lin.g, lin.b].map((v, i) => rein[i] - Math.log(Math.max(v, 0.03)) * 0.06);
    shader.uniforms.uWasserFarbe = { value: lin };
    shader.uniforms.uSchluck = { value: new THREE.Vector3(...schluck) };
    shader.uniforms.uWS = { value: ws };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWelt;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWelt = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWelt;\nuniform vec3 uWasserFarbe;\nuniform vec3 uSchluck;\nuniform float uWS;')
      .replace('#include <opaque_fragment>', `
        float tiefe = max(uWS - vWelt.y, 0.0);
        if (tiefe > 0.0) {
          vec3 blick = normalize(cameraPosition - vWelt);
          // Weg im Wasser: Licht von oben herein (≈ Tiefe) + zurück zum Auge (Tiefe / Sinus des Blickwinkels)
          float weg = tiefe * (1.0 + 1.0 / max(abs(blick.y), 0.25));
          vec3 durch = exp(-uSchluck * weg);
          vec3 streu = uWasserFarbe * 0.35;                       // Streulicht im Wasser
          outgoingLight = outgoingLight * durch + streu * (1.0 - durch);
        }
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'unterwasser3' + ws.toFixed(3) + farbe.getHexString();
}
