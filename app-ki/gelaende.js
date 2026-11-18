// KI-Garten: aus einem Foto und seiner geschätzten Tiefe wird ein 3D-Gelände gebaut, in das der Pool eingesetzt wird.
//
// Ablauf:
//  1. Disparität (relative inverse Tiefe) vom KI-Modell (tiefe.js).
//  2. Kalibrierung: Der untere Bildteil gilt als Boden. Aus dem Verlauf der Disparität dort und der Disparität
//     „unendlich weit“ (Himmel/Ferne) folgt der Horizont und damit die Neigung der Kamera. Mit der Kamerahöhe
//     ergibt sich der Maßstab in Metern. Alles lässt sich über Regler nachjustieren.
//  3. Gitter-Mesh in Weltkoordinaten (Boden = y 0, Kamera bei y = Kamerahöhe), Foto als Textur.
//     An Tiefensprüngen (Baum vor Himmel) wird das Gitter aufgetrennt, damit nichts „verschmiert“.
//  4. Im Bereich des Pools wird das Gelände ausgespart und ringsum eingeebnet (Shader), damit der Pool
//     wirklich im Boden sitzt. Schatten fallen über eine zweite, transparente Schattenschicht aufs Gelände.
import * as THREE from 'three';

export const KI_STANDARD = {
  hoehe: 1.6,          // Kamerahöhe beim Fotografieren (m)
  bildwinkel: 66,      // horizontaler Bildwinkel (°), typisches Handy-Hauptobjektiv im Querformat
  horizontAuto: true,  // Horizont aus der Tiefe schätzen
  horizont: 0.42,      // Horizontlinie im Bild (0 = oben, 1 = unten), wenn nicht automatisch
  tiefe: 1,            // Entfernungen strecken/stauchen
  ferne: 90,           // ab hier gilt alles als Hintergrund (m)
  x: 0, z: null, drehung: 0, // Lage des Pools (z null = automatisch vor der Kamera)
  sonneRichtung: 210, sonneHoehe: 45, helligkeit: 1, schatten: 0.5,
};

/** Bilineare Abtastung der Disparität an Bildkoordinaten u, v (0..1). */
function abtasten(t, u, v) {
  const x = Math.min(Math.max(u * (t.breite - 1), 0), t.breite - 1), y = Math.min(Math.max(v * (t.hoehe - 1), 0), t.hoehe - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, t.breite - 1), y1 = Math.min(y0 + 1, t.hoehe - 1);
  const fx = x - x0, fy = y - y0, d = t.daten, w = t.breite;
  return (d[y0 * w + x0] * (1 - fx) + d[y0 * w + x1] * fx) * (1 - fy) + (d[y1 * w + x0] * (1 - fx) + d[y1 * w + x1] * fx) * fy;
}
function perzentil(arr, p) { const a = Float32Array.from(arr).sort(); return a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))]; }

/**
 * Kalibriert Kamera und Maßstab.
 * Rückgabe: { neigung (rad, negativ = nach unten), tanX, tanY, dUnendlich, s (Maßstab: 1/z = s·(d − dUnendlich)), horizont (0..1) }
 */
