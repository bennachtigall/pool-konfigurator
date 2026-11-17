// poolmaris 3D-Pool-Konfigurator – KI-Version (zusätzlich: Garten aus einem Foto per Tiefenschätzung)
// Ursprünglich Phase 3 (alle Pools, Umrandung, Zubehör, Überdachung, Abdeckung)
// Läuft komplett lokal: lädt nur ../daten/poolmaris-konfiguration.json und lib/three*.js.
import * as THREE from 'three';
import { OrbitControls } from './lib/OrbitControls.js';
import { buildPool, masse, umrissPunkte, flaecheGeo, skimmerAnzahl, duesenOrte, duesenAnzahl, einstiegsBelegung, ledOrte } from './pool.js';
import { baueKoerper } from './koerper.js';
import { baueUmgebungen } from './umgebung.js';
import { wasserNormal, kontaktSchatten, fotoLicht } from './materialien.js';
import { ShaderPass } from './lib/postprocessing/ShaderPass.js';
import { EffectComposer } from './lib/postprocessing/EffectComposer.js';
import { RenderPass } from './lib/postprocessing/RenderPass.js';
import { GTAOPass } from './lib/postprocessing/GTAOPass.js';
import { SMAAPass } from './lib/postprocessing/SMAAPass.js';
import { OutputPass } from './lib/postprocessing/OutputPass.js';
import { tiefeSchaetzen } from './tiefe.js';
import { KI_STANDARD, kalibrieren, gelaendeBauen, poolAussparung, bodenAbstand, tiefeVerfeinern } from './gelaende.js';
import { exifLesen, bildwinkelAusF35, gpsZuMeter, istHeic } from './exif.js';
import { GARTEN_STANDARD, RICHTUNGEN, bilderHinzu, bildEntfernen, bildRichtung, gartenBilder, gartenUmgebung, gartenBoden, panoramaBauen } from './garten3d.js';
import { GroundedSkybox } from './lib/GroundedSkybox.js';
import { FOTO_STANDARD, fotoLaden, fotoBild, fotoRechteck, fotoKamera, fotoBoden, sonnenRichtung, fotoZusammensetzen } from './foto.js';
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
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0); // transparent: im Foto-Modus liegt das Gartenfoto dahinter
renderer.shadowMap.enabled = true;
renderer.localClippingEnabled = true; // Schnittebene für den Querschnitt
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.7;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfdcf0);
scene.fog = new THREE.Fog(0xbfdcf0, 40, 120);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2500);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.03; // nicht unter den Rasen schauen
controls.minDistance = 0.6; // nah heranzoomen (z. B. für den Schnitt)
controls.maxDistance = 45;
controls.target.set(0, -0.3, 0);

const hintergrund = new THREE.Scene(); // Himmel und Foto-Kuppel: eigene Ebene, ohne Umgebungsverdeckung
const welt = new THREE.Group(); // Pool + Zubehör; im Foto-Modus verschiebbar und drehbar
scene.add(welt);

const hemi = new THREE.HemisphereLight(0xdcecff, 0x6f8a4a, 1.0);
scene.add(hemi);
const sonne = new THREE.DirectionalLight(0xfff2dd, 2.6);
sonne.position.set(8, 14, 6);
sonne.castShadow = true;
sonne.shadow.camera.left = sonne.shadow.camera.bottom = -10;
sonne.shadow.camera.right = sonne.shadow.camera.top = 10;
sonne.shadow.camera.far = 45;
scene.add(sonne);
const umg = baueUmgebungen(renderer); // Himmel + Spiegelungskarten
hintergrund.add(umg.sky);
sonne.position.copy(umg.sonne).multiplyScalar(20); // Sonnenlicht passend zum Himmel
sonne.shadow.bias = -0.0004; sonne.shadow.normalBias = 0.03; sonne.shadow.radius = 4; // weiche Schattenkanten
scene.add(sonne.target);

// ---------- Rasen mit Loch für das Becken ----------
function rasenTextur() { // dichter Rasen mit Halmen, Flecken und leichter Farbstreuung
  const N = 512, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d');
  g.fillStyle = '#4f7f31'; g.fillRect(0, 0, N, N);
  for (let i = 0; i < 40; i++) { // große, weiche Farbflecken
    const x = Math.random() * N, y = Math.random() * N, r = 40 + Math.random() * 90;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `hsla(${80 + Math.random() * 25},45%,${26 + Math.random() * 14}%,0.35)`); gr.addColorStop(1, 'hsla(90,40%,30%,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  for (let i = 0; i < 26000; i++) { // einzelne Halme
    const x = Math.random() * N, y = Math.random() * N, l = 3 + Math.random() * 6, w = (Math.random() - 0.5) * 3;
    g.strokeStyle = `hsl(${78 + Math.random() * 30} ${38 + Math.random() * 25}% ${22 + Math.random() * 26}%)`;
    g.lineWidth = 0.8 + Math.random() * 0.8; g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y - l); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
const rasenMat = new THREE.MeshStandardMaterial({ map: rasenTextur(), roughness: 0.95 });
rasenMat.bumpMap = rasenMat.map; rasenMat.bumpScale = 1.2;
const untergrundMat = new THREE.MeshStandardMaterial({ color: 0x8a8d8f, roughness: 1 });
let boden = null; // Gruppe aus Rasen + Untergrund unter der Umrandung
function baueBoden(m, off) { // m.T = Beckentiefe
  if (boden) { welt.remove(boden); boden.traverse((o) => o.geometry && o.geometry.dispose()); }
  boden = new THREE.Group();
  if (zustand.umgebung === 'foto') { boden.add(fotoBoden(m, off, zustand.foto.schatten)); welt.add(boden); return; }
  if (kiAktiv()) { // KI-Garten: das Gelände aus dem Foto ist der Boden; zusätzlich eine unsichtbare Tiefen-Fläche,
    // die die Außenwände des Beckens auch außerhalb des Fotobereichs unter der Erde verdeckt (nach dem Gelände gezeichnet)
    const fb = fotoBoden(m, off, 0); fb.children[1].visible = false; fb.children[0].renderOrder = -0.5;
    boden.add(fb); welt.add(boden); return;
  }
  if (zustand.umgebung === 'garten3d' && gartenBilder().length) { boden.add(gartenBoden(m, off, zustand.garten)); welt.add(boden); return; }
  if (zustand.umgebung === 'frei') { // freies Modell: nur ein weicher Schatten auf neutralem Grund, kein Rasen
    const schatten = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.22 }));
    schatten.position.y = -m.T - 0.3; schatten.receiveShadow = true;
    boden.add(schatten); welt.add(boden);
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
  welt.add(boden);
}

// ---------- Qualitätsstufen ----------
const QUALITAET = {
  niedrig: { pixel: 0.75, schatten: false, schattenGroesse: 512, env: false, anim: false, real: false, post: false },
  mittel: { pixel: 1, schatten: true, schattenGroesse: 1024, env: true, anim: false, real: false, post: false },
  hoch: { pixel: Math.min(window.devicePixelRatio || 1, 2), schatten: true, schattenGroesse: 2048, env: true, anim: false, real: true, post: true },
  ultra: { pixel: Math.min((window.devicePixelRatio || 1) * 1.5, 3), schatten: true, schattenGroesse: 4096, env: true, anim: true, real: true, post: true },
};
let qualitaet = 'hoch';

/** Himmel/Studio/Foto, Spiegelungen und Lichtstärke je nach Umgebung und Qualität. */
let gartenKuppel = null, gartenEnv = null;

// ---------- KI-Garten: Zustand außerhalb der Konfiguration (Fotos und Tiefe werden nie gespeichert) ----------
// Mehrere Fotos vom selben Standpunkt in verschiedene Richtungen ergeben zusammen ein Rundum-Gelände.
// Foto 1 ist das Hauptfoto (Startansicht); jedes weitere hat eine Blickrichtung (yaw, Grad, + = rechts).
const ki = { bilder: [], schluessel: '', env: null, tex: null, envSchluessel: '', gelaende: [], uniforms: null, messen: null };
const kiH = () => ki.bilder[0];
const kiAktiv = () => zustand.umgebung === 'ki' && !!kiH()?.tiefe;
const kiBildwinkel = (b) => b.exif?.f35 ? bildwinkelAusF35(b.exif.f35, b.bild.naturalWidth, b.bild.naturalHeight) : zustand.ki.bildwinkel;
const kiParam = (b) => ({ ...zustand.ki, bildwinkel: kiBildwinkel(b), kippung: b.kippung ?? 0 });
function kiKalibrieren() { for (const b of ki.bilder) b.kalib = kalibrieren(b.tiefe, b.bild.naturalWidth / b.bild.naturalHeight, kiParam(b)); }

