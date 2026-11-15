// poolmaris 3D-Pool-Konfigurator – Phase 3 (alle Pools, Umrandung, Zubehör, Überdachung, Abdeckung)
// Läuft komplett lokal: lädt nur ../daten/poolmaris-konfiguration.json und lib/three*.js.
import * as THREE from 'three';
import { OrbitControls } from './lib/OrbitControls.js';
import { buildPool, masse, umrissPunkte, flaecheGeo, skimmerAnzahl } from './pool.js';
import { baueKoerper } from './koerper.js';
import { schnittPosition, schnittEbene, baueSchnittflaeche } from './schnitt.js';
import { baueUmrandung, steinMasse } from './umrandung.js';
import { baueUeberdachung, waehleGroesse } from './ueberdachung.js';
import { baueAbdeckung, saftyGroesse } from './abdeckung.js';
import { speichereDatei, dateiname, exportiereGLB, konfigAlsText, konfigLesen } from './export.js';
import { umrandungStatus, ueberdachungStatus, abdeckungStatus, ausfuehrungStatus, ledListe, skimmerStatus } from './regeln.js';

const DATEN_URL = '../daten/poolmaris-konfiguration.json';
const $ = (id) => document.getElementById(id);
const komma = (z) => String(Math.round(z * 100) / 100).replace('.', ',');

// ---------- Renderer, Szene, Kamera ----------
const canvas = $('ansicht');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.shadowMap.enabled = true;
renderer.localClippingEnabled = true; // Schnittebene für den Querschnitt
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfdcf0);
scene.fog = new THREE.Fog(0xbfdcf0, 40, 120);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 300);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.03; // nicht unter den Rasen schauen
controls.minDistance = 0.6; // nah heranzoomen (z. B. für den Schnitt)
controls.maxDistance = 45;
controls.target.set(0, -0.3, 0);

scene.add(new THREE.HemisphereLight(0xdcecff, 0x6f8a4a, 1.0));
const sonne = new THREE.DirectionalLight(0xfff2dd, 2.6);
sonne.position.set(8, 14, 6);
sonne.castShadow = true;
sonne.shadow.camera.left = sonne.shadow.camera.bottom = -10;
sonne.shadow.camera.right = sonne.shadow.camera.top = 10;
sonne.shadow.camera.far = 45;
scene.add(sonne);

// ---------- Rasen mit Loch für das Becken ----------
function rasenTextur() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#5c8f3a'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `hsl(${88 + Math.random() * 20} ${40 + Math.random() * 20}% ${28 + Math.random() * 16}%)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const rasenMat = new THREE.MeshStandardMaterial({ map: rasenTextur(), roughness: 1 });
const untergrundMat = new THREE.MeshStandardMaterial({ color: 0x8a8d8f, roughness: 1 });
let boden = null; // Gruppe aus Rasen + Untergrund unter der Umrandung
function baueBoden(m, off) { // m.T = Beckentiefe
  if (boden) { scene.remove(boden); boden.traverse((o) => o.geometry && o.geometry.dispose()); }
  boden = new THREE.Group();
  if (zustand.umgebung === 'frei') { // freies Modell: nur ein weicher Schatten auf neutralem Grund, kein Rasen
    const schatten = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.22 }));
    schatten.position.y = -m.T - 0.3; schatten.receiveShadow = true;
    boden.add(schatten); scene.add(boden);
    return;
  }
  const gross = 120;
  const aussen = [new THREE.Vector2(-gross, -gross), new THREE.Vector2(gross, -gross), new THREE.Vector2(gross, gross), new THREE.Vector2(-gross, gross)];
  const geo = new THREE.ShapeGeometry(flaecheGeo(aussen, [umrissPunkte(m, off)])).rotateX(-Math.PI / 2);
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 2, p.getZ(i) / 2); // eine Textur-Kachel = 2 m
  const rasen = new THREE.Mesh(geo, rasenMat);
  rasen.position.y = -0.002; rasen.receiveShadow = true;
  const unter = new THREE.Mesh(new THREE.ShapeGeometry(flaecheGeo(umrissPunkte(m, off), [umrissPunkte(m, 0)])).rotateX(-Math.PI / 2), untergrundMat);
  unter.position.y = -0.01;
  boden.add(rasen, unter);
  scene.add(boden);
}

// ---------- Qualitätsstufen ----------
const QUALITAET = {
  niedrig: { pixel: 0.75, schatten: false, schattenGroesse: 512 },
  mittel: { pixel: 1, schatten: true, schattenGroesse: 1024 },
  hoch: { pixel: Math.min(window.devicePixelRatio || 1, 2), schatten: true, schattenGroesse: 2048 },
};
let qualitaet = 'mittel';
function setzeQualitaet(name) {
  qualitaet = name;
  const q = QUALITAET[name];
  renderer.setPixelRatio(q.pixel);
  renderer.shadowMap.enabled = q.schatten;
  sonne.castShadow = q.schatten;
  sonne.shadow.mapSize.set(q.schattenGroesse, q.schattenGroesse);
  if (sonne.shadow.map) { sonne.shadow.map.dispose(); sonne.shadow.map = null; }
  scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((mt) => { mt.needsUpdate = true; }); });
  groesseAnpassen();
}

// ---------- Rendern nur bei Bedarf (schont den Laptop-Akku) ----------
let brauchtRender = true;
const rendern = () => { brauchtRender = true; };
controls.addEventListener('change', rendern);
function groesseAnpassen() {
  const r = canvas.parentElement.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(r.height, 1);
  camera.updateProjectionMatrix();
  rendern();
}
window.addEventListener('resize', groesseAnpassen);
renderer.setAnimationLoop(() => {
  if (controls.update()) brauchtRender = true;
  if (brauchtRender) { renderer.render(scene, camera); brauchtRender = false; }
});

