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
    const [, t, sh0] = aufbau.stein_m, bd = aufbau.boden.dicke_m, fo = 0.006; // Folie überhöht (real 0,8 mm)
    const n = Math.max(1, Math.round(T / sh0)), sh = T / n;
    for (const s of [-1, 1]) {
      const a = s * halb, b = s * (halb + t);
      flaeche(Math.min(a, b), Math.max(a, b), -T, 0, 0x3a3d3f, -0.001);                       // dunkler Hintergrund = Fugen
      for (let k = 0; k < n; k++) flaeche(Math.min(a, b) + 0.003, Math.max(a, b) - 0.003, -T + k * sh + 0.004, -T + (k + 1) * sh - 0.004, 0xe9ebe6); // Steinlagen
      flaeche(Math.min(a, a - s * fo), Math.max(a, a - s * fo), -T, 0, wandHex, 0.0006);       // Folie an der Wand
    }
    flaeche(-halb, halb, -T, -T + fo, wandHex, 0.0006);                                         // Folie am Boden
    flaeche(-(halb + t), halb + t, -T - bd, -T, 0x9a9d9f);                                      // Bodenplatte
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
