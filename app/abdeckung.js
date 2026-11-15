// Abdeckungen: Safty (Rollabdeckung), WaluDeck (Poolterrasse), Roll'Top 100 / 300.
// Maße, Farben und Regeln stammen aus der JSON-Datei; hier steht nur die Geometrie.
import * as THREE from 'three';

const fmt = (z) => String(Math.round(z * 100) / 100).replace('.', ',');

/** Safty: kleinste Größe, deren Innenmaß das Becken (Länge × Breite) umfasst. */
export function saftyGroesse(a, m) {
  const g = a.groessen.filter((x) => x.innen[0] >= m.L - 1e-6 && x.innen[1] >= m.B - 1e-6)
    .sort((p, q) => p.innen[0] * p.innen[1] - q.innen[0] * q.innen[1])[0];
  return g || null;
}

/** Streifen-/Fliesentextur (Graustufen, wird mit der Farbe multipliziert). */
function textur(art, wdh) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 3;
  const linien = art === 'fliese' ? 2 : art === 'holz' ? 8 : 24;
  if (art === 'lamelle') { // Lamellen quer zur Beckenlänge: senkrechte Linien
    for (let i = 0; i < linien; i++) { const p = (i * 256) / linien; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 256); g.stroke(); }
  } else for (let i = 0; i < linien; i++) { const p = (i * 256) / linien; g.beginPath(); g.moveTo(0, p); g.lineTo(256, p); g.stroke(); }
  if (art === 'fliese') for (let i = 0; i < 2; i++) { const p = i * 128; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 256); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(wdh[0], wdh[1]); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const matte = (hex, r = 0.6, m = 0) => new THREE.MeshStandardMaterial({ color: hex, roughness: r, metalness: m });

/** Rollladen-Lamellenfläche über dem Becken (geschlossen). */
function lamellenFlaeche(L, B, hex, y) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(L, B).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: hex, roughness: 0.5, map: textur('lamelle', [L / 1.44, 1]), side: THREE.DoubleSide }));
  mesh.position.y = y;
  return mesh;
}

/**
 * Baut die Abdeckung.
 * m: Beckenmaße, rand: Breite der Umrandung (m), o: Auswahl (je nach Typ)
 */