/** Rundum-Bild aus allen Fotos: Hintergrund jenseits des Geländes und Spiegelungskarte. */
function kiUmgebung() {
  const p = zustand.ki, h = kiH();
  const s = [ki.bilder.map((b) => b.url + '@' + b.yaw).join(','), kiBildwinkel(h).toFixed(1), h.kalib.horizont.toFixed(3)].join('|');
  if (ki.envSchluessel !== s) {
    ki.tex?.dispose(); ki.env?.dispose();
    const liste = ki.bilder.map((b) => ({ img: b.bild, richtung: ((b.yaw % 360) + 360) % 360, panorama: false }));
    const t = new THREE.CanvasTexture(panoramaBauen({ bildwinkel: kiBildwinkel(h), horizont: h.kalib.horizont, bodenFuellen: true }, liste));
    t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; // sonst Himmelsfarbe am Kuppelboden (Pol der Kugel)
    const pm = new THREE.PMREMGenerator(renderer);
    ki.tex = t; ki.env = pm.fromEquirectangular(t).texture; pm.dispose();
    ki.envSchluessel = s;
  }
  const kuppel = new GroundedSkybox(ki.tex, p.hoehe, p.ferne * 1.2, 96);
  kuppel.position.y = p.hoehe - 0.05; kuppel.material.toneMapped = false; kuppel.name = 'KI_Kuppel';
  kuppel.rotation.y = Math.PI; // Fotomitte nach vorn (Blickrichtung −z)
  return kuppel;
}

/** Gelände aller Fotos neu bauen, wenn sich Fotos oder Projektions-Einstellungen geändert haben.
 *  Standort und Blickrichtung der Fotos ändern nur die Lage der Gruppen (schnell, z. B. beim Ziehen im Lageplan). */
function kiGelaende(m, off) {
  const p = zustand.ki;
  const s = [ki.bilder.map((b) => b.url + '#' + (b.kippung ?? 0)).join(','), p.hoehe, p.bildwinkel, p.horizontAuto, p.horizont, p.tiefe, p.schatten, qualitaet].join('|');
  if (ki.schluessel !== s) {
    for (const g of ki.gelaende) { scene.remove(g.gruppe); g.gruppe.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); g.texturen.forEach((t) => t.dispose()); }
    ki.uniforms = null;
    ki.gelaende = ki.bilder.map((b, nr) => {
      const g = gelaendeBauen(b.bild, b.tiefe, b.kalib, kiParam(b), p.schatten, qualitaet === 'niedrig' ? 180 : qualitaet === 'ultra' ? 460 : 320,
        { nr, uniforms: ki.uniforms ?? undefined, hintergrund: qualitaet !== 'niedrig' });
      ki.uniforms = g.uniforms; scene.add(g.gruppe); return g;
    });
    ki.schluessel = s;
  }
  kiLageAnwenden();
  if (ki.uniforms) poolAussparung(ki.uniforms, welt, m, off);
}
/** Standort/Blickrichtung aller Fotos auf das Gelände und die Zuständigkeits-Uniforms übertragen. */
function kiLageAnwenden() {
  ki.gelaende.forEach((g, i) => {
    const b = ki.bilder[i]; if (!b) return;
    g.gruppe.visible = true;
    g.gruppe.position.set(b.pos.x, 0, b.pos.z);
    g.gruppe.rotation.y = THREE.MathUtils.degToRad(-b.yaw);
  });
  const u = ki.uniforms; if (!u) return;
  u.uKamAnzahl.value = ki.bilder.length; u.uKamHoehe.value = zustand.ki.hoehe;
  ki.bilder.forEach((b, i) => {
    const y = THREE.MathUtils.degToRad(b.yaw);
    u.uKams.value[i].set(b.pos.x, b.pos.z, Math.sin(y), -Math.cos(y));
    u.uKamCos.value[i] = Math.cos(THREE.MathUtils.degToRad(kiBildwinkel(b) / 2) * 0.97);
  });
}
/** Lage der Fotos aus GPS und Kompass (iPhone): Hauptfoto im Ursprung, Blick nach −z; die anderen relativ dazu. */
function kiLageAusFotodaten() {
  const h = kiH(); if (!h) return false;
  const mitGps = ki.bilder.every((b) => b.exif?.lat !== undefined && b.exif?.richtung !== undefined);
  if (!mitGps) return false;
  const h0 = h.exif.richtung;
  for (const b of ki.bilder) {
    const d = gpsZuMeter(b.exif.lat, b.exif.lon, h.exif.lat, h.exif.lon); // x = Ost, z = −Nord
    const r = Math.hypot(d.x, d.z), peil = Math.atan2(d.x, -d.z) - THREE.MathUtils.degToRad(h0);
    b.pos = { x: r * Math.sin(peil), z: -r * Math.cos(peil) };
    b.yaw = ((b.exif.richtung - h0 + 540) % 360) - 180;
    b.quelle = 'gps';
  }
  return true;
}
const kiGelaendeMeshes = () => ki.gelaende.flatMap((g) => g.gruppe.children.filter((o) => o.name === 'KI_Gelaende'));

/** Horizontlinie über dem Bild anzeigen (hilft beim Einstellen von Hand). */
function kiHorizontLinie() {
  const l = $('horizont-linie'), h = kiH();
  const zeigen = zustand.umgebung === 'ki' && h?.kalib && (!zustand.ki.horizontAuto || !h.kalib.sicher) && kiInFotoansicht() && kiFotoIndex === 0;
  l.hidden = !zeigen;
  if (!zeigen) return;
  const r = canvas.getBoundingClientRect(), pr = canvas.parentElement.getBoundingClientRect();
  Object.assign(l.style, { left: (r.left - pr.left) + 'px', width: r.width + 'px', top: (r.top - pr.top + h.kalib.horizont * r.height) + 'px' });
}
let kiFotoblick = false, kiFotoIndex = 0; // Kamera steht auf dem Fotostandpunkt (bis der Nutzer selbst dreht)
controls.addEventListener('start', () => { kiFotoblick = false; kiHorizontLinie(); });
function kiInFotoansicht() { return kiFotoblick; }
/** Kamera genau auf den Standpunkt von Foto i setzen (Ansicht = Foto). */
function kiFotoansicht(i = kiFotoIndex) {
  const b = ki.bilder[i]; if (!b?.kalib) return;
  kiFotoIndex = i;
  const p = zustand.ki, k = b.kalib, yaw = THREE.MathUtils.degToRad(b.yaw);
  const dist = k.neigung < -0.03 ? Math.min(p.hoehe / Math.tan(-k.neigung), 40) : 25;
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(k.tanY));
  camera.position.set(b.pos.x, p.hoehe, b.pos.z);
  controls.target.set(b.pos.x + Math.sin(yaw) * dist, 0, b.pos.z - Math.cos(yaw) * dist);
  camera.lookAt(controls.target);
  // Umschauen begrenzen: um die Blickrichtung dieses Fotos herum (bei Rundum-Fotos frei)
  const rundum = ki.bilder.length >= 2;
  controls.minAzimuthAngle = rundum ? -Infinity : -yaw - 0.95; controls.maxAzimuthAngle = rundum ? Infinity : -yaw + 0.95;
  controls.update(); camera.updateProjectionMatrix(); kiFotoblick = true; groesseAnpassen(); rendern(); kiHorizontLinie();
}

/** Maßstab nachmessen: zwei Punkte im Gelände anklicken, echte Länge eingeben → Kamerahöhe wird angepasst. */
const messGruppe = new THREE.Group(); scene.add(messGruppe);
function messAnzeigen() {
  messGruppe.clear();
  const pts = ki.messen?.punkte ?? [];
  const kugel = new THREE.SphereGeometry(0.06, 16, 12), gelb = new THREE.MeshBasicMaterial({ color: 0xffd400, depthTest: false });
  pts.forEach((pt) => { const k = new THREE.Mesh(kugel, gelb); k.position.copy(pt); k.renderOrder = 10; messGruppe.add(k); });
  if (pts.length === 2) { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffd400, depthTest: false })); l.renderOrder = 10; messGruppe.add(l); }
  rendern();
}