// ---------- Zustand ----------
let daten = null;
const zustand = {
  poolId: 'systemsteinpool', groesseIdx: 0, farbe: 'blau', oberflaeche: 'glatt',
  einstieg: 'edelstahlleiter_v2a', seite: 'links',
  umrandung: '', umrandungFarbe: '',
  led: '', ledAnzahl: 2, ledSeite: 'lang_a', ledLage: 0.5, // Beleuchtung meist an einer Seite, Lage verschiebbar
  schnitt: 'aus', schnittLage: 0.5, // 'aus' | 'quer' | 'laengs'
  premiumSkimmer: false, skimmerFarbe: 'weiss',
  ueberdachung: '', ueProfil: '', ueSchiene: 'links', ueOffen: false,
  abdeckung: '', ab: {},
  umgebung: 'rasen', // 'rasen' (Garten) oder 'frei' (freies 3D-Modell ohne Rasen)
  projekt: '', // optionaler Projektname für die Zusammenfassung (bleibt lokal)
};
let meldung = '';
let meldungKorrektur = ''; // Hinweis, wenn beim Laden Auswahl korrigiert wurde
const szene = { pool: null, rand: null, ue: null, ab: null, sockel: null, kappe: null }; // aktuell sichtbare Gruppen

const VOLLE_BREITE = ['stufen_volle_breite', 'durchgehende_treppe', 'stufenanlage'];
const poolDaten = () => daten.pools.find((p) => p.id === zustand.poolId);
const name = (id) => daten.bezeichnungen[id] || id;
const hexVon = (id) => {
  const f = daten.farben_3d;
  return f.umrandung[id] || f.profil[id] || f.lamellen[id] || f.verkleidung_bank[id] || '#cccccc';
};

// ---------- Gültigkeit prüfen: ungültige Auswahl zurücksetzen und erklären ----------
function pruefe() {
  const hinweise = [];
  const pool = poolDaten();
  const g = pool.groessen[zustand.groesseIdx];
  const m = masse(pool, g);
  const farben = pool.folienfarben || pool.plattenfarben;
  if (!farben.includes(zustand.farbe)) zustand.farbe = farben[0];
  if (pool.oberflaechen && !pool.oberflaechen.includes(zustand.oberflaeche)) zustand.oberflaeche = pool.oberflaechen[0];
  if (![pool.einstieg.standard, ...pool.einstieg.alternativen].includes(zustand.einstieg)) zustand.einstieg = pool.einstieg.standard;

  if (zustand.umrandung) {
    const u = daten.umrandungen.find((x) => x.id === zustand.umrandung);
    const st = umrandungStatus(u, pool, m);
    if (!st.ok) { hinweise.push(`Umrandung entfernt: ${st.grund}`); zustand.umrandung = ''; }
    else if (!u.farben.some((f) => (f.id || f) === zustand.umrandungFarbe)) zustand.umrandungFarbe = u.farben[0].id || u.farben[0];
  }
  const rand = zustand.umrandung ? steinMasse(daten.umrandungen.find((x) => x.id === zustand.umrandung)).b : 0;

  const { liste } = ledListe(daten, pool);
  if (zustand.led && !liste.some((l) => l.id === zustand.led)) zustand.led = '';
  if (zustand.premiumSkimmer && !skimmerStatus(daten, pool).ok) zustand.premiumSkimmer = false;
  if (zustand.ledSeite === 'kurz_einstieg' && VOLLE_BREITE.includes(zustand.einstieg)) zustand.ledSeite = 'lang_a'; // dort liegen die Stufen
  if (zustand.schnitt !== 'aus') {
    if (!pool.aufbau) { hinweise.push('Schnitt ausgeschaltet: Den gibt es nur bei Systemstein-, Kompakt- und Polypropylen-Becken.'); zustand.schnitt = 'aus'; }
    else zustand.umgebung = 'frei'; // der Schnitt braucht das freie Modell
  }

  if (zustand.ueberdachung) {
    const u = daten.ueberdachungen.find((x) => x.id === zustand.ueberdachung);
    const st = ueberdachungStatus(u, pool, m, rand);
    if (!st.ok) { hinweise.push(`${u.name} entfernt: ${st.grund}`); zustand.ueberdachung = ''; }
    else {
      const pf = u.profilfarben || (u.profilfarbe ? [u.profilfarbe] : ['anthrazit']);
      if (!pf.includes(zustand.ueProfil)) zustand.ueProfil = pf[0];
    }
  }
  if (zustand.abdeckung) {
    const a = daten.abdeckungen.find((x) => x.id === zustand.abdeckung);
    const st = abdeckungStatus(a, pool, m);
    if (!st.ok) { hinweise.push(`${a.name} entfernt: ${st.grund}`); zustand.abdeckung = ''; }
    else abdeckungOptionenNormalisieren(a, m);
  }
  meldung = hinweise.join(' ');
  meldungKorrektur = meldung;
  return { pool, m, rand };
}

/** Standardwerte und Regeln für die gewählte Abdeckung. */
function abdeckungOptionenNormalisieren(a, m) {
  const o = zustand.ab;
  const wahl = (key, liste) => { if (!liste.includes(o[key])) o[key] = liste[0]; };
  o.opt = o.opt || {};
  if (a.id === 'waludeck_origin') {
    wahl('version', a.versionen);
    wahl('verkleidung', a.verkleidungen);
    const erlaubt = Object.keys(a.ausfuehrungen).filter((k) => ausfuehrungStatus(a, k, m).ok);
    wahl('ausfuehrung', erlaubt);
  }
  if (a.id === 'rolltop_100') {
    wahl('gestell', a.gestellfarben);
    wahl('lamellen', [...a.lamellen.pvc, ...a.lamellen.pc]);
  }
  if (a.id === 'rolltop_300') {
    wahl('variante', a.varianten);
    wahl('verkleidung', a.verkleidungsfarben);
    wahl('stuetzen', a.stuetzenfarben);
    wahl('lamellen', [...a.lamellen.pvc, ...a.lamellen.pc]);
    if (a.solar_varianten.includes(o.variante)) a.nicht_bei_solar.forEach((k) => { o.opt[k] = false; });
  }
}