export function kalibrieren(t, seitenverh, p) {
  const tanX = Math.tan(THREE.MathUtils.degToRad(p.bildwinkel / 2)), tanY = tanX / seitenverh;
  // Disparität „unendlich weit“: sehr kleiner Wert im Bild (Himmel, Ferne)
  const dUnendlich = perzentil(t.daten, 0.01);
  // Bodenerkennung (robust, RANSAC): Auf einer ebenen Bodenfläche ist die Disparität linear in den Bildkoordinaten:
  // d = α·b + γ·a + β (b = Bildhöhe, a = Bildbreite; α < 0: weiter unten = näher). γ ≠ 0 bedeutet, dass das Foto
  // seitlich gekippt ist (Horizont schräg). Senkrechte Flächen (Wände, Hecken) haben kaum Gefälle und fallen heraus.
  const alle = [];
  for (let v = 0.45; v <= 0.985; v += 0.0125) for (let u = 0.04; u <= 0.96; u += 0.024) alle.push([u, v, abtasten(t, u, v), (1 - 2 * v) * tanY, (2 * u - 1) * tanX]);
  const spanne = Math.max(1e-6, t.max - t.min), tol = 0.025 * spanne;
  let besteN = 0, beste = null;
  let zufall = 12345; const rnd = () => ((zufall = (zufall * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); // reproduzierbar
  const ebene3 = (A, B, C) => { // d = α b + γ a + β durch drei Punkte
    const m = [[A[3], A[4], 1, A[2]], [B[3], B[4], 1, B[2]], [C[3], C[4], 1, C[2]]];
    for (let i = 0; i < 3; i++) { let p = i; for (let k = i + 1; k < 3; k++) if (Math.abs(m[k][i]) > Math.abs(m[p][i])) p = k; [m[i], m[p]] = [m[p], m[i]]; if (Math.abs(m[i][i]) < 1e-9) return null;
      for (let k = 0; k < 3; k++) if (k !== i) { const f = m[k][i] / m[i][i]; for (let j = i; j < 4; j++) m[k][j] -= f * m[i][j]; } }
    return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
  };
  for (let it = 0; it < 600; it++) {
    const e = ebene3(alle[(rnd() * alle.length) | 0], alle[(rnd() * alle.length) | 0], alle[(rnd() * alle.length) | 0]);
    if (!e) continue;
    const [al, ga] = e; if (!(al < -0.4 * spanne) || Math.abs(ga) > Math.abs(al) * 0.4) continue; // deutliches Gefälle, Kippung < ca. 22°
    let n = 0, unten = 0;
    for (const q of alle) if (Math.abs(q[2] - (al * q[3] + ga * q[4] + e[2])) < tol) { n++; if (q[1] > 0.8) unten++; }
    const wert = n + unten * 0.5;                                                       // Boden liegt meist unten im Bild
    if (wert > besteN) { besteN = wert; beste = e; }
  }
  let proben = alle.filter((q) => beste && Math.abs(q[2] - (beste[0] * q[3] + beste[1] * q[4] + beste[2])) < tol);
  // Plausibilität: Boden muss breit genug sein und über einen größeren Bildbereich laufen
  const vs = proben.map((q) => q[1]), us = proben.map((q) => q[0]);
  let sicher = proben.length > alle.length * 0.12 && Math.max(...vs) - Math.min(...vs) > 0.15 && Math.max(...us) - Math.min(...us) > 0.4;
  if (!sicher) proben = alle.filter((q) => q[1] > 0.8 && q[0] > 0.2 && q[0] < 0.8);   // Notlösung: unterer Bildrand
  // Kippung aus der Ebene: tan(roll) = −γ/α (Kleinste-Quadrate über die Bodenproben)
  let roll = 0;
  if (sicher && p.horizontAuto) {
    let A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], y = [0, 0, 0];
    for (const q of proben) { const r = [q[3], q[4], 1]; for (let i = 0; i < 3; i++) { y[i] += r[i] * q[2]; for (let j = 0; j < 3; j++) A[i][j] += r[i] * r[j]; } }
    const det = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    const D = det(A), ers = (k) => A.map((z, i) => z.map((w, j) => (j === k ? y[i] : w)));
    if (Math.abs(D) > 1e-12) { const al = det(ers(0)) / D, ga = det(ers(1)) / D; roll = THREE.MathUtils.clamp(Math.atan(-ga / al), -0.35, 0.35); }
  }
  roll += THREE.MathUtils.degToRad(p.kippung ?? 0);                                    // Korrektur von Hand
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const bAuf = (q) => -q[4] * sr + q[3] * cr;                                         // Bildhöhe nach Ausgleich der Kippung
  let neigung;
  if (p.horizontAuto && sicher) {
    let sb = 0, sd = 0, sbb = 0, sbd = 0;
    for (const q of proben) { const b = bAuf(q), d = q[2]; sb += b; sd += d; sbb += b * b; sbd += b * d; }
    const n = proben.length, alpha = (n * sbd - sb * sd) / (n * sbb - sb * sb), beta = (sd - alpha * sb) / n;
    const bH = (dUnendlich - beta) / alpha;                                           // Bildhöhe des Horizonts
    neigung = -Math.atan(bH);
    // Handyfotos aus Augenhöhe sind selten stärker als 30° nach unten oder 8° nach oben geneigt
    if (!(neigung > THREE.MathUtils.degToRad(-30) && neigung < THREE.MathUtils.degToRad(8))) sicher = false;
  }
  if (!(p.horizontAuto && sicher)) {
    // ohne sicheren Boden: Horizont aus dem Regler (Standard: knapp über der Bildmitte, typisch beim Fotografieren)
    neigung = -Math.atan((1 - 2 * (p.horizontAuto ? 0.45 : p.horizont)) * tanY);
  }
  const horizont = THREE.MathUtils.clamp((1 - Math.tan(-neigung) / tanY) / 2, 0, 1);
  // Maßstab: echte inverse Tiefe des Bodens (aus Neigung + Kamerahöhe) gegen Disparität, Ursprung bei dUnendlich
  const c = Math.cos(neigung), sn = Math.sin(neigung);
  let zaehler = 0, nenner = 0;
  for (const q of proben) {
    const d = q[2], b = bAuf(q), inv = -(b * c + sn) / p.hoehe;                    // 1 / planare Tiefe
    if (inv <= 0) continue;
    const x = d - dUnendlich; zaehler += x * inv; nenner += x * x;
  }
  const s = nenner > 0 ? (zaehler / nenner) / p.tiefe : 0.01;
  return { neigung, roll, tanX, tanY, dUnendlich, s, horizont, sicher, bodenAnteil: proben.length / alle.length };
}

/** Planare Tiefe (m) an Bildkoordinaten u, v. */
export const tiefeBei = (t, k, p, u, v) => {
  const inv = k.s * (abtasten(t, u, v) - k.dUnendlich);
  return inv > 1 / p.ferne ? Math.max(0.3, 1 / inv) : p.ferne;
};

/** Weltpunkt zu Bildkoordinaten u, v und planarer Tiefe z. Kamera bei (0, Höhe, 0), Blick nach −z. */
export function weltPunkt(k, p, u, v, z, ziel) {
  const a = (2 * u - 1) * k.tanX, b = (1 - 2 * v) * k.tanY, cr = Math.cos(k.roll ?? 0), sr = Math.sin(k.roll ?? 0);
  const xc = (a * cr + b * sr) * z, yc = (-a * sr + b * cr) * z, zc = -z;            // Kippung ausgleichen
  const c = Math.cos(k.neigung), s = Math.sin(k.neigung);
  return ziel.set(xc, yc * c - zc * s + p.hoehe, yc * s + zc * c);
}

/** Abstand (m) des Bodenpunkts geradeaus in der Bildmitte unten – für die Startlage des Pools. */
export function bodenAbstand(k, p, v = 0.8) {
  const b = (1 - 2 * v) * k.tanY * Math.cos(k.roll ?? 0), inv = -(b * Math.cos(k.neigung) + Math.sin(k.neigung)) / p.hoehe;
  return inv > 0 ? 1 / inv : 10;
}

/** Aussparung + Einebnung rund um den Pool (gemeinsamer Shader-Teil für Foto- und Schattenschicht). */
const poolUniforms = () => ({
  uPoolInv: { value: new THREE.Matrix4() }, uHalb: { value: new THREE.Vector2(3, 2) }, uRadius: { value: 0 },
  uRand: { value: 1.2 }, uAktiv: { value: 0 },
  // mehrere Fotos: Kamerastandorte (x, z, Blick-x, Blick-z)
  uKams: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) }, uKamAnzahl: { value: 0 }, uKamHoehe: { value: 1.6 },
  // welches Foto gezeigt wird: A, beim Überblenden zusätzlich B mit Anteil uMisch (0 = nur A, 1 = nur B)
  uZeigeA: { value: 0 }, uZeigeB: { value: 0 }, uMisch: { value: 0 },
});
/** Uniforms eines Fotos: gemeinsame Werte (Pool, Kameras, Auswahl) plus eigene Nummer und Schicht. */
export const fotoUniforms = (gemeinsam, nr, schicht = {}) => ({ ...gemeinsam, uIch: { value: nr }, uVorhang: { value: schicht.vorhang ? 1 : 0 } });
/**
 * Shader-Ergänzung für alle Schichten eines Fotos:
 *  – Immer nur EIN Foto ist sichtbar (beim Wechsel zwei, fein gerastert überblendet). Es werden nie Bruchstücke
 *    verschiedener Fotos gemischt – die passen in der Tiefe nie ganz genau zusammen und wirken wie Fremdkörper.
 *  – Becken-Aussparung und Einebnung: Bodenpunkte rund um den Pool werden ENTLANG DES SEHSTRAHLS der Fotokamera
 *    auf Bodenhöhe gelegt. So bleibt das Foto aus seiner Ansicht Bildpunkt für Bildpunkt unverändert, egal wo der
 *    Pool steht – nichts „wandert“ beim Verschieben mit.
 *  – „Vorhänge“ (Flächen an Tiefensprüngen, z. B. zwischen Busch und Rasen dahinter) sind nur sichtbar, solange man
 *    nahe der Fotoposition schaut (Präsentation); weiter weg verschwinden sie, dahinter liegt der ergänzte Hintergrund.
 */