function umgebungSetzen(modus) {
  const q = QUALITAET[qualitaet], frei = modus === 'frei', foto = modus === 'foto';
  // Kundengarten 3D: Kuppel aus den Fotos (nur neu berechnet, wenn sich Fotos/Projektion ändern)
  if (gartenKuppel) { hintergrund.remove(gartenKuppel); gartenKuppel.geometry.dispose(); gartenKuppel.material.dispose(); gartenKuppel = null; }
  gartenEnv = null;
  let garten = modus === 'garten3d' && daten ? gartenUmgebung(renderer, zustand.garten) : null;
  if (modus === 'ki' && kiH()?.kalib) garten = { kuppel: kiUmgebung(), env: ki.env };   // KI-Garten: gleiche Logik wie Kundengarten
  if (garten) { gartenKuppel = garten.kuppel; gartenEnv = garten.env; hintergrund.add(gartenKuppel); }
  umg.sky.visible = modus === 'rasen' || ((modus === 'garten3d' || modus === 'ki') && !garten);
  scene.background = null;
  hintergrund.background = frei ? new THREE.Color(0xe6eaed) : null; // Hintergrundfarbe liegt in der Hintergrund-Ebene
  scene.fog = modus === 'rasen' ? new THREE.Fog(0xc9dcec, 80, 600) : null;
  scene.environment = q.env ? (frei ? umg.studioEnv : gartenEnv || umg.himmelEnv) : null;
  scene.environmentIntensity = frei ? 0.7 : garten ? 0.9 : 0.35;
  hemi.intensity = q.env ? 0.2 : 0.9;
  hemi.color.set(0xdcecff); hemi.groundColor.set(0x6f8a4a); sonne.color.set(0xfff2dd);
  if (modus === 'ki' && kiH()) { // Lichtstimmung des Hauptfotos übernehmen: Himmels-/Bodenfarbe, Farbtemperatur
    const l = kiH().licht ?? (kiH().licht = fotoLicht(kiH().bild));
    hemi.color.copy(l.himmel).lerp(new THREE.Color(1, 1, 1), 0.3); hemi.groundColor.copy(l.boden); hemi.intensity = q.env ? 0.45 : 1.0;
    sonne.color.setRGB(1 + l.waerme * 0.25, 1, 1 - l.waerme * 0.35);
  }
  const p = foto ? zustand.foto : modus === 'garten3d' ? zustand.garten : modus === 'ki' ? zustand.ki : null;
  const hell = p ? p.helligkeit : 1;
  sonne.intensity = (q.env ? 2.0 : 2.4) * hell;
  // Im Kundengarten farbtreue Belichtung, damit die Fotos aussehen wie aufgenommen
  renderer.toneMapping = garten ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = (garten ? 1.0 : 0.7) * hell;
  // Sonnenrichtung: in Foto-Modi frei einstellbar, damit die Schatten zu den Fotos passen
  const dir = p ? sonnenRichtung(p) : umg.sonne;
  sonne.target.position.copy(welt.position);
  sonne.position.copy(welt.position).addScaledVector(dir, 20);
  const s = p ? 12 : 10; sonne.shadow.camera.left = sonne.shadow.camera.bottom = -s; sonne.shadow.camera.right = sonne.shadow.camera.top = s; sonne.shadow.camera.updateProjectionMatrix();
}

function setzeQualitaet(name) {
  qualitaet = name;
  const q = QUALITAET[name];
  renderer.setPixelRatio(q.pixel);
  renderer.shadowMap.enabled = q.schatten;
  sonne.castShadow = q.schatten;
  sonne.shadow.mapSize.set(q.schattenGroesse, q.schattenGroesse);
  if (sonne.shadow.map) { sonne.shadow.map.dispose(); sonne.shadow.map = null; }
  umgebungSetzen(zustand.umgebung);
  if (daten) neuBauen(); // Wasser/Lichtmuster je nach Qualität neu aufbauen
  scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((mt) => { mt.needsUpdate = true; }); });
  groesseAnpassen();
}