// ---------- 3D-Szene aufbauen ----------
function leereGruppe(g) {
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) [].concat(o.material).forEach((mt) => { if (mt.map) mt.map.dispose(); mt.dispose(); });
  });
}
function ersetze(schluessel, gruppe) {
  if (szene[schluessel]) { scene.remove(szene[schluessel]); leereGruppe(szene[schluessel]); }
  szene[schluessel] = gruppe || null;
  if (gruppe) scene.add(gruppe);
}

function neuBauen(kameraZuruecksetzen = false, panelNeuZeichnen = true) {
  const { pool, m, rand } = pruefe();
  const g = pool.groessen[zustand.groesseIdx];
  const istPP = pool.id === 'pp_pool';
  const wandHex = istPP ? daten.farben_3d.pp_platten[zustand.farbe].hex : daten.farben_3d.folie[zustand.farbe].hex;
  const ws = -(zustand.premiumSkimmer ? daten.zubehoer.premium_skimmer.wasserstand_unter_kante_cm : daten.zubehoer.standard_skimmer.wasserstand_unter_kante_cm) / 100;
  const wasserHex = (istPP ? daten.farben_3d.pp_platten : daten.farben_3d.folie)[zustand.farbe].wasser_hex;
  const led = zustand.led ? ledListe(daten, pool).liste.find((l) => l.id === zustand.led) : null;

  ersetze('pool', buildPool({
    pool, groesse: g, wandHex, rauigkeit: istPP ? (zustand.oberflaeche === 'genarbt' ? 0.9 : 0.3) : 0.55,
    einstieg: zustand.einstieg, seite: zustand.seite, richtwerte: daten.treppen._richtwerte,
    einbauHex: daten.farben_3d.einbauteile.weiss.hex, mitRand: !zustand.umrandung,
    skimmerAnzahl: skimmerAnzahl(m, daten.skimmer_regel),
    // Premium Skimmer: Wasser 5,5 cm unter der Kante (Datenblatt); Standard-Skimmer sitzt tiefer
    wasserstand: ws, wasserHex,
    premiumSkimmer: zustand.premiumSkimmer ? { hex: hexVon(zustand.skimmerFarbe) } : null,
    led: led ? { hex: daten.farben_3d.led[led.farbe], anzahl: zustand.ledAnzahl, seite: zustand.ledSeite, lage: zustand.ledLage } : null,
  }));

  if (zustand.umrandung) {
    const u = daten.umrandungen.find((x) => x.id === zustand.umrandung);
    ersetze('rand', baueUmrandung(pool, g, u, hexVon(zustand.umrandungFarbe)).group);
  } else ersetze('rand', null);
  const frei = zustand.umgebung === 'frei';
  ersetze('sockel', frei ? baueKoerper(m, pool.aufbau, rand || 0.12) : null);
  scene.background = new THREE.Color(frei ? 0xe6eaed : 0xbfdcf0);
  scene.fog = frei ? null : new THREE.Fog(0xbfdcf0, 40, 120);
  controls.maxPolarAngle = frei ? Math.PI - 0.05 : Math.PI / 2 - 0.03; // frei: auch von unten ansehbar
  baueBoden(m, rand || 0.12);

  if (zustand.ueberdachung) {
    const u = daten.ueberdachungen.find((x) => x.id === zustand.ueberdachung);
    const gr = waehleGroesse(u, m, rand).groesse;
    ersetze('ue', baueUeberdachung(u, gr, { profilHex: hexVon(zustand.ueProfil), schiene: zustand.ueSchiene, offen: zustand.ueOffen }));
  } else ersetze('ue', null);

  if (zustand.abdeckung) {
    const a = daten.abdeckungen.find((x) => x.id === zustand.abdeckung);
    const o = { ...zustand.ab, solar: !!a.solar_varianten?.includes(zustand.ab.variante), led: !!zustand.ab.opt?.led_beleuchtung };
    ersetze('ab', baueAbdeckung(a, m, rand || 0.12, o, {
      terrasse: daten.farben_3d.terrasse, lamellen: Object.fromEntries(Object.entries(daten.farben_3d.lamellen)),
      profil: daten.farben_3d.profil, verkleidung_bank: daten.farben_3d.verkleidung_bank,
    }));
  } else ersetze('ab', null);

  // Schnitt: Schnittebene auf alle Teile, Schnittfläche mit den Schichten; Überdachung/Abdeckung ausblenden
  const schnittAktiv = zustand.schnitt !== 'aus';
  let ebene = null, lage = 0;
  if (schnittAktiv) {
    lage = schnittPosition(m, zustand.schnitt, zustand.schnittLage);
    ebene = schnittEbene(zustand.schnitt, lage);
    ersetze('kappe', baueSchnittflaeche(m, pool.aufbau, zustand.schnitt, lage, { wandHex, wasserHex, ws }));
  } else ersetze('kappe', null);
  for (const k of ['pool', 'rand', 'sockel']) {
    szene[k]?.traverse((o) => { if (o.material) [].concat(o.material).forEach((mt) => { mt.clippingPlanes = ebene ? [ebene] : null; mt.needsUpdate = true; }); });
  }
  if (szene.ue) szene.ue.visible = !schnittAktiv;
  if (szene.ab) szene.ab.visible = !schnittAktiv;
  schnittKamera = schnittAktiv ? { m, lage } : null;

  if (kameraZuruecksetzen) {
    const dist = Math.max(m.L, m.B) * 1.5 + 2;
    camera.position.set(-dist * 0.55, dist * 0.55, dist * 0.8);
    controls.target.set(0, -0.3, 0);
    controls.update();
  }
  if (panelNeuZeichnen) zeichnePanel();
  rendern();
}

