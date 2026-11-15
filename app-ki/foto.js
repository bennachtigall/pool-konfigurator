// Garten-Foto-Modus: Der Pool wird perspektivisch in ein Foto des Kundengartens gesetzt.
// Das Foto wird nur lokal im Browser geöffnet (Objekt-URL), nie hochgeladen und nicht mit der Konfiguration gespeichert.
//
// Prinzip: Die Kamera steht im Ursprung (Augenhöhe = Kamerahöhe) und blickt mit einer Neigung nach unten.
// Der Boden ist unsichtbar: eine reine Tiefen-Fläche (verdeckt die Außenseiten des Beckens unter der Erde)
// und eine Schattenfläche (Pool, Überdachung usw. werfen Schatten auf das Foto).
import * as THREE from 'three';
import { umrissPunkte, flaecheGeo } from './pool.js';

export const FOTO_STANDARD = { hoehe: 1.7, neigung: 14, bildwinkel: 50, x: 0, z: -9, drehung: 0, sonneRichtung: 210, sonneHoehe: 45, helligkeit: 1, schatten: 0.45 };

let bild = null;       // HTMLImageElement des geladenen Fotos
let bildUrl = null;    // Objekt-URL (wird beim Wechsel freigegeben)

/** Lädt ein Foto (File) lokal und gibt das Bild zurück. */
export function fotoLaden(datei) {
  return new Promise((ok, fehler) => {
    if (!datei.type.startsWith('image/')) { fehler(new Error('Die Datei ist kein Bild.')); return; }
    const url = URL.createObjectURL(datei), img = new Image();
    img.onload = () => { if (bildUrl) URL.revokeObjectURL(bildUrl); bild = img; bildUrl = url; ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url); fehler(new Error('Das Bild konnte nicht geöffnet werden.')); };
    img.src = url;
  });
}
export const fotoBild = () => bild;

/** Rechteck, in dem das Foto ohne Verzerrung in den Ansichtsbereich passt (Seitenverhältnis des Fotos). */
export function fotoRechteck(breite, hoehe) {
  if (!bild) return { left: 0, top: 0, width: breite, height: hoehe };
  const r = bild.naturalWidth / bild.naturalHeight;
  let w = breite, h = breite / r;
  if (h > hoehe) { h = hoehe; w = hoehe * r; }
  return { left: Math.round((breite - w) / 2), top: Math.round((hoehe - h) / 2), width: Math.round(w), height: Math.round(h) };
}

/** Stellt die Kamera nach den Foto-Parametern ein. */
export function fotoKamera(camera, p) {
  camera.position.set(0, p.hoehe, 0);
  camera.rotation.set(-THREE.MathUtils.degToRad(p.neigung), 0, 0, 'YXZ');
  camera.fov = p.bildwinkel;
  camera.updateProjectionMatrix();
}

/** Unsichtbarer Boden: Tiefen-Fläche + Schattenfläche, beide mit Aussparung für das Becken. */
export function fotoBoden(m, off, schattenStaerke) {
  const g = new THREE.Group(), gross = 200;
  const aussen = [new THREE.Vector2(-gross, -gross), new THREE.Vector2(gross, -gross), new THREE.Vector2(gross, gross), new THREE.Vector2(-gross, gross)];
  const geo = new THREE.ShapeGeometry(flaecheGeo(aussen, [umrissPunkte(m, off)])).rotateX(-Math.PI / 2);
  const tiefe = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ colorWrite: false })); // schreibt nur Tiefe
  tiefe.renderOrder = -1; tiefe.position.y = -0.003;
  const schatten = new THREE.Mesh(geo, new THREE.ShadowMaterial({ opacity: schattenStaerke }));
  schatten.receiveShadow = true; schatten.position.y = -0.002;
  g.add(tiefe, schatten);
  return g;
}

/** Sonnenrichtung aus Winkeln (Grad). */
export function sonnenRichtung(p) {
  return new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - p.sonneHoehe), THREE.MathUtils.degToRad(p.sonneRichtung));
}

/** Setzt Foto + 3D-Bild zu einem PNG zusammen (für Screenshot und Zusammenfassung). */
export function fotoZusammensetzen(canvas) {
  const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
  const g = c.getContext('2d');
  if (bild) g.drawImage(bild, 0, 0, c.width, c.height);
  g.drawImage(canvas, 0, 0);
  return c;
}
