// Abdeckungen: Safty (Rollabdeckung), WaluDeck (Poolterrasse), Roll'Top 100 / 300.
// Maße, Farben und Regeln stammen aus der JSON-Datei; hier steht nur die Geometrie.
// o.oeffnung (0 = geschlossen, 1 = offen) lässt die Abdeckung auf- bzw. wegfahren.
import * as THREE from 'three';

const fmt = (z) => String(Math.round(z * 100) / 100).replace('.', ',');

/** Safty: kleinste Größe, deren Innenmaß das Becken (Länge × Breite) umfasst. */
export function saftyGroesse(a, m) {
  const g = a.groessen.filter((x) => x.innen[0] >= m.L - 1e-6 && x.innen[1] >= m.B - 1e-6)
    .sort((p, q) => p.innen[0] * p.innen[1] - q.innen[0] * q.innen[1])[0];
  return g || null;
}

/** Textur: Holzdielen, Fliesen oder Lamellen (Graustufen, wird mit der Farbe multipliziert). */
function textur(art, wdh) {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 512, 512);
  if (art === 'holz') { // Dielen mit Maserung und Stoßfugen
    for (let i = 0; i < 8; i++) {
      const y = i * 64, ton = 205 + Math.random() * 50;
      g.fillStyle = `rgb(${ton},${ton},${ton})`; g.fillRect(0, y, 512, 62);
      for (let k = 0; k < 40; k++) { g.strokeStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.05})`; g.beginPath(); const yy = y + Math.random() * 62; g.moveTo(0, yy); g.lineTo(512, yy + (Math.random() - 0.5) * 4); g.stroke(); }
      g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke();
      const stoss = (i * 173) % 400 + 60; g.beginPath(); g.moveTo(stoss, y); g.lineTo(stoss, y + 64); g.stroke();
    }
  } else if (art === 'fliese') {
    g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 4;
    for (let i = 0; i <= 2; i++) { const p = (i * 512) / 2; g.beginPath(); g.moveTo(0, p); g.lineTo(512, p); g.stroke(); g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 512); g.stroke(); }
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`; g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
  } else { // Lamellen: senkrechte Linien
    g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 3;
    for (let i = 0; i < 24; i++) { const p = (i * 512) / 24; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 512); g.stroke(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(wdh[0], wdh[1]); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/** Solarzellen: dunkelblaue Zellen mit feinen Leiterbahnen. */
let _solar = null;
function solarTextur() {
  if (_solar) return _solar;
  const c = document.createElement('canvas'); c.width = 256; c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#0d1a33'; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const gr = g.createLinearGradient(x * 64, y * 64, x * 64 + 64, y * 64 + 64); gr.addColorStop(0, '#1b2f5c'); gr.addColorStop(1, '#13234a');
    g.fillStyle = gr; g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
    g.strokeStyle = 'rgba(200,210,230,.35)'; g.lineWidth = 1;
    for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(x * 64 + 2, y * 64 + k * 16); g.lineTo(x * 64 + 62, y * 64 + k * 16); g.stroke(); }
  }
  _solar = new THREE.CanvasTexture(c); _solar.colorSpace = THREE.SRGBColorSpace; _solar.anisotropy = 8;
  return _solar;
}

const matte = (hex, r = 0.6, m = 0) => new THREE.MeshStandardMaterial({ color: hex, roughness: r, metalness: m });
const alu = () => matte(0xc9cdd0, 0.35, 0.7);
const gummi = () => matte(0x1c1f21, 0.8);

/** Modulbreiten (m) so wählen, dass sie zur Gesamtbreite passen: ECO wenige große, PREMIUM mehr kleinere Module. */
function modulBreiten(gesamt, liste, premium) {
  const erlaubt = premium ? liste.filter((b) => b <= 2.373) : liste;
  let beste = null;
  const suche = (rest, teil) => {
    if (teil.length > 8 || (beste && teil.length > beste.length + 1)) return;
    if (Math.abs(rest) < 0.06) { if (!beste || teil.length < beste.length) beste = [...teil]; return; }
    if (rest < 0) return;
    for (const b of [...erlaubt].reverse()) suche(rest - b, [...teil, b]);
  };
  suche(gesamt, []);
  if (!beste) beste = [gesamt];
  const summe = beste.reduce((x, y) => x + y, 0);
  return beste.map((b) => (b * gesamt) / summe); // auf die genaue Gesamtbreite skalieren
}