let schnittKamera = null; // merkt Maße/Lage des aktiven Schnitts für die Kamera
/** Stellt die Kamera schräg vor die Schnittfläche. */
function kameraAufSchnitt() {
  if (!schnittKamera) return;
  const { m, lage } = schnittKamera, d = Math.max(m.L, m.B) * 0.9 + 2;
  if (zustand.schnitt === 'quer') { camera.position.set(lage + d * 0.8, d * 0.35, d * 0.45); controls.target.set(lage, -m.T / 2, 0); }
  else { camera.position.set(d * 0.45, d * 0.35, lage + d * 0.8); controls.target.set(0, -m.T / 2, lage); }
  controls.update(); rendern();
}

const beckenText = (pool, x) => pool.form === 'rund' ? `Ø ${komma(x.durchmesser)} × ${komma(x.tiefe)} m`
  : `${komma(x.laenge)} × ${komma(x.breite)} × ${komma(x.tiefe)} m${x.name ? ` (${x.name})` : ''}`;

// ---------- Bedienfeld (wird aus Daten + Regeln erzeugt) ----------
const el = (tag, attr = {}, ...kinder) => {
  const e = Object.assign(document.createElement(tag), attr);
  kinder.flat(Infinity).forEach((k) => e.append(k));
  return e;
};
const abschnitt = (titel, ...inhalt) => el('section', {}, el('h2', { textContent: titel }), ...inhalt);

/** Auswahlliste. optionen: [{ wert, text, ok, grund }]. Nicht erlaubte Einträge sind ausgegraut + erklärt. */
function auswahl(label, optionen, wert, onChange) {
  const id = 'sel-' + label.replace(/\W/g, '');
  const sel = el('select', { id });
  optionen.forEach((o) => {
    const opt = new Option(o.ok === false ? `${o.text} – nicht möglich` : o.text, o.wert);
    opt.disabled = o.ok === false;
    sel.add(opt);
  });
  sel.value = wert;
  sel.addEventListener('change', () => onChange(sel.value));
  // Gleiche Gründe zusammenfassen: "A, B, C: Grund"
  const gruppen = new Map();
  optionen.filter((o) => o.ok === false && o.grund).forEach((o) => gruppen.set(o.grund, [...(gruppen.get(o.grund) || []), o.text]));
  return el('div', {}, el('label', { htmlFor: id, textContent: label }), sel,
    gruppen.size ? el('ul', { className: 'gruende' }, [...gruppen].map(([grund, texte]) => el('li', { textContent: `${texte.join(', ')}: ${grund}` }))) : '');
}
/** Schieberegler: beim Ziehen wird nur das Modell aktualisiert, erst beim Loslassen das Bedienfeld. */
function regler(label, wert, min, max, schritt, onWert) {
  const id = 'reg-' + label.replace(/\W/g, '');
  const r = el('input', { type: 'range', id, min, max, step: schritt, value: wert });
  r.addEventListener('input', () => onWert(+r.value, false));
  r.addEventListener('change', () => onWert(+r.value, true));
  return el('div', {}, el('label', { htmlFor: id, textContent: label }), r);
}
const ledSeiten = (pool) => {
  const rund = pool.form === 'rund';
  return [
    { wert: 'lang_a', text: rund ? 'Seite 1' : 'Lange Seite 1' },
    { wert: 'lang_b', text: rund ? 'Seite 2' : 'Lange Seite 2' },
    { wert: 'beide', text: rund ? 'Beide Seiten' : 'Beide langen Seiten' },
    { wert: 'kurz_einstieg', text: rund ? 'Einstiegsseite' : 'Schmalseite am Einstieg', ok: !VOLLE_BREITE.includes(zustand.einstieg), grund: 'Dort liegen die Stufen über die volle Breite.' },
    { wert: 'kurz_gegenueber', text: rund ? 'Gegenüberliegende Seite' : 'Schmalseite gegenüber (Skimmer)' },
  ];
};
const hinweis = (text) => el('p', { className: 'hinweis', textContent: text });
function schalter(text, an, onChange, ok = true, grund = '') {
  const cb = el('input', { type: 'checkbox', checked: !!an, disabled: !ok });
  cb.addEventListener('change', () => onChange(cb.checked));
  return el('label', { className: 'zeile' + (ok ? '' : ' aus') }, cb, el('span', {}, text, !ok && grund ? el('span', { className: 'grund', textContent: grund }) : ''));
}
function farbknoepfe(ids, aktiv, hexFn, onWahl, nameFn = name) {
  const box = el('div', { className: 'farben klein' });
  ids.forEach((id) => {
    const b = el('button', { type: 'button', textContent: nameFn(id), title: nameFn(id) });
    b.style.background = hexFn(id);
    b.dataset.id = id;
    b.setAttribute('aria-pressed', id === aktiv);
    b.addEventListener('click', () => onWahl(id));
    box.append(b);
  });
  return box;
}
const setze = (feld, wert, neuePerspektive = false) => { zustand[feld] = wert; neuBauen(neuePerspektive); };