// ---------- Nachbearbeitung: Umgebungsverdeckung (GTAO) + Kantenglättung (SMAA) + Farbausgabe ----------
let composer = null, gtao = null, koernung = null;
function composerHolen() {
  if (composer) return composer;
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(hintergrund, camera));
  const vorn = new RenderPass(scene, camera); vorn.clear = false; // Pool & Co. über den Hintergrund
  composer.addPass(vorn);
  gtao = new GTAOPass(scene, camera, 512, 512);
  gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.2, samples: 12 });
  gtao.blendIntensity = 0.8;
  composer.addPass(gtao);
  composer.addPass(new SMAAPass());
  composer.addPass(new OutputPass());
  koernung = new ShaderPass({ // feines Bildrauschen wie bei einer Handykamera
    uniforms: { tDiffuse: { value: null }, uZeit: { value: 0 }, uStaerke: { value: 0.035 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uZeit; uniform float uStaerke; varying vec2 vUv;
      float rnd(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uZeit) * 43758.5453); }
      void main() { vec4 c = texture2D(tDiffuse, vUv); float n = rnd(gl_FragCoord.xy) - 0.5; gl_FragColor = vec4(c.rgb + n * uStaerke, c.a); }`,
  });
  composer.addPass(koernung);
  return composer;
}
/** Ein Bild rendern: mit Nachbearbeitung (Hoch/Ultra) oder direkt. Im Foto-Modus direkt (transparenter Hintergrund). */
function bildRendern() {
  if (ki.uniforms) ki.uniforms.uBetrachter.value.copy(camera.position); // blickabhängige Fotowahl im KI-Garten
  const q = QUALITAET[qualitaet];
  if (q.post && zustand.umgebung !== 'foto') {
    composerHolen(); gtao.enabled = zustand.umgebung !== 'ki'; koernung.enabled = zustand.umgebung === 'ki' || zustand.umgebung === 'garten3d';
    const c = composerHolen(), pr = renderer.getPixelRatio(), s = renderer.getSize(new THREE.Vector2());
    c.setPixelRatio(pr); c.setSize(s.x, s.y);
    c.render();
  } else {
    renderer.autoClear = false; renderer.clear();
    renderer.render(hintergrund, camera);
    renderer.render(scene, camera);
    renderer.autoClear = true;
  }
}

// ---------- Rendern nur bei Bedarf (schont den Laptop-Akku) ----------
let brauchtRender = true;
const rendern = () => { brauchtRender = true; };
controls.addEventListener('change', () => { rendern(); if (zustand.umgebung === 'ki') kiHorizontLinie(); });
function groesseAnpassen() {
  const r = canvas.parentElement.getBoundingClientRect();
  let w = r.width, h = r.height;
  const foto = $('foto-bild');
  if (zustand.umgebung === 'foto' && fotoBild()) { // Ansicht auf das Seitenverhältnis des Fotos zuschneiden
    const f = fotoRechteck(r.width, r.height);
    w = f.width; h = f.height;
    for (const e of [canvas, foto]) Object.assign(e.style, { position: 'absolute', left: f.left + 'px', top: f.top + 'px', width: w + 'px', height: h + 'px' });
    foto.hidden = false;
  } else if (zustand.umgebung === 'ki' && kiH()) { // KI-Garten: gleiches Seitenverhältnis wie das Foto (Startansicht = Foto)
    const fb = ki.bilder[kiFotoIndex] ?? kiH(), rv = fb.bild.naturalWidth / fb.bild.naturalHeight;
    w = r.width; h = w / rv; if (h > r.height) { h = r.height; w = h * rv; }
    w = Math.round(w); h = Math.round(h);
    Object.assign(canvas.style, { position: 'absolute', left: Math.round((r.width - w) / 2) + 'px', top: Math.round((r.height - h) / 2) + 'px', width: w + 'px', height: h + 'px' });
    foto.hidden = true;
  } else {
    Object.assign(canvas.style, { position: '', left: '', top: '', width: '', height: '' });
    foto.hidden = true;
  }
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
  rendern();
}
window.addEventListener('resize', groesseAnpassen);
let letzterFrame = 0;
renderer.setAnimationLoop((zeit) => {
  if (QUALITAET[qualitaet].anim && zeit - letzterFrame > 33) { // Ultra: Wasser und Lichtmuster bewegen sich (ca. 30 Bilder/s)
    const n = wasserNormal(); n.offset.set((zeit * 0.00003) % 1, (zeit * 0.000018) % 1);
    szene.pool?.traverse((o) => { const k = o.userData.kaustik; if (k) k.offset.set(Math.sin(zeit * 0.00021) * 0.08, (zeit * 0.00002) % 1); });
    brauchtRender = true; letzterFrame = zeit;
  }
  if (zustand.umgebung !== 'foto' && controls.update()) brauchtRender = true;
  if (brauchtRender) { if (ki.uniforms) ki.uniforms.uBetrachter.value.copy(camera.position); bildRendern(); brauchtRender = false; }
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
  ueberdachung: '', ueProfil: '', ueSchiene: 'links', ueOeffnung: 0, abOeffnung: 0, // Öffnungsgrade 0 (zu) bis 1 (offen)
  abdeckung: '', ab: {},
  umgebung: 'rasen', // 'rasen' (Garten), 'frei' (freies 3D-Modell ohne Rasen) oder 'foto' (Kundengarten-Foto)
  ki: { ...KI_STANDARD }, // KI-Garten: Kamera, Maßstab, Lage des Pools, Licht (Foto und Tiefe werden nicht gespeichert)
  garten: { ...GARTEN_STANDARD }, // Kundengarten 3D: Projektion der Fotos, Boden, Sonne (die Fotos selbst werden nicht gespeichert)
  foto: { ...FOTO_STANDARD }, // Kamera, Lage des Pools und Sonne im Foto (das Foto selbst wird nicht gespeichert)
  projekt: '', // optionaler Projektname für die Zusammenfassung (bleibt lokal)
};
let meldung = '';
let meldungKorrektur = ''; // Hinweis, wenn beim Laden Auswahl korrigiert wurde
const szene = { pool: null, rand: null, ue: null, ab: null, sockel: null, kappe: null, kontakt: null }; // aktuell sichtbare Gruppen

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
  if ((zustand.umgebung === 'foto' || zustand.umgebung === 'ki') && zustand.schnitt !== 'aus') zustand.schnitt = 'aus';
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
  if (szene[schluessel]) { welt.remove(szene[schluessel]); leereGruppe(szene[schluessel]); }
  szene[schluessel] = gruppe || null;
  if (gruppe) welt.add(gruppe);
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
    realistisch: QUALITAET[qualitaet].real, duesenRegel: daten.einlaufduesen_regel, ledRegel: daten.led_regel,
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
  { // Kontaktschatten außen an der Beckenkante (nicht im freien Modell, dort gibt es keinen Boden)
    const off = rand || 0.12, k = new THREE.Group();
    if (zustand.umgebung !== 'frei') k.add(kontaktSchatten(umrissPunkte(m, off), umrissPunkte(m, off + 0.22), zustand.umgebung === 'rasen' ? 0.16 : 0.22));
    ersetze('kontakt', k);
  }
  const frei = zustand.umgebung === 'frei', foto = zustand.umgebung === 'foto';
  // Welt: im Foto-Modus an die gewählte Stelle verschieben und drehen, sonst im Ursprung
  if (foto) { welt.position.set(zustand.foto.x, 0, zustand.foto.z); welt.rotation.y = THREE.MathUtils.degToRad(zustand.foto.drehung); }
  else if (kiAktiv()) {
    const p = zustand.ki;
    kiKalibrieren();
    if (p.z === null) p.z = -(Math.max(bodenAbstand(kiH().kalib, kiParam(kiH()), 0.9), 1.5) + m.B / 2 + (rand || 0.12) + 0.4); // Start: vordere Beckenkante knapp über dem unteren Bildrand
    welt.position.set(p.x, 0, p.z); welt.rotation.y = THREE.MathUtils.degToRad(p.drehung);
  }
  else { welt.position.set(0, 0, 0); welt.rotation.y = 0; }
  if (kiAktiv()) kiGelaende(m, rand || 0.12); else ki.gelaende.forEach((g) => { g.gruppe.visible = false; });
  messGruppe.visible = kiAktiv();
  const technik = technikAussen(pool, m, ws, led); // Technik außen am Körper (gleiche Lage wie innen)
  ersetze('sockel', frei ? baueKoerper(m, pool.aufbau, rand || 0.12, technik) : null);
  umgebungSetzen(zustand.umgebung);
  controls.enabled = !foto;
  controls.maxDistance = zustand.umgebung === 'garten3d' ? zustand.garten.radius * 0.55 : zustand.umgebung === 'ki' ? 45 : 45;
  // KI-Garten: Umschauen nur so weit, wie das eine Foto Informationen hat (seitlich ca. ±55°, nicht unter den Boden)
  const kiModus = zustand.umgebung === 'ki';
  if (!kiModus) { controls.minAzimuthAngle = -Infinity; controls.maxAzimuthAngle = Infinity; }
  controls.minPolarAngle = kiModus ? 0.35 : 0; // im Garten innerhalb der Foto-Kuppel bleiben
  if (foto) fotoKamera(camera, zustand.foto);
  controls.maxPolarAngle = frei ? Math.PI - 0.05 : Math.PI / 2 - 0.03; // frei: auch von unten ansehbar
  baueBoden(m, rand || 0.12);

  if (zustand.ueberdachung) {
    const u = daten.ueberdachungen.find((x) => x.id === zustand.ueberdachung);
    const gr = waehleGroesse(u, m, rand).groesse;
    ersetze('ue', baueUeberdachung(u, gr, { profilHex: hexVon(zustand.ueProfil), schiene: zustand.ueSchiene, oeffnung: zustand.ueOeffnung }));
  } else ersetze('ue', null);

  if (zustand.abdeckung) {
    const a = daten.abdeckungen.find((x) => x.id === zustand.abdeckung);
    const o = { ...zustand.ab, oeffnung: zustand.abOeffnung, solar: !!a.solar_varianten?.includes(zustand.ab.variante), led: !!zustand.ab.opt?.led_beleuchtung };
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

  if (kiAktiv() && (kameraZuruecksetzen || kiFotoblick)) kiFotoansicht(); // Fotoansicht folgt Höhe/Bildwinkel/Horizont
  else if (kameraZuruecksetzen && !foto) {
    const dist = Math.max(m.L, m.B) * 1.5 + 2;
    camera.position.set(-dist * 0.55, dist * 0.55, dist * 0.8);
    controls.target.set(0, -0.3, 0);
    controls.update();
  }
  if (panelNeuZeichnen) zeichnePanel();
  rendern(); kiHorizontLinie();
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

/** Lage von Skimmer, Düsen und Licht für die Technik außen am Becken (PP-Fertigbecken, GLB). */
function technikAussen(pool, m, ws, led) {
  const bel = einstiegsBelegung(m, zustand.einstieg, zustand.seite, daten.treppen._richtwerte), lr = daten.led_regel;
  return {
    skimmerAnzahl: skimmerAnzahl(m, daten.skimmer_regel), ws, led: !!led, ledTiefe: lr.unter_wasserspiegel_m,
    duesen: duesenOrte(m, duesenAnzahl(pool, m, daten.einlaufduesen_regel), bel, daten.einlaufduesen_regel),
    ledOrte: led ? ledOrte(m, zustand.ledSeite, zustand.ledLage, zustand.ledAnzahl, { xVon: -m.L / 2 + (m.form === 'oval' ? m.B / 2 : 0) + bel.tiefe + 0.3 }, lr.randabstand_m) : [],
  };
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
    ueBlock.push(regler('Öffnung der Überdachung', zustand.ueOeffnung, 0, 1, 0.02, (v, fertig) => { zustand.ueOeffnung = v; neuBauen(false, fertig); }));
  }
  root.append(abschnitt('Überdachung', ueBlock));

  // --- Abdeckung ---
  const abOpt = daten.abdeckungen.map((a) => { const st = abdeckungStatus(a, pool, m); return { wert: a.id, text: a.name, ok: st.ok, grund: st.grund }; });
  const aGew = daten.abdeckungen.find((a) => a.id === zustand.abdeckung);
  const abBlock = [auswahl('Abdeckung', [{ wert: '', text: 'Keine' }, ...abOpt], zustand.abdeckung, (v) => { zustand.abdeckung = v; zustand.ab = {}; neuBauen(); })];
  if (aGew) {
    abBlock.push(...abdeckungOptionen(aGew, m));
    abBlock.push(regler(aGew.id === 'waludeck_origin' ? 'Terrasse verschieben' : 'Öffnung der Abdeckung', zustand.abOeffnung, 0, 1, 0.02, (v, fertig) => { zustand.abOeffnung = v; neuBauen(false, fertig); }));
  }
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
    auswahl('Umgebung', [{ wert: 'rasen', text: 'Rasen (Garten)' }, { wert: 'frei', text: 'Freies 3D-Modell (ohne Rasen)' }, { wert: 'ki', text: 'KI-Garten aus einem Foto (3D, neu)' }, { wert: 'garten3d', text: 'Kundengarten 3D (Fotos, zum Umschauen)' }, { wert: 'foto', text: 'Fotomontage (ein Foto, feste Ansicht)' }], zustand.umgebung, (v) => {
      const vorher = zustand.umgebung; zustand.umgebung = v; if (v !== 'frei') zustand.schnitt = 'aus';
      neuBauen(vorher === 'foto' && v !== 'foto'); groesseAnpassen();
      if (v === 'foto' && !fotoBild()) $('foto-datei').click(); // gleich nach dem Foto fragen
      if (v === 'garten3d' && !gartenBilder().length) $('garten-dateien').click();
      if (v === 'ki') { if (!kiH()) $('ki-datei').click(); else kiFotoansicht(0); }
    }),
    zustand.umgebung === 'foto' ? fotoBedienung() : '',
    zustand.umgebung === 'garten3d' ? gartenBedienung() : '',
    zustand.umgebung === 'ki' ? kiBedienung() : '',
    zustand.umgebung === 'foto' || zustand.umgebung === 'ki' ? '' : pool.aufbau
      ? [auswahl('Schnitt durch das Becken', [{ wert: 'aus', text: 'Aus' }, { wert: 'quer', text: 'Querschnitt' }, { wert: 'laengs', text: 'Längsschnitt' }], zustand.schnitt,
          (v) => { zustand.schnitt = v; if (v !== 'aus') zustand.umgebung = 'frei'; neuBauen(); kameraAufSchnitt(); }),
        zustand.schnitt !== 'aus' ? [regler('Lage des Schnitts', zustand.schnittLage, 0.05, 0.95, 0.01, (v, fertig) => { zustand.schnittLage = v; neuBauen(false, fertig); if (!fertig) kameraAufSchnitt(); }),
          hinweis('Der Schnitt zeigt: ' + pool.aufbau.schichten.join(' · '))] : '']
      : hinweis('Einen Schnitt gibt es bei Systemstein-, Kompakt- und Polypropylen-Becken.'),
    auswahl('Qualität', [{ wert: 'niedrig', text: 'Niedrig (schnell)' }, { wert: 'mittel', text: 'Mittel' }, { wert: 'hoch', text: 'Hoch (Standard)' }, { wert: 'ultra', text: 'Ultra (sehr scharf, bewegtes Wasser)' }], qualitaet, (v) => { setzeQualitaet(v); }),
    hinweis(zustand.umgebung === 'foto' ? 'Bedienung: Pool mit der Maus oder dem Finger auf dem Foto verschieben. Mausrad = Pool drehen.' : 'Bedienung: Ziehen = drehen, Mausrad oder zwei Finger = zoomen, rechte Maustaste oder zwei Finger ziehen = verschieben.')));
  panel.scrollTop = scroll;
}

/** Bedienelemente für den Kundengarten 3D: Fotos verwalten, Projektion, Boden, Licht. */
function gartenBedienung() {
  const p = zustand.garten, bilder = gartenBilder();
  const r = (label, key, min, max, schritt) => regler(label, p[key], min, max, schritt, (v, fertig) => { p[key] = v; neuBauen(false, fertig); });
  const hinzu = el('button', { type: 'button', className: 'knopf', textContent: bilder.length ? 'Weitere Fotos hinzufügen …' : 'Gartenfotos laden (1–4 oder 360°-Panorama) …', disabled: bilder.length >= 4 });
  hinzu.addEventListener('click', () => $('garten-dateien').click());
  const liste = bilder.map((b, i) => {
    const sel = el('select', {}); RICHTUNGEN.forEach((x) => sel.add(new Option(x.text, x.wert)));
    sel.value = b.richtung; sel.disabled = b.panorama;
    sel.addEventListener('change', () => { bildRichtung(i, +sel.value); neuBauen(); });
    const weg = el('button', { type: 'button', className: 'knopf hell klein', textContent: 'Entfernen' });
    weg.addEventListener('click', () => { bildEntfernen(i); neuBauen(); });
    const vorschau = el('img', { src: b.img.src, alt: b.name, className: 'vorschau' });
    return el('div', { className: 'bildzeile' }, vorschau, el('div', {}, el('span', { textContent: b.panorama ? '360°-Panorama' : 'Blickrichtung:' }), b.panorama ? '' : sel), weg);
  });
  const zurueck = el('button', { type: 'button', className: 'knopf hell', textContent: 'Einstellungen zurücksetzen' });
  zurueck.addEventListener('click', () => { zustand.garten = { ...GARTEN_STANDARD }; neuBauen(); });
  return [
    el('div', { className: 'knoepfe' }, hinzu), ...liste,
    hinweis(bilder.length
      ? 'Die Fotos bleiben nur auf diesem Rechner. Sie werden nicht hochgeladen und nicht mit der Konfiguration gespeichert.'
      : 'So fotografieren: am späteren Pool-Standort stehen, Handy auf Augenhöhe und gerade halten, dann ein 360°-Panorama oder je ein Querformat-Foto nach vorn, rechts, hinten und links.'),
    bilder.length ? [
      el('h3', { textContent: 'Fotos einpassen' }),
      bilder.some((b) => b.panorama) ? '' : r('Bildwinkel der Fotos (°)', 'bildwinkel', 35, 120, 1),
      r('Horizont im Foto (oben → unten)', 'horizont', 0.2, 0.8, 0.01),
      r('Drehung der Umgebung (°)', 'drehung', -180, 180, 1),
      r('Aufnahmehöhe (m)', 'hoehe', 0.8, 4, 0.05),
      r('Entfernung der Umgebung (m)', 'radius', 12, 80, 1),
      el('h3', { textContent: 'Boden um den Pool' }),
      auswahl('Belag', [{ wert: 'rasen', text: 'Rasen' }, { wert: 'pflaster', text: 'Pflaster' }, { wert: 'kies', text: 'Kies' }, { wert: 'foto', text: 'Nur Foto (kein eigener Belag)' }], p.boden, (v) => { p.boden = v; neuBauen(); }),
      p.boden !== 'foto' ? r('Größe der Fläche (m)', 'bodenRadius', 4, 25, 0.5) : '',
      el('h3', { textContent: 'Licht passend zu den Fotos' }),
      r('Sonnenrichtung (°)', 'sonneRichtung', 0, 360, 1),
      r('Sonnenhöhe (°)', 'sonneHoehe', 5, 85, 1),
      r('Helligkeit', 'helligkeit', 0.4, 1.6, 0.02),
      el('div', { className: 'knoepfe' }, zurueck),
    ] : '',
  ];
}
$('garten-dateien').addEventListener('change', async (e) => {
  const dateien = [...e.target.files]; e.target.value = '';
  if (!dateien.length) return;
  try {
    const n = await bilderHinzu(dateien);
    zustand.umgebung = 'garten3d';
    neuBauen(true); groesseAnpassen();
    zeigeMeldung(n ? `${n} Foto(s) geladen. Mit der Maus umschauen; unter „Darstellung“ Blickrichtung, Horizont und Drehung anpassen.` : 'Es können höchstens 4 Fotos geladen werden.');
  } catch (err) { zeigeMeldung(err.message); }
});

/** Bedienelemente des Foto-Modus: Foto laden, Kamera an das Foto anpassen, Pool drehen, Sonne und Helligkeit. */
function fotoBedienung() {
  const f = zustand.foto;
  const r = (label, key, min, max, schritt) => regler(label, f[key], min, max, schritt, (v, fertig) => { f[key] = v; neuBauen(false, fertig); });
  const knopf = el('button', { type: 'button', className: 'knopf', textContent: fotoBild() ? 'Anderes Gartenfoto laden …' : 'Gartenfoto laden …' });
  knopf.addEventListener('click', () => $('foto-datei').click());
  const zurueck = el('button', { type: 'button', className: 'knopf hell', textContent: 'Einstellungen zurücksetzen' });
  zurueck.addEventListener('click', () => { zustand.foto = { ...FOTO_STANDARD }; neuBauen(); });
  return [
    el('div', { className: 'knoepfe' }, knopf),
    hinweis(fotoBild() ? 'Das Foto bleibt nur auf diesem Rechner. Es wird nicht hochgeladen und nicht mit der Konfiguration gespeichert.' : 'Noch kein Foto geladen. Am besten ein Querformat-Foto aus Augenhöhe, auf dem der Platz für den Pool gut zu sehen ist.'),
    el('h3', { textContent: 'Kamera an das Foto anpassen' }),
    r('Kamerahöhe (m)', 'hoehe', 0.5, 6, 0.05),
    r('Neigung nach unten (°)', 'neigung', 0, 70, 0.5),
    r('Bildwinkel (°)', 'bildwinkel', 25, 90, 0.5),
    hinweis('Tipp: Handyfotos haben meist 45 bis 55° Bildwinkel. Stimmt die Perspektive, sehen die Beckenkanten parallel zu Wegen, Zäunen oder Terrassen aus.'),
    el('h3', { textContent: 'Pool im Foto' }),
    r('Drehung des Pools (°)', 'drehung', -180, 180, 1),
    r('Entfernung (m)', 'z', -40, -2, 0.1),
    r('Seitlich (m)', 'x', -20, 20, 0.1),
    el('h3', { textContent: 'Licht passend zum Foto' }),
    r('Sonnenrichtung (°)', 'sonneRichtung', 0, 360, 1),
    r('Sonnenhöhe (°)', 'sonneHoehe', 5, 85, 1),
    r('Helligkeit', 'helligkeit', 0.4, 1.6, 0.02),
    r('Schattenstärke', 'schatten', 0, 0.9, 0.02),
    el('div', { className: 'knoepfe' }, zurueck),
  ];
}

// Pool im Foto mit Maus/Finger verschieben (Schnitt mit der Bodenebene), Mausrad dreht den Pool
const bodenEbene = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), strahl = new THREE.Raycaster();
let ziehen = null;
function bodenPunkt(e) {
  const r = canvas.getBoundingClientRect();
  strahl.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  return strahl.ray.intersectPlane(bodenEbene, new THREE.Vector3());
}
canvas.addEventListener('pointerdown', (e) => {
  if (zustand.umgebung === 'ki' && kiAktiv() && e.button === 0) { // im KI-Garten: messen oder Pool anfassen und verschieben
    const r = canvas.getBoundingClientRect();
    strahl.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    if (ki.messen?.aktiv) {
      const treffer = strahl.intersectObjects(kiGelaendeMeshes(), false)[0];
      if (treffer) { const pts = ki.messen.punkte; if (pts.length >= 2) pts.length = 0; pts.push(treffer.point.clone()); messAnzeigen(); if (pts.length === 2) zeichnePanel(); }
      e.stopImmediatePropagation(); return;
    }
    const ziele = [szene.pool, szene.rand].filter(Boolean);
    if (!strahl.intersectObjects(ziele, true).length) return;
    const p = bodenPunkt(e); if (!p) return;
    ziehen = { dx: zustand.ki.x - p.x, dz: zustand.ki.z - p.z, ki: true };
    e.stopImmediatePropagation(); // Kamerasteuerung bekommt diesen Klick nicht (sonst dreht sich die Ansicht mit)
    controls.enabled = false; canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (zustand.umgebung !== 'foto') return;
  const p = bodenPunkt(e); if (!p) return;
  ziehen = { dx: zustand.foto.x - p.x, dz: zustand.foto.z - p.z };
  canvas.setPointerCapture(e.pointerId);
}, { capture: true }); // capture: vor der Kamerasteuerung
canvas.addEventListener('pointermove', (e) => {
  if (!ziehen) return;
  const p = bodenPunkt(e); if (!p) return;
  if (ziehen.ki) {
    zustand.ki.x = THREE.MathUtils.clamp(p.x + ziehen.dx, -30, 30);
    zustand.ki.z = THREE.MathUtils.clamp(p.z + ziehen.dz, -60, 0);
  } else {
    zustand.foto.x = THREE.MathUtils.clamp(p.x + ziehen.dx, -20, 20);
    zustand.foto.z = THREE.MathUtils.clamp(p.z + ziehen.dz, -40, -2);
  }
  neuBauen(false, false);
});
const ziehenEnde = () => { if (ziehen) { const war = ziehen.ki; ziehen = null; if (war) controls.enabled = true; zeichnePanel(); } };
canvas.addEventListener('pointerup', ziehenEnde);
canvas.addEventListener('pointercancel', ziehenEnde);
canvas.addEventListener('wheel', (e) => {
  if (zustand.umgebung === 'ki' && e.shiftKey) { // Umschalt + Mausrad dreht den Pool im KI-Garten
    e.preventDefault(); e.stopImmediatePropagation();
    zustand.ki.drehung = ((zustand.ki.drehung + Math.sign(e.deltaY || e.deltaX) * 3 + 540) % 360) - 180;
    neuBauen(false, false); clearTimeout(canvas._t); canvas._t = setTimeout(zeichnePanel, 300);
    return;
  }
  if (zustand.umgebung !== 'foto') return;
  e.preventDefault();
  zustand.foto.drehung = ((zustand.foto.drehung + Math.sign(e.deltaY) * 3 + 540) % 360) - 180;
  neuBauen(false, false); clearTimeout(canvas._t); canvas._t = setTimeout(zeichnePanel, 300);
}, { passive: false, capture: true }); // capture: vor dem Zoom der Kamerasteuerung

// Foto-Datei auswählen
$('foto-datei').addEventListener('change', async (e) => {
  const d = e.target.files[0]; e.target.value = '';
  if (!d) return;
  try {
    const img = await fotoLaden(d);
    $('foto-bild').src = img.src;
    zustand.umgebung = 'foto';
    neuBauen(); groesseAnpassen();
    zeigeMeldung('Gartenfoto geladen. Jetzt Kamerahöhe, Neigung und Bildwinkel anpassen und den Pool auf die gewünschte Stelle ziehen.');
  } catch (err) { zeigeMeldung(err.message); }
});

/**
 * Lageplan (Draufsicht): Standort und Blickrichtung jedes Fotos als Punkt mit Blickkegel, dazu der Pool.
 * Punkt ziehen = Standort verschieben, Griff am Kegel ziehen = Blickrichtung drehen, Pool ziehen = Pool verschieben.
 */
const FOTO_FARBEN = ['#1f7fc4', '#e2730b', '#2a9d4b', '#b23a8f'];
function lageplanBlock() {
  const c = el('canvas', { className: 'lageplan', width: 560, height: 420 });
  const anzeige = { mass: 1, mx: 0, mz: 0 };
  const W = c.width, H = c.height;
  const welt2bild = (x, z) => [W / 2 + (x - anzeige.mx) * anzeige.mass, H / 2 + (z - anzeige.mz) * anzeige.mass];
  const bild2welt = (px, py) => [anzeige.mx + (px - W / 2) / anzeige.mass, anzeige.mz + (py - H / 2) / anzeige.mass];
  const griff = (b) => { const y = THREE.MathUtils.degToRad(b.yaw), l = 5; return [b.pos.x + Math.sin(y) * l, b.pos.z - Math.cos(y) * l]; };
  const zeichnen = () => {
    const pts = ki.bilder.flatMap((b) => [[b.pos.x, b.pos.z], griff(b)]);
    pts.push([zustand.ki.x, zustand.ki.z ?? -6]);
    const xs = pts.map((q) => q[0]), zs = pts.map((q) => q[1]);
    anzeige.mx = (Math.min(...xs) + Math.max(...xs)) / 2; anzeige.mz = (Math.min(...zs) + Math.max(...zs)) / 2;
    anzeige.mass = Math.min(W / (Math.max(...xs) - Math.min(...xs) + 8), H / (Math.max(...zs) - Math.min(...zs) + 8));
    const g = c.getContext('2d'); g.clearRect(0, 0, W, H); g.fillStyle = '#eef3e8'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(0,0,0,.07)'; g.lineWidth = 1;                               // 1-m-Raster
    const [x0, z0] = bild2welt(0, 0), [x1, z1] = bild2welt(W, H);
    for (let x = Math.ceil(x0); x <= x1; x++) { const [px] = welt2bild(x, 0); g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke(); }
    for (let z = Math.ceil(z0); z <= z1; z++) { const [, py] = welt2bild(0, z); g.beginPath(); g.moveTo(0, py); g.lineTo(W, py); g.stroke(); }
    // Pool
    const pool = poolDaten(), m = masse(pool, pool.groessen[zustand.groesseIdx]), dr = THREE.MathUtils.degToRad(zustand.ki.drehung);
    g.save(); const [ppx, ppy] = welt2bild(zustand.ki.x, zustand.ki.z ?? -6); g.translate(ppx, ppy); g.rotate(dr);
    g.fillStyle = 'rgba(46,159,216,.75)'; g.strokeStyle = '#0e4f80'; g.lineWidth = 2;
    g.beginPath(); g.roundRect(-m.L / 2 * anzeige.mass, -m.B / 2 * anzeige.mass, m.L * anzeige.mass, m.B * anzeige.mass, m.form === 'rechteck' ? 2 : m.B / 2 * anzeige.mass); g.fill(); g.stroke(); g.restore();
    // Fotos: Blickkegel, Standort, Griff
    ki.bilder.forEach((b, i) => {
      const [px, py] = welt2bild(b.pos.x, b.pos.z), y = THREE.MathUtils.degToRad(b.yaw), hw = THREE.MathUtils.degToRad(kiBildwinkel(b) / 2), l = 7 * anzeige.mass;
      g.fillStyle = FOTO_FARBEN[i] + '33'; g.strokeStyle = FOTO_FARBEN[i]; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.sin(y - hw) * l, py - Math.cos(y - hw) * l); g.lineTo(px + Math.sin(y + hw) * l, py - Math.cos(y + hw) * l); g.closePath(); g.fill(); g.stroke();
      const [gx, gy] = welt2bild(...griff(b));
      g.beginPath(); g.moveTo(px, py); g.lineTo(gx, gy); g.stroke();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(gx, gy, 6, 0, 7); g.fill(); g.stroke();             // Griff: Richtung
      g.fillStyle = FOTO_FARBEN[i]; g.beginPath(); g.arc(px, py, 8, 0, 7); g.fill();                     // Standort
      g.fillStyle = '#fff'; g.font = 'bold 11px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i + 1), px, py + 0.5);
    });
    g.fillStyle = '#5a6b77'; g.font = '11px system-ui'; g.textAlign = 'left'; g.fillText('1 Kästchen = 1 m', 8, H - 8);
  };
  let ziehen = null;
  const punkt = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)]; };
  c.addEventListener('pointerdown', (e) => {
    const [px, py] = punkt(e), nah = (x, z, r) => { const [qx, qy] = welt2bild(x, z); return Math.hypot(qx - px, qy - py) < r; };
    ki.bilder.forEach((b, i) => { if (!ziehen && nah(...griff(b), 10)) ziehen = { art: 'richtung', i }; });
    ki.bilder.forEach((b, i) => { if (!ziehen && nah(b.pos.x, b.pos.z, 11)) ziehen = { art: 'standort', i }; });
    if (!ziehen && nah(zustand.ki.x, zustand.ki.z ?? -6, 30)) ziehen = { art: 'pool' };
    if (ziehen) { ziehen.fest = { ...anzeige }; c.setPointerCapture(e.pointerId); e.preventDefault(); }
  });
  c.addEventListener('pointermove', (e) => {
    if (!ziehen) return;
    Object.assign(anzeige, ziehen.fest);                                               // Maßstab beim Ziehen festhalten
    const [x, z] = bild2welt(...punkt(e));
    if (ziehen.art === 'pool') { zustand.ki.x = x; zustand.ki.z = z; }
    else { const b = ki.bilder[ziehen.i];
      if (ziehen.art === 'standort') b.pos = { x, z };
      else b.yaw = THREE.MathUtils.radToDeg(Math.atan2(x - b.pos.x, -(z - b.pos.z)));
      b.quelle = 'hand'; }
    neuBauen(false, false); kiLageAnwenden();
    const g = c.getContext('2d'); const alt = { ...anzeige }; zeichnen(); Object.assign(anzeige, alt);
  });
  const ende = () => { if (!ziehen) return; ziehen = null; ki.envSchluessel = ''; neuBauen(); };
  c.addEventListener('pointerup', ende); c.addEventListener('pointercancel', ende);
  zeichnen();
  const gps = ki.bilder.every((b) => b.exif?.lat !== undefined && b.exif?.richtung !== undefined);
  const zurueck = el('button', { type: 'button', className: 'knopf hell', textContent: 'Lage wieder aus GPS und Kompass', disabled: !gps });
  zurueck.addEventListener('click', () => { kiLageAusFotodaten(); ki.envSchluessel = ''; neuBauen(); });
  return [
    el('h3', { textContent: 'Lageplan der Fotos' }),
    hinweis(gps ? 'Standorte und Blickrichtungen kommen aus GPS und Kompass der Fotos (auf ca. 2–5 m bzw. 5–10° genau). Zum Feinjustieren: farbigen Punkt ziehen = Standort, weißen Griff ziehen = Blickrichtung, Pool ziehen = verschieben.'
      : 'Die Fotos haben keine GPS-/Kompassdaten. Standort (farbiger Punkt) und Blickrichtung (weißer Griff) bitte so ziehen, wie die Fotos aufgenommen wurden.'),
    c, el('div', { className: 'knoepfe' }, zurueck),
  ];
}

/** Bedienelemente des KI-Gartens. */
function kiBedienung() {
  const p = zustand.ki, h = kiH();
  const r = (label, key, min, max, schritt, wert = p[key]) => regler(label, wert, min, max, schritt, (v, fertig) => { p[key] = v; neuBauen(false, fertig); });
  const knopf = (text, fn, hell = false) => { const b = el('button', { type: 'button', className: 'knopf' + (hell ? ' hell' : ''), textContent: text }); b.addEventListener('click', fn); return b; };
  const auto = schalter('Horizont automatisch erkennen', p.horizontAuto, (v) => { p.horizontAuto = v; if (!v && h?.kalib) p.horizont = +h.kalib.horizont.toFixed(3); neuBauen(); });
  if (!h) return [
    el('div', { className: 'knoepfe' }, knopf('Gartenfoto(s) laden …', () => $('ki-datei').click())),
    hinweis('Ein Foto genügt: Querformat, aus Augenhöhe, mit dem Platz für den Pool und etwas Horizont. Für ein Rundum-Ergebnis vom selben Standpunkt weitere Fotos nach rechts, links und hinten aufnehmen (bis zu 4). Alles läuft lokal, ohne Internet.'),
  ];
  // Fotoliste: Vorschau, Blickrichtung, Ansicht, Entfernen
  const liste = ki.bilder.map((b, i) => {
    const vorschau = el('img', { src: b.url, alt: b.name, className: 'vorschau' });
    const info = el('div', {}, el('span', { textContent: i === 0 ? 'Hauptfoto' : `Foto ${i + 1}` }),
      el('span', { className: 'klein-info', textContent: b.exif?.f35 ? `${b.exif.f35} mm (KB) → ${komma(kiBildwinkel(b).toFixed(1))}°` : 'Bildwinkel: Regler' }));
    info.append(regler(`Kippung Foto ${i + 1} (°)`, b.kippung ?? 0, -15, 15, 0.5, (v, fertig) => { b.kippung = v; if (fertig) neuBauen(false, true); }));
    const knoepfe = el('div', { className: 'bild-knoepfe' }, knopf('Ansicht', () => kiFotoansicht(i), true), i > 0 ? knopf('Entfernen', () => { const [x] = ki.bilder.splice(i, 1); URL.revokeObjectURL(x.url); kiFotoIndex = 0; ki.schluessel = ''; neuBauen(); kiFotoansicht(0); }, true) : '');
    return el('div', { className: 'bildzeile' }, vorschau, info, knoepfe);
  });
  const messen = ki.messen ?? (ki.messen = { aktiv: false, punkte: [] });
  const gemessen = messen.punkte.length === 2 ? messen.punkte[0].distanceTo(messen.punkte[1]) : null;
  const laengeFeld = el('input', { type: 'number', min: '0.1', step: '0.01', placeholder: 'z. B. 0,60', id: 'mess-laenge' });
  const messBlock = [
    el('h3', { textContent: 'Maßstab nachmessen (empfohlen)' }),
    hinweis('Zwei Punkte im Bild anklicken, deren echten Abstand du kennst – z. B. Kanten einer Terrassenplatte, Zaunfeld, Hauswandlänge. Danach die echte Länge eingeben: Der ganze Garten wird exakt darauf skaliert.'),
    el('div', { className: 'knoepfe' }, knopf(messen.aktiv ? 'Messen beenden' : 'Zwei Punkte anklicken', () => { messen.aktiv = !messen.aktiv; if (messen.aktiv) messen.punkte.length = 0; messAnzeigen(); zeichnePanel(); }, !messen.aktiv)),
    gemessen ? [hinweis(`Gemessen: ${komma(gemessen.toFixed(2))} m`), el('label', { htmlFor: 'mess-laenge', textContent: 'Echte Länge (m)' }), laengeFeld,
      el('div', { className: 'knoepfe' }, knopf('Maßstab übernehmen', () => {
        const echt = parseFloat(String(laengeFeld.value).replace(',', '.'));
        if (!(echt > 0)) { zeigeMeldung('Bitte eine echte Länge in Metern eingeben.'); return; }
        const f = echt / gemessen;
        p.hoehe = THREE.MathUtils.clamp(p.hoehe * f, 0.3, 12);   // Maßstab des ganzen Geländes ist proportional zur Kamerahöhe
        p.z = p.z !== null ? p.z * f : null; p.x *= f;
        messen.punkte.forEach((pt) => pt.multiplyScalar(f)); messen.aktiv = false;
        neuBauen(); messAnzeigen(); kiFotoansicht(kiFotoIndex);
        zeigeMeldung(`Maßstab übernommen: Faktor ${komma(f.toFixed(3))}, Kamerahöhe jetzt ${komma(p.hoehe.toFixed(2))} m.`);
      }))] : (messen.aktiv ? hinweis(messen.punkte.length ? 'Jetzt den zweiten Punkt anklicken.' : 'Ersten Punkt im Bild anklicken.') : ''),
  ];
  return [
    el('div', { className: 'knoepfe' }, knopf(ki.bilder.length < 4 ? 'Weiteres Foto hinzufügen …' : 'Maximal 4 Fotos', () => { if (ki.bilder.length < 4) $('ki-datei-weitere').click(); }),
      knopf('Neu beginnen (anderes Hauptfoto) …', () => $('ki-datei').click(), true)),
    ...liste,
    ki.bilder.length > 1 ? lageplanBlock() : '',
    hinweis(`Tiefe lokal berechnet (${ki.bilder.map((b) => komma((b.tiefe.ms / 1000).toFixed(1)) + ' s').join(', ')}). Die Fotos bleiben nur auf diesem Rechner.`),
    hinweis('Bedienung: Ziehen = umschauen, Mausrad = zoomen. Den Pool direkt anfassen und verschieben, Umschalt + Mausrad dreht ihn.'),
    el('h3', { textContent: 'Pool im Garten' }),
    r('Drehung des Pools (°)', 'drehung', -180, 180, 1),
    r('Seitlich (m)', 'x', -30, 30, 0.1),
    r('Entfernung (m)', 'z', -60, 0, 0.1, p.z ?? -8),
    ...messBlock,
    el('h3', { textContent: 'Foto vermessen' }),
    r('Kamerahöhe beim Fotografieren (m)', 'hoehe', 0.3, 12, 0.01),
    h.exif?.f35 ? hinweis(`Bildwinkel aus den Fotodaten: ${komma(kiBildwinkel(h).toFixed(1))}° (${h.exif.f35} mm Kleinbild${h.exif.modell ? ', ' + h.exif.modell : ''}).`) : r('Bildwinkel des Fotos (°)', 'bildwinkel', 35, 100, 0.5),
    auto,
    p.horizontAuto ? hinweis(h.kalib?.sicher ? `Erkannter Horizont: ${Math.round(h.kalib.horizont * 100)} % von oben (Boden sicher erkannt).` : 'Boden im Foto nicht sicher erkannt – Horizont geschätzt. Bitte „automatisch“ ausschalten und den Horizont von Hand einstellen.') : r('Horizont im Foto (oben → unten)', 'horizont', 0.05, 0.95, 0.005),
    r('Entfernungen strecken', 'tiefe', 0.5, 2, 0.02),
    el('h3', { textContent: 'Licht passend zum Foto' }),
    r('Sonnenrichtung (°)', 'sonneRichtung', 0, 360, 1),
    r('Sonnenhöhe (°)', 'sonneHoehe', 5, 85, 1),
    r('Helligkeit', 'helligkeit', 0.4, 1.6, 0.02),
    r('Schattenstärke', 'schatten', 0, 0.9, 0.02),
    el('div', { className: 'knoepfe' }, knopf('Zur Ansicht des Hauptfotos', () => kiFotoansicht(0), true), knopf('Einstellungen zurücksetzen', () => { zustand.ki = { ...KI_STANDARD }; neuBauen(true); }, true)),
    hinweis('Grenze: Fotos zeigen nur die Vorderseite der Dinge. Weit weggedreht erscheinen hinter Bäumen oder Hausecken aufgefüllte oder gestreckte Stellen. Mehr Fotos vom selben Standpunkt verbessern das Rundum-Ergebnis.'),
  ];
}

/** Ein Foto laden (HEIC nur, wo der Browser es kann), auf max. 4096 px verkleinern, Tiefe berechnen, Aufnahmedaten lesen. */
async function kiFotoVerarbeiten(d, nummer) {
  if (!d.type.startsWith('image/') && !istHeic(d)) throw new Error(`„${d.name}“ ist kein Bild.`);
  const roh = URL.createObjectURL(d);
  let url = roh;
  try {
    let img = await new Promise((ok, f) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => f(new Error(istHeic(d)
      ? `„${d.name}“ ist ein HEIC-Foto (iPhone). Dieser Browser kann HEIC nicht öffnen – bitte Safari verwenden oder die Fotos als JPG speichern (iPhone: Einstellungen › Kamera › Formate › „Maximale Kompatibilität“).`
      : `„${d.name}“ konnte nicht geöffnet werden.`)); i.src = roh; });
    const max = 4096;
    if (Math.max(img.naturalWidth, img.naturalHeight) > max) { // sehr große Handyfotos verkleinern (Grafikspeicher, Rechenzeit)
      const f = max / Math.max(img.naturalWidth, img.naturalHeight), c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * f); c.height = Math.round(img.naturalHeight * f);
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, c.width, c.height);
      url = URL.createObjectURL(await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.92)));
      URL.revokeObjectURL(roh);
      img = await new Promise((ok, f2) => { const i = new Image(); i.onload = () => ok(i); i.onerror = f2; i.src = url; });
    }
    const exif = await exifLesen(d);
    zeigeMeldung(`Foto ${nummer}: Die KI berechnet die Tiefe (lokal, einige Sekunden) …`);
    const rohTiefe = await tiefeSchaetzen(img, (t) => zeigeMeldung(`Foto ${nummer}: ${t}`));
    const tiefe = { ...tiefeVerfeinern(rohTiefe, img), ms: rohTiefe.ms };
    return { bild: img, url, name: d.name, exif, tiefe, yaw: 0, pos: { x: 0, z: 0 }, kippung: 0, kalib: null };
  } catch (err) { URL.revokeObjectURL(url); throw err; }
}
$('ki-datei').addEventListener('change', async (e) => { // neu beginnen: erstes Foto = Hauptfoto, weitere ausgewählte Fotos folgen
  const dateien = [...e.target.files].slice(0, 4); e.target.value = '';
  if (!dateien.length) return;
  try {
    const neu = [];
    for (let i = 0; i < dateien.length; i++) neu.push(await kiFotoVerarbeiten(dateien[i], i + 1));
    ki.bilder.forEach((b) => URL.revokeObjectURL(b.url));
    neu.forEach((b, i) => { b.yaw = [0, 90, -90, 180][i]; });
    ki.bilder = neu;
    const ausGps = kiLageAusFotodaten(); ki.schluessel = ''; ki.envSchluessel = ''; ki.messen = null; messAnzeigen(); kiFotoIndex = 0;
    zustand.umgebung = 'ki'; zustand.ki.z = null; zustand.ki.x = 0; zustand.schnitt = 'aus';
    neuBauen(true); kiFotoansicht(0);
    zeigeMeldung(`3D-Garten aus ${neu.length} Foto(s) erstellt${neu[0].exif?.f35 ? ', Bildwinkel aus den Fotodaten' : ''}${neu.length > 1 ? (ausGps ? ', Lage aus GPS und Kompass' : ' – bitte die Lage im Lageplan einstellen') : ''}. Für exakten Maßstab: „Maßstab nachmessen“.`);
  } catch (err) { console.error(err); zeigeMeldung('Die KI-Berechnung ist fehlgeschlagen: ' + (err.message || err)); }
});
$('ki-datei-weitere').addEventListener('change', async (e) => { // weiteres Foto vom selben Standpunkt hinzufügen
  const dateien = [...e.target.files].slice(0, 4 - ki.bilder.length); e.target.value = '';
  try {
    for (const d of dateien) {
      const b = await kiFotoVerarbeiten(d, ki.bilder.length + 1);
      const belegt = ki.bilder.map((x) => x.yaw);
      b.yaw = [90, -90, 180, 45, -45].find((w) => !belegt.includes(w)) ?? 0;
      ki.bilder.push(b);
    }
    kiLageAusFotodaten();
    ki.schluessel = ''; neuBauen(); kiFotoansicht(ki.bilder.length - 1);
    zeigeMeldung(ki.bilder.every((b) => b.exif?.lat !== undefined) ? 'Foto hinzugefügt, Lage aus GPS und Kompass. Im Lageplan bei Bedarf nachschieben.' : 'Foto hinzugefügt. Im Lageplan Standort und Blickrichtung einstellen.');
  } catch (err) { console.error(err); zeigeMeldung('Die KI-Berechnung ist fehlgeschlagen: ' + (err.message || err)); }
});

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

/** Rendert ein Bild in höherer Auflösung (im Foto-Modus zusammen mit dem Foto) und stellt danach die Qualität wieder her. */
function bildAufnehmen() {
  const s = renderer.getSize(new THREE.Vector2());
  renderer.setPixelRatio(2);
  renderer.setSize(s.x, s.y, false);
  bildRendern();
  const quelle = zustand.umgebung === 'foto' && fotoBild() ? fotoZusammensetzen(canvas) : canvas;
  const url = quelle.toDataURL('image/png');
  const blob = new Promise((ok) => quelle.toBlob(ok, 'image/png'));
  renderer.setPixelRatio(QUALITAET[qualitaet].pixel);
  renderer.setSize(s.x, s.y, false);
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
    const led = zustand.led ? ledListe(daten, pool).liste.find((l) => l.id === zustand.led) : null;
    const koerper = szene.sockel || baueKoerper(m, pool.aufbau, rand, technikAussen(pool, m, -(zustand.premiumSkimmer ? daten.zubehoer.premium_skimmer.wasserstand_unter_kante_cm : daten.zubehoer.standard_skimmer.wasserstand_unter_kante_cm) / 100, led));
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
    ['Einlaufdüsen', `${duesenAnzahl(pool, m, daten.einlaufduesen_regel)} Stück, gegenüber dem Skimmer`],
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
    setzeQualitaet('hoch');
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