export function baueAbdeckung(a, m, rand, o, farben) {
  const group = new THREE.Group();
  const { L, B } = m;

  if (a.id === 'safty_individual') {
    const g = saftyGroesse(a, m);
    const [al, ab] = g.aussen;
    const bahn = new THREE.Mesh(new THREE.PlaneGeometry(al, ab).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x7c8286, roughness: 0.8, side: THREE.DoubleSide }));
    bahn.position.y = 0.035;
    group.add(bahn);
    // Aluprofile (Ø 44 mm) quer über die Abdeckung
    const rohr = new THREE.CylinderGeometry(0.022, 0.022, ab, 10).rotateX(Math.PI / 2);
    for (let x = -al / 2 + 0.3; x < al / 2; x += 0.6) { const r = new THREE.Mesh(rohr, matte(0xb5babd, 0.4, 0.4)); r.position.set(x, 0.045, 0); group.add(r); }
    return group;
  }

  if (a.id === 'waludeck_origin') {
    const quer = o.ausfuehrung === 'C' || o.ausfuehrung === 'D';   // Schienen an den Breitseiten
    const zweiteilig = o.ausfuehrung === 'B' || o.ausfuehrung === 'D';
    const dl = L + 0.1, db = B + 0.1, dicke = 0.25;
    const hex = farben.terrasse[o.verkleidung].hex;
    const art = o.verkleidung === 'holz' ? 'holz' : 'fliese';
    const oben = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.7, map: textur(art, [dl / 1.2, db / 1.2]) });
    const seite = matte(0x6a6e71, 0.7);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(dl, dicke, db), [seite, seite, oben, seite, seite, seite]);
    deck.position.set(0, 0.04 - dicke / 2, 0);
    group.add(deck);
    // Mittelfuge bei zweiteiliger Ausführung
    if (zweiteilig) {
      const fuge = new THREE.Mesh(new THREE.BoxGeometry(quer ? 0.02 : dl, 0.01, quer ? db : 0.02), matte(0x222222));
      fuge.position.set(0, 0.046, 0);
      group.add(fuge);
    }
    // Schienen mit Auslauf, damit die Terrasse zur Seite fahren kann
    const lang = quer ? db : dl;
    const schienen = zweiteilig ? lang * 2 : lang * 1.5;
    const versatz = zweiteilig ? 0 : lang * 0.25;
    for (const s of [-1, 1]) {
      const sch = new THREE.Mesh(new THREE.BoxGeometry(quer ? 0.1 : schienen, 0.03, quer ? schienen : 0.1), matte(0x4a4e52, 0.5, 0.4));
      sch.position.set(quer ? s * (dl / 2 + 0.07) : versatz, 0.015, quer ? versatz : s * (db / 2 + 0.07));
      group.add(sch);
    }
    return group;
  }

  // Roll'Top 100 und 300: Wickelwelle am Beckenende (x+), Lamellenfläche über dem Wasser
  const x = L / 2 + rand;
  const lamHex = farben.lamellen[o.lamellen];
  group.add(lamellenFlaeche(L, B, lamHex, 0.03));

  if (a.id === 'rolltop_100') {
    const gestell = matte(farben.profil[o.gestell], 0.5, 0.2);
    const mm = a.masse_mm;
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(mm.pfosten_tiefe / 1000, mm.pfosten_hoehe / 1000, mm.pfosten_breite / 1000), gestell);
      p.position.set(x + 0.08, mm.pfosten_hoehe / 2000, s * (B / 2 + 0.185 - mm.pfosten_breite / 2000));
      group.add(p);
    }
    const welle = new THREE.Mesh(new THREE.CylinderGeometry(0.0905, 0.0905, B + 0.15, 20).rotateX(Math.PI / 2), matte(0xc9cdd0, 0.35, 0.5));
    welle.position.set(x + 0.08, mm.achshoehe / 1000, 0);
    group.add(welle);
  } else { // rolltop_300 (Bank)
    const gross = L > a.bankgroessen_mm.medium.fuer_poollaenge_bis;
    const bk = gross ? a.bankgroessen_mm.large : a.bankgroessen_mm.medium;
    const hohe = bk.hoehe / 1000, tiefe = bk.tiefe / 1000, laenge = B + 0.2;
    const kleid = matte(farben.verkleidung_bank[o.verkleidung], 0.6);
    const stuetze = matte(farben.profil[o.stuetzen], 0.5, 0.2);
    const koerper = new THREE.Mesh(new THREE.BoxGeometry(tiefe, hohe - 0.04, laenge - 0.12), kleid);
    koerper.position.set(x + tiefe / 2 + 0.02, (hohe - 0.04) / 2, 0);
    group.add(koerper);
    for (const s of [-1, 1]) { // Stützen an beiden Enden
      const st = new THREE.Mesh(new THREE.BoxGeometry(tiefe + 0.02, hohe, 0.06), stuetze);
      st.position.set(x + tiefe / 2 + 0.02, hohe / 2, s * (laenge / 2 - 0.03));
      group.add(st);
    }
    const sitz = new THREE.Mesh(new THREE.BoxGeometry(tiefe + 0.02, 0.04, laenge), kleid);
    sitz.position.set(x + tiefe / 2 + 0.02, hohe - 0.02, 0);
    group.add(sitz);
    if (o.solar) { // Solarmodul auf der Sitzfläche
      const solar = new THREE.Mesh(new THREE.BoxGeometry(tiefe * 0.6, 0.008, laenge * 0.5), matte(0x1d2a44, 0.3, 0.3));
      solar.position.set(x + tiefe / 2 + 0.02, hohe + 0.004, 0);
      group.add(solar);
    }
    if (o.led) { // LED-Band unter der Sitzfläche
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.015, laenge - 0.2), new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x9fe8ff, emissiveIntensity: 1.5 }));
      led.position.set(x + 0.01, hohe - 0.07, 0);
      group.add(led);
    }
  }
  group.traverse((ob) => { if (ob.isMesh) ob.castShadow = true; });
  return group;
}

export { fmt };