function zeichnePanel() {
  const panel = $('panel'), scroll = panel.scrollTop;
  const pool = poolDaten();
  const g = pool.groessen[zustand.groesseIdx];
  const m = masse(pool, g);
  const rand = zustand.umrandung ? steinMasse(daten.umrandungen.find((x) => x.id === zustand.umrandung)).b : 0;
  const istPP = pool.id === 'pp_pool';
  const root = $('optionen');
  root.replaceChildren();

  $('meldung').hidden = !meldung;
  $('meldung').textContent = meldung;

  // --- Becken ---
  const groesseText = (x) => beckenText(pool, x);
  root.append(abschnitt('Becken',
    auswahl('Beckentyp', daten.pools.map((p) => ({ wert: p.id, text: p.name })), zustand.poolId, (v) => { zustand.poolId = v; zustand.groesseIdx = 0; neuBauen(true); }),
    auswahl('Größe', pool.groessen.map((x, i) => ({ wert: i, text: groesseText(x) })), zustand.groesseIdx, (v) => setze('groesseIdx', +v, true)),
    hinweis([g.inhalt_m3 ? `ca. ${g.inhalt_m3} m³ Wasser. ` : '', pool.bauweise].join(''))));

  // --- Farbe ---
  const farbIds = pool.folienfarben || pool.plattenfarben;
  const farbTab = istPP ? daten.farben_3d.pp_platten : daten.farben_3d.folie;
  root.append(abschnitt(istPP ? 'Plattenfarbe' : 'Folienfarbe',
    farbknoepfe(farbIds, zustand.farbe, (id) => farbTab[id].hex, (id) => setze('farbe', id), (id) => farbTab[id].name),
    pool.oberflaechen ? auswahl('Oberfläche', pool.oberflaechen.map((o) => ({ wert: o, text: name(o) })), zustand.oberflaeche, (v) => setze('oberflaeche', v)) : ''));

  // --- Einstieg ---
  const einstiege = [pool.einstieg.standard, ...pool.einstieg.alternativen];
  const istLeiter = /leiter/.test(zustand.einstieg);
  root.append(abschnitt('Einstieg',
    auswahl('Treppe / Leiter', einstiege.map((e) => ({ wert: e, text: daten.treppen[e].name })), zustand.einstieg, (v) => setze('einstieg', v)),
    hinweis(daten.treppen[zustand.einstieg].beschreibung + (pool.einstieg.hinweis ? ` – ${pool.einstieg.hinweis}` : '')),
    !istLeiter || m.form === 'rechteck' ? auswahl('Position an der Schmalseite', [{ wert: 'links', text: 'Links' }, { wert: 'rechts', text: 'Rechts' }], zustand.seite, (v) => setze('seite', v)) : ''));

  // --- Umrandung ---
  const uOpt = daten.umrandungen.map((u) => { const st = umrandungStatus(u, pool, m); return { wert: u.id, text: u.name, ok: st.ok, grund: st.grund }; });
  const uGew = daten.umrandungen.find((u) => u.id === zustand.umrandung);
  root.append(abschnitt('Umrandung',
    auswahl('Beckenrandsteine', [{ wert: '', text: 'Ohne Umrandung (schlichte Kante)' }, ...uOpt], zustand.umrandung, (v) => {
      zustand.umrandung = v;
      if (v) { const u = daten.umrandungen.find((x) => x.id === v); zustand.umrandungFarbe = u.farben[0].id || u.farben[0]; }
      neuBauen();
    }),
    uGew ? [
      farbknoepfe(uGew.farben.map((f) => f.id || f), zustand.umrandungFarbe, hexVon, (id) => setze('umrandungFarbe', id), (id) => uGew.farben.find((f) => (f.id || f) === id).name || name(id)),
      hinweis(`${uGew.material}. Stein ${komma(steinMasse(uGew).l * 100)} × ${komma(steinMasse(uGew).b * 100)} cm.${pool.form === 'oval' ? ' Beim Ovalpool werden Radiensteine nach Angabe gefertigt.' : ''}`),
    ] : ''));

  // --- Zubehör ---
  const { liste: leds, grundNicht } = ledListe(daten, pool);
  const sk = skimmerStatus(daten, pool);
  const skz = daten.zubehoer.premium_skimmer;
  root.append(abschnitt('Zubehör',
    leds.length
      ? [auswahl('Beleuchtung', [{ wert: '', text: 'Ohne LED' }, ...leds.map((l) => ({ wert: l.id, text: l.name }))], zustand.led, (v) => setze('led', v)),
        zustand.led ? [
          auswahl('Anzahl Scheinwerfer', [1, 2, 3, 4].map((n) => ({ wert: n, text: String(n) })), zustand.ledAnzahl, (v) => setze('ledAnzahl', +v)),
          auswahl('Position der Scheinwerfer', ledSeiten(pool), zustand.ledSeite, (v) => setze('ledSeite', v)),
          regler('Lage entlang der Wand', zustand.ledLage, 0.1, 0.9, 0.05, (v, fertig) => { zustand.ledLage = v; neuBauen(false, fertig); })] : '']
      : [el('label', { textContent: 'Beleuchtung' }), el('select', { disabled: true }, new Option('Nicht verfügbar')), el('ul', { className: 'gruende' }, el('li', { textContent: grundNicht }))],
    hinweis(`${skimmerAnzahl(m, daten.skimmer_regel)} Skimmer, ${daten.skimmer_regel.position}.${skimmerAnzahl(m, daten.skimmer_regel) === 2 ? ' ' + daten.skimmer_regel.anzeige : ''}`),
    schalter('poolmaris Premium Skimmer (fast unsichtbare Öffnung)', zustand.premiumSkimmer, (v) => setze('premiumSkimmer', v), sk.ok, sk.grund),
    zustand.premiumSkimmer ? [el('label', { textContent: 'Farbe Einschub / Deckel' }),
      farbknoepfe(skz.einschub_deckel_farben, zustand.skimmerFarbe, hexVon, (id) => setze('skimmerFarbe', id))] : ''));

  // --- Überdachung ---
  const ueOpt = daten.ueberdachungen.map((u) => { const st = ueberdachungStatus(u, pool, m, rand); return { wert: u.id, text: u.name, ok: st.ok, grund: st.grund }; });
  const ueGew = daten.ueberdachungen.find((u) => u.id === zustand.ueberdachung);
  const ueBlock = [auswahl('Überdachung', [{ wert: '', text: 'Keine' }, ...ueOpt], zustand.ueberdachung, (v) => setze('ueberdachung', v))];
  if (ueGew) {
    const gr = waehleGroesse(ueGew, m, rand);
    ueBlock.push(hinweis(`${gr.individuell ? 'Individuell gefertigt: ' : 'Gewählte Größe: '}${komma(gr.groesse.L)} × ${komma(gr.groesse.B)} m, Höhe ${komma(gr.groesse.h)} m. ${ueGew.scheiben || ''}`));
    const pf = ueGew.profilfarben || (ueGew.profilfarbe ? [ueGew.profilfarbe] : []);
    if (pf.length > 1) ueBlock.push(el('label', { textContent: 'Profilfarbe' }), farbknoepfe(pf, zustand.ueProfil, hexVon, (id) => setze('ueProfil', id)));
    else if (pf.length === 1) ueBlock.push(hinweis(`Profilfarbe: ${name(pf[0])}`));
    if (ueGew.schienenseite) ueBlock.push(auswahl('Schiene', ueGew.schienenseite.map((s) => ({ wert: s, text: name(s) })), zustand.ueSchiene, (v) => setze('ueSchiene', v)));
    ueBlock.push(schalter('Überdachung geöffnet anzeigen', zustand.ueOffen, (v) => setze('ueOffen', v)));
  }
  root.append(abschnitt('Überdachung', ueBlock));

  // --- Abdeckung ---
  const abOpt = daten.abdeckungen.map((a) => { const st = abdeckungStatus(a, pool, m); return { wert: a.id, text: a.name, ok: st.ok, grund: st.grund }; });
  const aGew = daten.abdeckungen.find((a) => a.id === zustand.abdeckung);
  const abBlock = [auswahl('Abdeckung', [{ wert: '', text: 'Keine' }, ...abOpt], zustand.abdeckung, (v) => { zustand.abdeckung = v; zustand.ab = {}; neuBauen(); })];
  if (aGew) abBlock.push(...abdeckungOptionen(aGew, m));
  root.append(abschnitt('Abdeckung', abBlock));

  // --- Ergebnis festhalten (Phase 4) ---
  const projekt = el('input', { type: 'text', id: 'projekt', maxLength: 80, value: zustand.projekt, placeholder: 'z. B. Familie Muster' });
  projekt.addEventListener('input', () => { zustand.projekt = projekt.value; });
  const knopf = (text, fn) => { const b = el('button', { type: 'button', className: 'knopf', textContent: text }); b.addEventListener('click', fn); return b; };
  const datei = el('input', { type: 'file', accept: '.json,application/json', hidden: true });
  datei.addEventListener('change', async () => { if (datei.files[0]) await konfigurationLaden(datei.files[0]); datei.value = ''; });
  root.append(abschnitt('Ergebnis festhalten',
    el('label', { htmlFor: 'projekt', textContent: 'Projektname (optional, nur für die Zusammenfassung)' }), projekt,
    el('div', { className: 'knoepfe' },
      knopf('Zusammenfassung drucken / als PDF', zusammenfassungDrucken),
      knopf('Screenshot speichern (PNG)', screenshotSpeichern),
      knopf('3D-Modell exportieren (GLB)', glbSpeichern),
      knopf('Konfiguration speichern', konfigurationSpeichern),
      knopf('Konfiguration laden …', () => datei.click()), datei),
    hinweis('Alles bleibt auf diesem Rechner: Die Dateien werden direkt heruntergeladen, nichts wird hochgeladen.')));

  // --- Darstellung ---
  root.append(abschnitt('Darstellung',
    auswahl('Umgebung', [{ wert: 'rasen', text: 'Rasen (Garten)' }, { wert: 'frei', text: 'Freies 3D-Modell (ohne Rasen)' }], zustand.umgebung, (v) => { zustand.umgebung = v; if (v === 'rasen') zustand.schnitt = 'aus'; neuBauen(); }),
    pool.aufbau
      ? [auswahl('Schnitt durch das Becken', [{ wert: 'aus', text: 'Aus' }, { wert: 'quer', text: 'Querschnitt' }, { wert: 'laengs', text: 'Längsschnitt' }], zustand.schnitt,
          (v) => { zustand.schnitt = v; if (v !== 'aus') zustand.umgebung = 'frei'; neuBauen(); kameraAufSchnitt(); }),
        zustand.schnitt !== 'aus' ? [regler('Lage des Schnitts', zustand.schnittLage, 0.05, 0.95, 0.01, (v, fertig) => { zustand.schnittLage = v; neuBauen(false, fertig); if (!fertig) kameraAufSchnitt(); }),
          hinweis('Der Schnitt zeigt: ' + pool.aufbau.schichten.join(' · '))] : '']
      : hinweis('Einen Schnitt gibt es bei Systemstein-, Kompakt- und Polypropylen-Becken.'),
    auswahl('Qualität', [{ wert: 'niedrig', text: 'Niedrig (schnell)' }, { wert: 'mittel', text: 'Mittel' }, { wert: 'hoch', text: 'Hoch' }], qualitaet, (v) => { setzeQualitaet(v); }),
    hinweis('Bedienung: Ziehen = drehen, Mausrad oder zwei Finger = zoomen, rechte Maustaste oder zwei Finger ziehen = verschieben.')));
  panel.scrollTop = scroll;
}