function poolShader(mat, uniforms) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    const kopf = `
      uniform mat4 uPoolInv; uniform vec2 uHalb; uniform float uRadius; uniform float uRand; uniform float uAktiv;
      uniform vec4 uKams[4]; uniform int uKamAnzahl; uniform float uKamHoehe; uniform int uIch;
      uniform int uZeigeA; uniform int uZeigeB; uniform float uMisch; uniform float uVorhang;
      varying vec3 vWelt;
      vec3 fotoKamera() { return vec3(uKams[uIch].x, uKamHoehe, uKams[uIch].y); }
      float rausch(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
      float poolSdf(vec3 w) { vec2 q = (uPoolInv * vec4(w, 1.0)).xz; vec2 d = abs(q) - (uHalb - uRadius); return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - uRadius; }`;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + kopf)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        if (uAktiv > 0.5) { // Boden rund um den Pool einebnen – entlang des Sehstrahls der Fotokamera
          vec3 w0 = (modelMatrix * vec4(transformed, 1.0)).xyz;
          float f = 1.0 - smoothstep(0.0, uRand, poolSdf(w0));
          if (f > 0.0 && abs(w0.y) < 0.25) {
            vec3 c = fotoKamera(); vec3 wb = c + (w0 - c) * (c.y / max(c.y - w0.y, 0.001));
            transformed += transpose(mat3(modelMatrix)) * ((wb - w0) * f);
          }
        }`)
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWelt = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + kopf)
      .replace('void main() {', `void main() {
        if (uAktiv > 0.5 && poolSdf(vWelt) < 0.0 && vWelt.y < 0.6) discard; // Loch für das Becken
        if (uKamAnzahl > 1) { // nur das gewählte Foto (beim Wechsel: zwei, gerastert überblendet)
          if (uIch != uZeigeA && uIch != uZeigeB) discard;
          if (uZeigeA != uZeigeB && ((uIch == uZeigeB) != (rausch(gl_FragCoord.xy) < uMisch))) discard;
        }
        if (uVorhang > 0.5) { // Vorhang: nur nahe der Fotoposition (bis ca. 4°, ab 8° Abweichung ganz weg)
          float k = dot(normalize(vWelt - fotoKamera()), normalize(vWelt - cameraPosition));
          if (rausch(gl_FragCoord.xy + 31.0) > smoothstep(0.99027, 0.99756, k)) discard;
        }`);
  };
  mat.customProgramCacheKey = () => 'ki-gelaende-8';
}

/**
 * Verfeinert die Tiefenkarte an den Farbkanten des Fotos (kantenerhaltend): Jeder Bildpunkt übernimmt die
 * Disparität des Nachbarn (5 × 5), dessen Farbe ihm am ähnlichsten ist – so liegen Tiefensprünge genau auf den
 * Kanten von Hecken, Bäumen und Hauswänden statt verwaschen daneben.
 */
export function tiefeVerfeinern(t, img) {
  const w = t.breite, h = t.hoehe;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data, d = t.daten, aus = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, r = px[i * 4], gg = px[i * 4 + 1], b = px[i * 4 + 2];
    let summe = 0, gew = 0;
    for (let dy = -2; dy <= 2; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue;
      for (let dx = -2; dx <= 2; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue;
        const j = yy * w + xx, dc = Math.abs(px[j * 4] - r) + Math.abs(px[j * 4 + 1] - gg) + Math.abs(px[j * 4 + 2] - b);
        const wgt = Math.exp(-dc / 18) * (dx === 0 && dy === 0 ? 1.5 : 1);
        summe += d[j] * wgt; gew += wgt; } }
    aus[i] = summe / gew;
  }
  return { ...t, daten: aus };
}

/**
 * Hintergrund-Tiefe: Vordergrund „wegnehmen“ (Minimum-Filter auf die Disparität = weiter weg), nur waagerecht:
 * Beim Umschauen werden Flächen seitlich hinter Bäumen, Hecken und Hauskanten frei; der Boden (in der Zeile
 * gleich weit weg) bleibt dabei unverändert und wird nicht fälschlich als Vordergrund behandelt.
 */
/** Filterbreite für den Hintergrund – gleich für Maske (KI-Füllung) und Hintergrund-Geometrie. */
const hgRadius = (t) => Math.max(6, Math.round(t.breite / 30));
function hintergrundTiefe(t, radius) {
  const w = t.breite, h = t.hoehe, a = t.daten, aus = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = Infinity; for (let k = -radius; k <= radius; k++) { const xx = Math.min(w - 1, Math.max(0, x + k)); m = Math.min(m, a[y * w + xx]); } aus[y * w + x] = m; }
  return { ...t, daten: aus };
}

/**
 * Füllt im Foto die Stellen auf, an denen Vordergrund steht (Maske), mit Farben aus der Umgebung
 * (mehrstufiges Verwischen von außen nach innen). Ergebnis dient als Textur der Hintergrundebene.
 */
/**
 * Bild und Maske für die Hintergrundebene: Maske = 1 dort, wo Vordergrund steht (Baum, Busch, Hausecke), also
 * dahinter nichts zu sehen ist. Wird von fotoAuffuellen (einfach) bzw. von der KI „LaMa“ (fuellen.js) gefüllt.
 */
export function hintergrundMaske(img, t) {
  // breiterer Filter als für die Hintergrundebene: auch Büsche, Kübel und Pfosten gelten als „davor“
  const hg = hintergrundTiefe(t, hgRadius(t)), schwelle = 0.04 * Math.max(1e-6, t.max - t.min);
  const w = Math.min(512, t.breite), h = Math.round((w * t.hoehe) / t.breite);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, w, h);
  const maske = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / (w - 1), v = y / (h - 1), tx = Math.round(u * (t.breite - 1)), ty = Math.round(v * (t.hoehe - 1)), j = ty * t.breite + tx;
    maske[y * w + x] = t.daten[j] - hg.daten[j] < schwelle ? 0 : 1;
  }
  return { bild: c, maske, hg };
}

function fotoAuffuellen(img, t) {
  const { bild: c, maske } = hintergrundMaske(img, t), w = c.width, h = c.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  const bild = g.getImageData(0, 0, w, h), px = bild.data, bekannt = maske.map((m) => 1 - m);
  for (let runde = 0; runde < 60; runde++) { // von den Rändern der Lücke nach innen auffüllen
    let offen = 0; const neu = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (bekannt[i]) continue;
      let r = 0, gg = 0, b = 0, n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, -2]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const j = yy * w + xx; if (bekannt[j]) { r += px[j * 4]; gg += px[j * 4 + 1]; b += px[j * 4 + 2]; n++; } }
      if (n) neu.push([i, r / n, gg / n, b / n]); else offen++;
    }
    for (const [i, r, gg, b] of neu) { px[i * 4] = r; px[i * 4 + 1] = gg; px[i * 4 + 2] = b; bekannt[i] = 1; }
    if (!offen) break;
  }
  g.putImageData(bild, 0, 0);
  return c;
}

/** Gitter-Geometrie aus Tiefe (gemeinsam für Vorder- und Hintergrundebene). */
function gitter(t, k, p, nx, ny, uVon, uBis, trennen, abstandFaktor = 1, rand = 0) {
  const pos = new Float32Array((nx + 1) * (ny + 1) * 3), uv = new Float32Array((nx + 1) * (ny + 1) * 2), zs = new Float32Array((nx + 1) * (ny + 1));
  const P = new THREE.Vector3();
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    // rand > 0: Gitter reicht über den Bildrand hinaus (Randfarben werden fortgesetzt) – beim Umschauen kein Loch am Rand
    const u = uVon - rand + ((uBis - uVon + 2 * rand) * i) / nx, v = -rand + ((1 + 2 * rand) * j) / ny, idx = j * (nx + 1) + i;
    const z = tiefeBei(t, k, p, u, v) * abstandFaktor; zs[idx] = z;
    weltPunkt(k, p, u, v, z, P);
    pos.set([P.x, P.y, P.z], idx * 3); uv.set([u, 1 - v], idx * 2);
  }
  const ind = [];
  const A = new THREE.Vector3(), Bv = new THREE.Vector3(), C = new THREE.Vector3(), n = new THREE.Vector3(), blick = new THREE.Vector3();
  const ok = (a, b, c) => {
    if (!trennen) return true;
    const za = zs[a], zb = zs[b], zc = zs[c], hi = Math.max(za, zb, zc), lo = Math.min(za, zb, zc);
    if (hi >= p.ferne && lo < p.ferne) return false;                           // Übergang zum Hintergrund
    const boden = Math.abs(pos[a * 3 + 1]) < 0.3 && Math.abs(pos[b * 3 + 1]) < 0.3 && Math.abs(pos[c * 3 + 1]) < 0.3;
    if (boden) return true;
    if (hi >= p.ferne) return true;                                             // Himmel/Ferne als Kulisse behalten
    // Fläche, die die Kamera nur streifend sieht (Normale fast quer zum Sehstrahl) = gestreckter „Vorhang“ an einer Kante
    A.fromArray(pos, a * 3); Bv.fromArray(pos, b * 3); C.fromArray(pos, c * 3);
    n.subVectors(Bv, A).cross(C.clone().sub(A)).normalize();
    blick.set((A.x + Bv.x + C.x) / 3, (A.y + Bv.y + C.y) / 3 - p.hoehe, (A.z + Bv.z + C.z) / 3).normalize();
    if (Math.abs(n.dot(blick)) < 0.14) return false;
    return hi / lo < 1.12 + 0.003 * lo;
  };
  const vorhang = []; // an Tiefensprüngen: eigene Geometrie, nur aus der Fotoposition sichtbar
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    (ok(a, c, b) ? ind : vorhang).push(a, c, b);
    (ok(b, c, d) ? ind : vorhang).push(b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(ind);
  if (trennen) {
    const v = new THREE.BufferGeometry();
    v.setAttribute('position', geo.attributes.position); v.setAttribute('uv', geo.attributes.uv); v.setIndex(vorhang);
    geo.userData.vorhang = v;
  }
  return geo;
}

/**
 * Baut das Gelände eines Fotos: Vorderebene (Foto auf Tiefe, an Tiefensprüngen getrennt), Hintergrundebene
 * (Vordergrund entfernt und aufgefüllt – füllt Lücken beim Umschauen) und Schattenschicht.
 * opts: { yaw (°, Blickrichtung des Fotos), uVon, uBis (genutzter Bildausschnitt bei mehreren Fotos), uniforms }.
 * Rückgabe: { gruppe, uniforms, texturen }.
 */
export function gelaendeBauen(img, t, k, p, schattenStaerke, aufloesung = 300, opts = {}) {
  const seitenverh = img.naturalWidth / img.naturalHeight, uVon = opts.uVon ?? 0, uBis = opts.uBis ?? 1;
  const nx = Math.max(8, Math.round(aufloesung * (uBis - uVon))), ny = Math.max(2, Math.round(aufloesung / seitenverh));
  const nr = opts.nr ?? 0, gemeinsam = opts.uniforms ?? poolUniforms(), uniforms = fotoUniforms(gemeinsam, nr);
  const gruppe = new THREE.Group(), texturen = [];

  // Vorderebene
  const geo = gitter(t, k, p, nx, ny, uVon, uBis, true);
  const tex = new THREE.Texture(img); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.needsUpdate = true; texturen.push(tex);
  const foto = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide });
  poolShader(foto, uniforms);
  const vorn = new THREE.Mesh(geo, foto); vorn.name = 'KI_Gelaende'; vorn.renderOrder = -1;
  const vorhangMat = foto.clone(); poolShader(vorhangMat, fotoUniforms(gemeinsam, nr, { vorhang: true }));
  const vorhang = new THREE.Mesh(geo.userData.vorhang, vorhangMat); vorhang.name = 'KI_Vorhang'; vorhang.renderOrder = -1;
  const schatten = new THREE.ShadowMaterial({ opacity: schattenStaerke, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  poolShader(schatten, uniforms);
  const schattenMesh = new THREE.Mesh(geo, schatten); schattenMesh.receiveShadow = true; schattenMesh.name = 'KI_Gelaende_Schatten';
  gruppe.add(vorn, vorhang, schattenMesh);

  // Hintergrundebene: Vordergrund weggenommen, Foto dort aufgefüllt, etwas weiter hinten
  if (opts.hintergrund !== false) {
    const hg = hintergrundTiefe(t, hgRadius(t));
    // Textur: von der KI ergänztes Bild (opts.fuellBild, wenn schon berechnet), sonst einfach von außen nach innen verwischt
    const hgTex = new THREE.CanvasTexture(opts.fuellBild ?? fotoAuffuellen(img, t)); hgTex.colorSpace = THREE.SRGBColorSpace; texturen.push(hgTex);
    const hgMat = new THREE.MeshBasicMaterial({ map: hgTex, toneMapped: false, side: THREE.DoubleSide });
    poolShader(hgMat, fotoUniforms(gemeinsam, nr));
    const hinten = new THREE.Mesh(gitter(hg, k, p, Math.round(nx / 2), Math.round(ny / 2), uVon, uBis, false, 1.02, 0.15), hgMat);
    hinten.name = 'KI_Hintergrund'; hinten.renderOrder = -1.2;
    gruppe.add(hinten);
  }
  gruppe.rotation.y = THREE.MathUtils.degToRad(-(opts.yaw ?? 0)); // Foto in seine Blickrichtung drehen
  if (opts.pos) gruppe.position.set(opts.pos.x, 0, opts.pos.z);   // und an seinen Aufnahmestandort setzen
  return { gruppe, uniforms: gemeinsam, texturen };
}

/** Überträgt Lage und Größe des Pools in die Gelände-Shader. */
export function poolAussparung(uniforms, welt, m, off) {
  welt.updateMatrixWorld(true);
  uniforms.uPoolInv.value.copy(welt.matrixWorld).invert();
  const halbL = m.L / 2 + off, halbB = m.B / 2 + off;
  uniforms.uHalb.value.set(halbL, halbB);
  uniforms.uRadius.value = m.form === 'rund' ? halbL : m.form === 'oval' ? halbB : 0.02;
  uniforms.uRand.value = 1.2;
  uniforms.uAktiv.value = 1;
}