/** Rollladen-Lamellen als Instanzen (60 × 14 mm), von x0 bis x1 über die Breite "span". */
function lamellen(x0, x1, span, hex, y, solar) {
  const pitch = 0.062, n = Math.max(0, Math.floor((x1 - x0) / pitch));
  const grp = new THREE.Group();
  if (!n) return grp;
  const mat = new THREE.MeshStandardMaterial({ color: hex, roughness: solar ? 0.25 : 0.5, metalness: solar ? 0.1 : 0 });
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.058, 0.014, span), mat, n);
  const o = new THREE.Object3D();
  for (let i = 0; i < n; i++) { o.position.set(x0 + pitch * (i + 0.5), y, 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix); }
  const kappe = new THREE.InstancedMesh(new THREE.BoxGeometry(0.056, 0.016, 0.02), matte(solar ? 0x111111 : 0xf3f3f1, 0.6), n * 2);
  for (let i = 0; i < n; i++) for (const s of [-1, 1]) { o.position.set(x0 + pitch * (i + 0.5), y, s * (span / 2 + 0.008)); o.updateMatrix(); kappe.setMatrixAt(i * 2 + (s > 0 ? 1 : 0), o.matrix); }
  im.castShadow = true;
  grp.add(im, kappe);
  return grp;
}

/** Aufgerollter Lamellenwickel (Radius aus der Datentabelle je Beckenlänge). */
function wickelRadius(a, L, oeffnung) {
  const tab = a.aufrolldurchmesser_mm || {};
  const key = String(Math.min(13, Math.max(5, Math.round(L))));
  const dMax = (tab[key] ?? 400) / 2000;
  return THREE.MathUtils.lerp(0.0905, dMax, oeffnung);
}

/**
 * Baut die Abdeckung.
 * m: Beckenmaße, rand: Breite der Umrandung (m), o: Auswahl (je nach Typ, inkl. oeffnung), farben: Farbtabellen
 */