/** Bedienelemente der gewählten Abdeckung (aus der JSON-Datei). */
function abdeckungOptionen(a, m) {
  const o = zustand.ab, aus = [];
  const sel = (label, key, ids, textFn = name, status) => auswahl(label, ids.map((i) => { const s = status ? status(i) : { ok: true }; return { wert: i, text: textFn(i), ok: s.ok, grund: s.grund }; }), o[key], (v) => { o[key] = v; neuBauen(); });
  const box = (id, text, ok = true, grund = '') => schalter(text, o.opt[id], (v) => { o.opt[id] = v; neuBauen(); }, ok, grund);
  aus.push(hinweis(a.typ));
  if (a.id === 'safty_individual') {
    const gr = saftyGroesse(a, m);
    aus.push(hinweis(`Gewählte Größe: innen ${komma(gr.innen[0])} × ${komma(gr.innen[1])} m, außen ${komma(gr.aussen[0])} × ${komma(gr.aussen[1])} m. Farbe: ${name(a.farbe)}.`));
  }
  if (a.id === 'waludeck_origin') {
    aus.push(sel('Version', 'version', a.versionen),
      sel('Ausführung', 'ausfuehrung', Object.keys(a.ausfuehrungen), (k) => a.ausfuehrungen[k], (k) => ausfuehrungStatus(a, k, m)),
      sel('Verkleidung (frei wählbar)', 'verkleidung', a.verkleidungen));
  }
  if (a.id === 'rolltop_100') {
    aus.push(el('label', { textContent: 'Gestellfarbe' }), farbknoepfe(a.gestellfarben, o.gestell, hexVon, (id) => { o.gestell = id; neuBauen(); }),
      el('label', { textContent: 'Lamellen' }), farbknoepfe([...a.lamellen.pvc, ...a.lamellen.pc], o.lamellen, hexVon, (id) => { o.lamellen = id; neuBauen(); }));
  }
  if (a.id === 'rolltop_300') {
    aus.push(sel('Variante', 'variante', a.varianten),
      el('label', { textContent: 'Verkleidung' }), farbknoepfe(a.verkleidungsfarben, o.verkleidung, hexVon, (id) => { o.verkleidung = id; neuBauen(); }),
      el('label', { textContent: 'Stützen' }), farbknoepfe(a.stuetzenfarben, o.stuetzen, hexVon, (id) => { o.stuetzen = id; neuBauen(); }),
      el('label', { textContent: 'Lamellen' }), farbknoepfe([...a.lamellen.pvc, ...a.lamellen.pc], o.lamellen, hexVon, (id) => { o.lamellen = id; neuBauen(); }));
  }
  const solar = a.solar_varianten?.includes(o.variante);
  a.optionen.forEach((id) => {
    const gesperrt = solar && a.nicht_bei_solar?.includes(id);
    aus.push(box(id, name(id), !gesperrt, gesperrt ? a.grund_solar : ''));
  });
  return aus;
}

