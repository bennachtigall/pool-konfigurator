// Querschnitt / Längsschnitt durch Systemstein-, Kompakt- und PP-Becken.
// Zwei Teile: (1) eine Schnittebene (Clipping), die das Modell aufschneidet,
// (2) die Schnittfläche ("Kappe") mit den Schichten des Wandaufbaus aus dem Feld "aufbau" der JSON-Datei.
import * as THREE from 'three';

/** Lage des Schnitts in Metern aus dem Anteil 0..1 (0,5 = Mitte). */
export function schnittPosition(m, achse, anteil) {
  return achse === 'quer' ? (anteil - 0.5) * m.L * 0.9 : (anteil - 0.5) * m.B * 0.9;
}

/** Schnittebene: behält bei "quer" alles mit x <= lage, bei "laengs" alles mit z <= lage. */
export function schnittEbene(achse, lage) {
  return achse === 'quer' ? new THREE.Plane(new THREE.Vector3(-1, 0, 0), lage) : new THREE.Plane(new THREE.Vector3(0, 0, -1), lage);
}

/**
 * Schnittfläche. Lokal: u = Richtung quer zum Schnitt in der Ebene, y = Höhe.
 * Bei "quer" liegt u auf -z (Gruppe um 90° gedreht), bei "laengs" auf x.
 */
export function baueSchnittflaeche(m, aufbau, achse, lage, { wandHex, wasserHex, ws }) {
  const { L, B, T } = m;
  const halb = achse === 'quer' ? B / 2 : L / 2;
  const g = new THREE.Group();
  const flaeche = (u0, u1, y0, y1, hex, z = 0, extra = {}) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(u1 - u0, y1 - y0), new THREE.MeshStandardMaterial({ color: hex, roughness: 1, side: THREE.DoubleSide, ...extra }));
    mesh.position.set((u0 + u1) / 2, (y0 + y1) / 2, z);
    g.add(mesh);
    return mesh;
  };

  if (aufbau.typ === 'steine') {
    // Styroporstein = Dämmschale innen + Betonkern + Dämmschale außen; im Kern liegt der Baustahl (Richtwerte aus der JSON-Datei)
    const bt = aufbau.beton, bd = bt.boden.dicke_m, fo = 0.006;                 // Folie überhöht (real 0,8 mm)
    const [, , sh0] = aufbau.stein_m, di = bt.daemmung_innen_m, kern = bt.kern_m, da = bt.daemmung_aussen_m;
    const n = Math.max(1, Math.round(T / sh0)), sh = T / n;
    const stahl = 0x2a1f1a, beton = 0x8d8e8a;
    const punkt = (u, y, d) => { const c = new THREE.Mesh(new THREE.CircleGeometry(Math.max(d, 0.02) / 2, 14), new THREE.MeshStandardMaterial({ color: stahl, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide })); c.position.set(u, y, 0.002); g.add(c); };
    const dStahl = bt.baustahl_wand.durchmesser_mm / 1000;
    for (const s of [-1, 1]) {
      const u0 = s * halb, u1 = u0 + s * di, u2 = u1 + s * kern, u3 = u2 + s * da;     // innen -> außen
      const lo = (p, q) => [Math.min(p, q), Math.max(p, q)];
      flaeche(...lo(u0, u3), -T, 0, 0x3a3d3f, -0.001);                                  // dunkler Grund = Fugen
      for (let k = 0; k < n; k++) {                                                      // Dämmschalen je Steinlage
        const y0 = -T + k * sh + 0.004, y1 = -T + (k + 1) * sh - 0.004;
        flaeche(...lo(u0, u1), y0, y1, 0xf0f2ee); flaeche(...lo(u2, u3), y0, y1, 0xe9ebe6);
      }
      flaeche(...lo(u1, u2), -T, 0, beton);                                              // Betonkern, durchgehend vergossen
      const mitte = (u1 + u2) / 2;
      flaeche(mitte - 0.006, mitte + 0.006, -T + 0.05, -0.05, stahl, 0.0015);              // senkrechter Baustahl (überhöht dargestellt)
      for (let y = -T + 0.125; y < -0.05; y += bt.baustahl_wand.abstand_m) punkt(mitte, y, dStahl); // waagerechter Baustahl im Schnitt
      flaeche(Math.min(u0, u0 - s * fo), Math.max(u0, u0 - s * fo), -T, 0, wandHex, 0.0006);       // Folie an der Wand
    }
    flaeche(-halb, halb, -T, -T + fo, wandHex, 0.0006);                                  // Folie am Boden
    flaeche(-(halb + di + kern + da), halb + di + kern + da, -T - bd, -T, beton);        // Betonbodenplatte
    const dm = bt.boden.matte_durchmesser_mm / 1000, ext = halb + di + kern + da - 0.05;
    for (let u = -ext; u <= ext + 1e-6; u += bt.boden.abstand_m) punkt(u, -T - bd * 0.7, dm);        // Bewehrungsmatte im Schnitt
    flaeche(-ext, ext, -T - bd * 0.7 - 0.004, -T - bd * 0.7 + 0.004, stahl, 0.0015);   // Längsstab der Matte
  } else if (aufbau.typ === 'pp_fertigbecken') {
    const wp = aufbau.wand_platte_mm / 1000, dm = aufbau.daemmung_mm / 1000, bp = aufbau.boden_platte_mm / 1000;
    for (const s of [-1, 1]) {
      const reg = (u0, u1, hex, y0 = -T - bp - dm) => flaeche(Math.min(s * u0, s * u1), Math.max(s * u0, s * u1), y0, 0, hex);
      reg(halb, halb + wp, wandHex);                       // PP-Platte (Wand)
      reg(halb + wp, halb + wp + dm, 0xe7e2d2);            // Wandisolation
    }
    flaeche(-(halb + wp + dm), halb + wp + dm, -T - bp, -T, wandHex);        // PP-Platte (Boden)
    flaeche(-(halb + wp + dm), halb + wp + dm, -T - bp - dm, -T - bp, 0xe7e2d2); // Isolation unter dem Boden
  }
  // Wasser im Schnitt (halbtransparent)
  const wasser = flaeche(-halb + 0.006, halb - 0.006, -T + 0.006, ws, wasserHex, 0.0003, { transparent: true, opacity: 0.5 });
  wasser.renderOrder = 3;

  if (achse === 'quer') { g.rotation.y = Math.PI / 2; g.position.set(lage + 0.0005, 0, 0); }
  else g.position.set(0, 0, lage + 0.0005);
  g.name = 'Schnittflaeche';
  return g;
}