export function baueAbdeckung(a, m, rand, o, farben) {
  const group = new THREE.Group();
  const { L, B } = m;
  const t = THREE.MathUtils.clamp(o.oeffnung ?? 0, 0, 1);

  // ---------- Safty: Aluprofile Ø 44 mm mit PVC-Gewebe, Handkurbel ----------
  if (a.id === 'safty_individual') {
    const g = saftyGroesse(a, m);
    const [al, ab] = g.aussen;
    const xEnde = al / 2;                                              // Wickelwelle am Ende x+
    const x0 = -al / 2 + al * t;                                       // Anfang der noch ausgerollten Bahn
    const laenge = xEnde - x0;
    const gewebe = new THREE.MeshStandardMaterial({ color: 0x7c8286, roughness: 0.85, side: THREE.DoubleSide });
    if (laenge > 0.02) {
      const bahn = new THREE.Mesh(new THREE.PlaneGeometry(laenge, ab).rotateX(-Math.PI / 2), gewebe);
      bahn.position.set((x0 + xEnde) / 2, 0.035, 0); group.add(bahn);
      for (let x = x0 + 0.25; x < xEnde - 0.05; x += 0.5) { // Aluprofile quer
        const r = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, ab - 0.04, 12).rotateX(Math.PI / 2), alu());
        r.position.set(x, 0.05, 0); group.add(r);
      }
      for (const s of [-1, 1]) { // umlaufender Randgurt mit Ösen
        const gurt = new THREE.Mesh(new THREE.BoxGeometry(laenge, 0.004, 0.06), matte(0x33383b, 0.9)); gurt.position.set((x0 + xEnde) / 2, 0.037, s * (ab / 2 - 0.03)); group.add(gurt);
        for (let x = x0 + 0.3; x < xEnde - 0.1; x += 0.6) { const oese = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.004, 6, 12).rotateX(Math.PI / 2), alu()); oese.position.set(x, 0.041, s * (ab / 2 - 0.03)); group.add(oese); }
      }
    }
    const rr = 0.06 + 0.12 * t;                                        // Wickel wächst beim Aufrollen
    const wickel = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, ab - 0.02, 28).rotateX(Math.PI / 2), gewebe);
    wickel.position.set(xEnde + rr + 0.02, rr + 0.01, 0); group.add(wickel);
    const kern = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, ab + 0.12, 14).rotateX(Math.PI / 2), alu());
    kern.position.copy(wickel.position); group.add(kern);
    // Lagerböcke und Handkurbel
    for (const s of [-1, 1]) { const bock = new THREE.Mesh(new THREE.BoxGeometry(0.1, rr * 2 + 0.04, 0.03), alu()); bock.position.set(xEnde + rr + 0.02, rr + 0.01, s * (ab / 2 + 0.05)); group.add(bock); }
    const kurbel = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 8), alu()); arm.position.y = 0.11;
    const griff = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.1, 10).rotateX(Math.PI / 2), gummi()); griff.position.set(0, 0.22, 0.05);
    kurbel.add(arm, griff); kurbel.position.set(xEnde + rr + 0.02, rr + 0.01, ab / 2 + 0.13); group.add(kurbel);
    group.traverse((ob) => { if (ob.isMesh) ob.castShadow = true; });
    return group;
  }

  // ---------- WaluDeck: begehbare Terrasse auf Alu-Schienen, erhöht über dem Boden ----------
  if (a.id === 'waludeck_origin') {
    const tk = a.technik;
    const quer = o.ausfuehrung === 'C' || o.ausfuehrung === 'D';       // Schienen an den Breitseiten
    const zweiteilig = o.ausfuehrung === 'B' || o.ausfuehrung === 'D';
    const premium = o.version === 'premium';
    const ueber = quer ? tk.terrasse_ueber_pool_m.breitenschienen : tk.terrasse_ueber_pool_m.laengsschienen;
    // Richtung entlang der Schienen (fährt) und quer dazu (Modullänge zwischen den Schienen)
    const entlang = (quer ? B : L) + ueber.entlang, spann = (quer ? L : B) + ueber.quer;
    const tm2 = spann > tk.modul_tm1_bis_laenge_m + 1e-6;
    const modul = tm2 ? 'TM2' : 'TM1';
    const bodenabstand = tk.bodenabstand_mm.mittel / 1000, rahmenOben = tk.gesamthoehe_mm[modul].mittel / 1000;
    const belag = tk.belag_dicke_m, oben = rahmenOben + belag, dicke = oben - bodenabstand;
    const hex = farben.terrasse[o.verkleidung].hex;
    const art = o.verkleidung === 'holz' ? 'holz' : 'fliese';
    const breiten = modulBreiten(entlang, tk.modulbreiten_m, premium);
    // Einheiten: eine oder zwei Terrassenhälften
    const haelften = zweiteilig && breiten.length > 1 ? [breiten.slice(0, Math.ceil(breiten.length / 2)), breiten.slice(Math.ceil(breiten.length / 2))] : [breiten];
    const verfahr = zweiteilig ? entlang * 0.5 : entlang;              // Fahrweg je Einheit
    const dirs = zweiteilig ? [-1, 1] : [1];
    const rollenMat = matte(0xf2f2f2, 0.5);
    let start = -entlang / 2;
    haelften.forEach((bs, hi) => {
      const breite = bs.reduce((x, y) => x + y, 0);
      const einheit = new THREE.Group();
      // Belag (frei wählbar: Holz/Feinsteinzeug) als durchgehende Verkleidung
      const oberMat = new THREE.MeshStandardMaterial({ color: hex, roughness: art === 'holz' ? 0.6 : 0.45, map: textur(art, art === 'holz' ? [spann / 1.2, breite / 0.6] : [spann / 0.9, breite / 0.9]) });
      const kante = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex).multiplyScalar(0.8), roughness: 0.7 });
      const platte = new THREE.Mesh(new THREE.BoxGeometry(spann, belag, breite), [kante, kante, oberMat, kante, kante, kante]);
      platte.position.set(0, oben - belag / 2, 0);
      // Seitenverkleidung bis zum Rahmen (Zarge) und Alu-Rahmen darunter
      const zarge = new THREE.Mesh(new THREE.BoxGeometry(spann - 0.04, rahmenOben - bodenabstand - 0.02, breite - 0.04), kante);
      zarge.position.set(0, (rahmenOben + bodenabstand) / 2 - 0.01, 0);
      const rahmen = new THREE.Mesh(new THREE.BoxGeometry(spann - 0.02, 0.04, breite - 0.02), alu()); rahmen.position.set(0, bodenabstand + 0.02, 0);
      einheit.add(platte, zarge, rahmen);
      // Modulfugen im Rahmen (dunkle Linien an der Unterkante)
      let pos = -breite / 2;
      bs.forEach((b, i) => { pos += b; if (i < bs.length - 1) { const fuge = new THREE.Mesh(new THREE.BoxGeometry(spann - 0.03, 0.03, 0.006), gummi()); fuge.position.set(0, bodenabstand + 0.03, pos); einheit.add(fuge); } });
      // Laufrollen (4 je Modul) auf den Schienen
      pos = -breite / 2;
      bs.forEach((b) => {
        for (const sa of [-1, 1]) for (const sb of [0.2, 0.8]) {
          const r = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.025, 14).rotateX(Math.PI / 2), rollenMat);
          r.position.set(sa * (spann / 2 - 0.04), 0.03, pos + b * sb); einheit.add(r);
        }
        pos += b;
      });
      // Führungsgriff (gebogenes Rohr) an der Terrassenkante
      const pfad = new THREE.CurvePath();
      const P = (x, y, z) => new THREE.Vector3(x, y, z);
      pfad.add(new THREE.LineCurve3(P(0, oben, 0), P(0, oben + 0.25, 0)));
      pfad.add(new THREE.LineCurve3(P(0, oben + 0.25, 0), P(0.12, oben + 0.62, 0)));
      const griff = new THREE.Mesh(new THREE.TubeGeometry(pfad, 20, 0.014, 8), alu());
      griff.position.set(spann / 2 - 0.25, 0, breite * (zweiteilig ? (hi ? -0.3 : 0.3) : 0.3)); einheit.add(griff);
      // Abschlussleiste (Option) und Motor (Option)
      if (o.opt?.abschlussleiste_alu) { const leiste = new THREE.Mesh(new THREE.BoxGeometry(spann + 0.02, 0.012, 0.02), alu()); leiste.position.set(0, oben + 0.004, breite / 2 - 0.01); einheit.add(leiste); }
      if (o.opt?.motorisierung) { const motor = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.2), alu()); motor.position.set(-spann / 2 + 0.2, bodenabstand + 0.15, -breite / 2 + 0.2); einheit.add(motor); }
      // Position: Einheit sitzt über dem Becken und fährt beim Öffnen entlang der Schienen
      const mitte = start + breite / 2; start += breite;
      const lage = zweiteilig ? mitte + dirs[hi] * verfahr * t : mitte + dirs[0] * verfahr * t;
      // Lokal: x = Richtung zwischen den Schienen (Modullänge), z = Richtung entlang der Schienen (Modulbreiten)
      if (quer) einheit.position.set(0, 0, lage);                      // Schienen an den Breitseiten: Fahrt entlang z
      else { einheit.rotation.y = Math.PI / 2; einheit.position.set(lage, 0, 0); } // Längsschienen: Fahrt entlang x
      group.add(einheit);
    });
    // Schienen (70 × 18,9 mm, gewölbt) mit Auslauf für die Fahrt
    const lang = entlang * 2;
    const versatz = zweiteilig ? 0 : entlang / 2;
    for (const s of [-1, 1]) {
      const sch = new THREE.Group();
      const basis = new THREE.Mesh(new THREE.BoxGeometry(lang, 0.012, 0.07), alu()); basis.position.y = 0.006;
      const wolbung = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, lang, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 0.55, 1), alu()); wolbung.position.y = 0.012;
      sch.add(basis, wolbung);
      if (quer) { sch.rotation.y = Math.PI / 2; sch.position.set(s * (spann / 2 - 0.04), 0, versatz); } else { sch.position.set(versatz, 0, s * (spann / 2 - 0.04)); }
      group.add(sch);
    }
    group.traverse((ob) => { if (ob.isMesh) ob.castShadow = true; });
    return group;
  }

  // ---------- Roll'Top 100 und 300: Lamellen auf Wickelwelle ----------
  const lamHex = farben.lamellen[o.lamellen];
  const solarLamelle = o.lamellen.startsWith('solar');
  const x = L / 2 + rand;                                              // Wickelwelle / Bank am Beckenende (x+)
  const span = B - 0.05;
  const rr = wickelRadius(a, L, t);

  if (a.id === 'rolltop_100') {
    const gestell = matte(farben.profil[o.gestell], 0.45, 0.25);
    const mm = a.masse_mm;
    const px = x + 0.08, wy = mm.achshoehe / 1000;
    for (const s of [-1, 1]) {                                         // Pfosten + Motorgehäuse + Lager
      const p = new THREE.Mesh(new THREE.BoxGeometry(mm.pfosten_tiefe / 1000, mm.pfosten_hoehe / 1000, mm.pfosten_breite / 1000), gestell);
      p.position.set(px, mm.pfosten_hoehe / 2000, s * (B / 2 + 0.185 - mm.pfosten_breite / 2000)); group.add(p);
      const lager = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 16).rotateX(Math.PI / 2), alu());
      lager.position.set(px - 0.065, wy, s * (B / 2 + 0.185 - mm.pfosten_breite / 2000 - (s > 0 ? -0.0 : 0.0))); group.add(lager);
    }
    const welle = new THREE.Mesh(new THREE.CylinderGeometry(0.0905, 0.0905, B + 0.15, 28).rotateX(Math.PI / 2), alu());
    welle.position.set(px - 0.065, wy, 0); group.add(welle);
    if (rr > 0.095) { // aufgewickelte Lamellen
      const wickel = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, span, 32).rotateX(Math.PI / 2), matte(lamHex, 0.5)); wickel.position.copy(welle.position); group.add(wickel);
    }
    const motor = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.2), gestell); motor.position.set(px, 0.1, -(B / 2 + 0.185 - 0.105) - 0.0); group.add(motor);
    group.add(lamellen(-L / 2 + L * t, L / 2 - 0.02, span, lamHex, 0.025, solarLamelle));
  } else { // rolltop_300 (Bank)
    const gross = L > a.bankgroessen_mm.medium.fuer_poollaenge_bis;
    const bk = gross ? a.bankgroessen_mm.large : a.bankgroessen_mm.medium;
    const hohe = bk.hoehe / 1000, tiefe = bk.tiefe / 1000, laenge = B + 0.2;
    const kleidHex = farben.verkleidung_bank[o.verkleidung];
    const kleid = new THREE.MeshStandardMaterial({ color: kleidHex, roughness: 0.6, map: o.verkleidung === 'holzoptik' ? textur('holz', [1, 1]) : null });
    const stuetze = matte(farben.profil[o.stuetzen], 0.45, 0.2);
    const bx = x + tiefe / 2 + 0.02;
    // Körper mit Verkleidungsmodulen: senkrechte Latten vorn/hinten, Fugen alle 0,6 m
    const koerper = new THREE.Mesh(new THREE.BoxGeometry(tiefe, hohe - 0.08, laenge - 0.14), matte(0x2b2f32, 0.8)); koerper.position.set(bx, hohe / 2 - 0.02, 0); group.add(koerper);
    const latten = Math.round((laenge - 0.2) / 0.06);
    for (const sx of [-1, 1]) {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.012, hohe - 0.1, 0.054), kleid, latten);
      const ob = new THREE.Object3D();
      for (let i = 0; i < latten; i++) { ob.position.set(bx + sx * (tiefe / 2 + 0.004), hohe / 2 - 0.02, -(laenge - 0.2) / 2 + i * 0.06 + 0.03); ob.updateMatrix(); im.setMatrixAt(i, ob.matrix); }
      group.add(im);
    }
    for (const s of [-1, 1]) { // Stützen (Pfosten) an beiden Enden
      const st = new THREE.Mesh(new THREE.BoxGeometry(tiefe + 0.03, hohe, 0.07), stuetze); st.position.set(bx, hohe / 2, s * (laenge / 2 - 0.035)); group.add(st);
    }
    const sitz = new THREE.Mesh(new THREE.BoxGeometry(tiefe + 0.03, 0.04, laenge), kleid); sitz.position.set(bx, hohe - 0.02, 0); group.add(sitz);
    const schlitz = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, laenge - 0.18), matte(0x050505, 1)); schlitz.position.set(bx - tiefe / 2 - 0.004, 0.02, 0); group.add(schlitz); // Austritt der Lamellen
    if (o.solar) { // kleines Modul, bündig in die Sitzfläche eingelassen, an einem Ende der Bank (nach den Datenblatt-Fotos)
      const sm = a.solarmodul ?? { laenge_m: 0.42, tiefe_anteil: 0.62, abstand_ende_m: 0.12, rahmen_m: 0.012 };
      const sl = sm.laenge_m, st = tiefe * sm.tiefe_anteil, z = -laenge / 2 + 0.07 + sm.abstand_ende_m + sl / 2;
      const rahmen = new THREE.Mesh(new THREE.BoxGeometry(st + 2 * sm.rahmen_m, 0.006, sl + 2 * sm.rahmen_m), matte(0x2b2f33, 0.4, 0.6));
      rahmen.position.set(bx, hohe + 0.0005, z);
      const zellen = new THREE.Mesh(new THREE.PlaneGeometry(st, sl).rotateX(-Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: solarTextur(), roughness: 0.18, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }));
      zellen.position.set(bx, hohe + 0.0036, z);
      group.add(rahmen, zellen);
    }
    if (o.led) { const led = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.015, laenge - 0.2), new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x9fe8ff, emissiveIntensity: 1.5 })); led.position.set(bx - tiefe / 2 - 0.006, hohe - 0.07, 0); group.add(led); }
    group.add(lamellen(-L / 2 + L * t, L / 2 - 0.02, span, lamHex, 0.025, solarLamelle));
  }
  group.traverse((ob) => { if (ob.isMesh) ob.castShadow = true; });
  return group;
}

export { fmt };