// ---------- Ergebnis festhalten (Phase 4) ----------
function zeigeMeldung(text) { meldung = text; $('meldung').hidden = !text; $('meldung').textContent = text; }

/** Rendert ein Bild in höherer Auflösung und stellt danach die gewählte Qualität wieder her. */
function bildAufnehmen() {
  const r = canvas.parentElement.getBoundingClientRect();
  renderer.setPixelRatio(2);
  renderer.setSize(r.width, r.height, false);
  renderer.render(scene, camera);
  const url = canvas.toDataURL('image/png');
  const blob = new Promise((ok) => canvas.toBlob(ok, 'image/png'));
  renderer.setPixelRatio(QUALITAET[qualitaet].pixel);
  renderer.setSize(r.width, r.height, false);
  rendern();
  return { url, blob };
}
async function screenshotSpeichern() {
  speichereDatei(dateiname(zustand.poolId, 'png'), await bildAufnehmen().blob);
  zeigeMeldung('Screenshot gespeichert (Ordner „Downloads“).');
}
async function glbSpeichern() {
  try {
    // Der GLB enthält den Pool immer als geschlossenen Körper (Außenwand + Boden), nie den Rasen.
    const pool = poolDaten(), m = masse(pool, pool.groessen[zustand.groesseIdx]);
    const rand = zustand.umrandung ? steinMasse(daten.umrandungen.find((x) => x.id === zustand.umrandung)).b : 0.12;
    const koerper = szene.sockel || baueKoerper(m, pool.aufbau, rand);
    const teile = [szene.pool, szene.rand, szene.ue, szene.ab, koerper].filter(Boolean);
    speichereDatei(dateiname(zustand.poolId, 'glb'), await exportiereGLB(teile));
    if (!szene.sockel) leereGruppe(koerper);
    zeigeMeldung('3D-Modell als GLB gespeichert (Pool als geschlossener Körper, ohne Rasen und Himmel).');
  } catch (err) { console.error(err); zeigeMeldung('Der GLB-Export ist fehlgeschlagen: ' + (err.message || err)); }
}
function konfigurationSpeichern() {
  speichereDatei(dateiname(zustand.poolId, 'json'), new Blob([konfigAlsText(zustand, daten)], { type: 'application/json' }));
  zeigeMeldung('Konfiguration gespeichert (Ordner „Downloads“).');
}
async function konfigurationLaden(datei) {
  try {
    const neu = konfigLesen(await datei.text(), daten, zustand);
    Object.assign(zustand, neu);
    neuBauen(true);
    zeigeMeldung(`Konfiguration „${datei.name}“ geladen.${meldungKorrektur ? ' ' + meldungKorrektur : ''}`);
  } catch (err) { zeigeMeldung(err.message); }
}

/** Gewählte Optionen als Abschnitte für die Zusammenfassung (ohne Preise). */
function sammleAuswahl() {
  const pool = poolDaten(), g = pool.groessen[zustand.groesseIdx], m = masse(pool, g);
  const istPP = pool.id === 'pp_pool';
  const farbTab = istPP ? daten.farben_3d.pp_platten : daten.farben_3d.folie;
  const uGew = daten.umrandungen.find((u) => u.id === zustand.umrandung);
  const rand = uGew ? steinMasse(uGew).b : 0;
  const abschn = [];
  const A = (titel, zeilen) => abschn.push({ titel, zeilen: zeilen.filter((z) => z[1] !== undefined && z[1] !== '') });

  A('Becken', [['Beckentyp', pool.name], ['Bauweise', pool.bauweise], ['Größe', beckenText(pool, g)],
    ['Wasserinhalt', g.inhalt_m3 ? `ca. ${g.inhalt_m3} m³` : ''],
    [istPP ? 'Plattenfarbe' : 'Folienfarbe', farbTab[zustand.farbe].name], ['Oberfläche', istPP ? name(zustand.oberflaeche) : '']]);

  const leiter = /leiter/.test(zustand.einstieg);
  A('Einstieg', [['Art', daten.treppen[zustand.einstieg].name], ['Position an der Schmalseite', !leiter || m.form === 'rechteck' ? name(zustand.seite) : '']]);

  A('Umrandung', uGew
    ? [['Beckenrandsteine', uGew.name], ['Material', uGew.material], ['Farbe', uGew.farben.find((f) => (f.id || f) === zustand.umrandungFarbe)?.name || name(zustand.umrandungFarbe)],
      ['Steinmaß', `${komma(steinMasse(uGew).l * 100)} × ${komma(steinMasse(uGew).b * 100)} cm`]]
    : [['Beckenrandsteine', 'Ohne Umrandung (schlichte Kante)']]);

  const led = zustand.led ? ledListe(daten, pool).liste.find((l) => l.id === zustand.led) : null;
  A('Zubehör', [['Beleuchtung', led ? `${led.name}, ${zustand.ledAnzahl} Stück, ${ledSeiten(pool).find((x) => x.wert === zustand.ledSeite).text}` : 'Ohne LED'],
    ['Skimmer', `${skimmerAnzahl(m, daten.skimmer_regel)} × ` + (zustand.premiumSkimmer ? `poolmaris Premium Skimmer, Einschub/Deckel ${name(zustand.skimmerFarbe)}` : 'Standard-Skimmer (im Set)')],
    ['Im Set enthalten', (pool.im_set_enthalten || []).join(', ')]]);

  const ueGew = daten.ueberdachungen.find((u) => u.id === zustand.ueberdachung);
  if (ueGew) {
    const gr = waehleGroesse(ueGew, m, rand).groesse;
    A('Überdachung', [['Modell', ueGew.name], ['Art', ueGew.typ], ['Größe', `${komma(gr.L)} × ${komma(gr.B)} m, Höhe ${komma(gr.h)} m`],
      ['Scheiben', ueGew.scheiben], ['Profilfarbe', name(zustand.ueProfil)], ['Schiene', ueGew.schienenseite ? name(zustand.ueSchiene) : '']]);
  } else A('Überdachung', [['Auswahl', 'Keine']]);

  const aGew = daten.abdeckungen.find((a) => a.id === zustand.abdeckung);
  if (aGew) {
    const o = zustand.ab, ids = Object.keys(o.opt || {}).filter((k) => o.opt[k] && aGew.optionen.includes(k));
    const rows = [['Modell', aGew.name], ['Art', aGew.typ]];
    if (aGew.id === 'safty_individual') { const gr = saftyGroesse(aGew, m); rows.push(['Größe', `innen ${komma(gr.innen[0])} × ${komma(gr.innen[1])} m, außen ${komma(gr.aussen[0])} × ${komma(gr.aussen[1])} m`], ['Farbe', name(aGew.farbe)]); }
    if (aGew.id === 'waludeck_origin') rows.push(['Version', name(o.version)], ['Ausführung', aGew.ausfuehrungen[o.ausfuehrung]], ['Verkleidung', name(o.verkleidung)]);
    if (aGew.id === 'rolltop_100') rows.push(['Gestellfarbe', name(o.gestell)], ['Lamellen', name(o.lamellen)]);
    if (aGew.id === 'rolltop_300') rows.push(['Variante', name(o.variante)], ['Verkleidung', name(o.verkleidung)], ['Stützen', name(o.stuetzen)], ['Lamellen', name(o.lamellen)]);
    rows.push(['Optionen', ids.length ? ids.map(name).join(', ') : 'keine']);
    A('Abdeckung', rows);
  } else A('Abdeckung', [['Auswahl', 'Keine']]);
  return abschn;
}

/** Baut die Druckansicht (3D-Bild + Tabellen) und öffnet den Druckdialog; dort lässt sich auch als PDF sichern. */
function zusammenfassungDrucken() {
  const bild = bildAufnehmen();
  const root = $('druck');
  root.replaceChildren(
    el('h1', { textContent: 'Ihre Pool-Konfiguration' }),
    el('p', { className: 'kopf', textContent: [zustand.projekt, new Date().toLocaleDateString('de-DE')].filter(Boolean).join(' · ') }),
    el('img', { src: bild.url, alt: '3D-Ansicht des konfigurierten Pools' }),
    ...sammleAuswahl().map((a) => el('section', {}, el('h2', { textContent: a.titel }),
      el('table', {}, a.zeilen.map(([k, v]) => el('tr', {}, el('th', { textContent: k }), el('td', { textContent: v })))))),
    el('p', { className: 'fuss', textContent: 'Unverbindliche Darstellung. Farben und Maße der 3D-Ansicht sind Richtwerte. poolmaris · www.poolmaris.de' }));
  window.print();
}

// ---------- Start ----------
async function start() {
  try {
    const antwort = await fetch(DATEN_URL, { cache: 'no-store' }); // Änderungen an der JSON-Datei sofort übernehmen
    if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
    daten = await antwort.json();
    setzeQualitaet('mittel');
    groesseAnpassen();
    neuBauen(true);
  } catch (err) {
    const f = $('fehler');
    f.hidden = false;
    f.textContent = 'Die Produktdaten konnten nicht geladen werden. Bitte die App über „start.command“ starten (nicht per Doppelklick auf index.html). Technische Meldung: ' + err.message;
    console.error(err);
  }
}
start();
