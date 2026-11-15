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
  // Bodenerkennung (robust, RANSAC): Auf einer ebenen Bodenfläche ist die Disparität linear in der Bildzeile und
  // unabhängig von der Spalte: d = α·b + β (b = Bildhöhe, α < 0: weiter unten = näher). Senkrechte Flächen
  // (Wände, Beckenwände, Hecken) haben in der Zeile kaum Gefälle und werden so aussortiert.
  const alle = [];
  for (let v = 0.45; v <= 0.985; v += 0.0125) for (let u = 0.06; u <= 0.94; u += 0.025) alle.push([u, v, abtasten(t, u, v), (1 - 2 * v) * tanY]);
  const spanne = Math.max(1e-6, t.max - t.min), tol = 0.025 * spanne;
  let besteN = 0, beste = null;
  let zufall = 12345; const rnd = () => ((zufall = (zufall * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); // reproduzierbar
  for (let it = 0; it < 400; it++) {
    const A = alle[(rnd() * alle.length) | 0], B = alle[(rnd() * alle.length) | 0];
    if (Math.abs(A[3] - B[3]) < 0.08 * tanY) continue;
    const al = (A[2] - B[2]) / (A[3] - B[3]); if (!(al < -0.4 * spanne)) continue;  // deutliches Gefälle nach oben = Boden
    const be = A[2] - al * A[3];
    let n = 0, unten = 0;
    for (const q of alle) if (Math.abs(q[2] - (al * q[3] + be)) < tol) { n++; if (q[1] > 0.8) unten++; }
    const wert = n + unten * 0.5;                                                       // Boden liegt meist unten im Bild
    if (wert > besteN) { besteN = wert; beste = [al, be]; }
  }
  let proben = alle.filter((q) => beste && Math.abs(q[2] - (beste[0] * q[3] + beste[1])) < tol);
  // Plausibilität: Boden muss breit genug sein und über einen größeren Bildbereich laufen
  const vs = proben.map((q) => q[1]), us = proben.map((q) => q[0]);
  let sicher = proben.length > alle.length * 0.12 && Math.max(...vs) - Math.min(...vs) > 0.15 && Math.max(...us) - Math.min(...us) > 0.4;
  if (!sicher) proben = alle.filter((q) => q[1] > 0.8 && q[0] > 0.2 && q[0] < 0.8);   // Notlösung: unterer Bildrand
  let neigung;
  if (p.horizontAuto && sicher) {
    let sb = 0, sd = 0, sbb = 0, sbd = 0;
    for (const [, , d, b] of proben) { sb += b; sd += d; sbb += b * b; sbd += b * d; }
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
  for (const [, , d, b] of proben) {
    const inv = -(b * c + sn) / p.hoehe;                    // 1 / planare Tiefe
    if (inv <= 0) continue;
    const x = d - dUnendlich; zaehler += x * inv; nenner += x * x;
  }
  const s = nenner > 0 ? (zaehler / nenner) / p.tiefe : 0.01;
  return { neigung, tanX, tanY, dUnendlich, s, horizont, sicher, bodenAnteil: proben.length / alle.length };
}

/** Planare Tiefe (m) an Bildkoordinaten u, v. */
const tiefeBei = (t, k, p, u, v) => {
  const inv = k.s * (abtasten(t, u, v) - k.dUnendlich);
  return inv > 1 / p.ferne ? Math.max(0.3, 1 / inv) : p.ferne;
};

/** Weltpunkt zu Bildkoordinaten u, v und planarer Tiefe z. Kamera bei (0, Höhe, 0), Blick nach −z. */
function weltPunkt(k, p, u, v, z, ziel) {
  const xc = (2 * u - 1) * k.tanX * z, yc = (1 - 2 * v) * k.tanY * z, zc = -z;
  const c = Math.cos(k.neigung), s = Math.sin(k.neigung);
  return ziel.set(xc, yc * c - zc * s + p.hoehe, yc * s + zc * c);
}

/** Abstand (m) des Bodenpunkts geradeaus in der Bildmitte unten – für die Startlage des Pools. */
export function bodenAbstand(k, p, v = 0.8) {
  const b = (1 - 2 * v) * k.tanY, inv = -(b * Math.cos(k.neigung) + Math.sin(k.neigung)) / p.hoehe;
  return inv > 0 ? 1 / inv : 10;
}

/** Aussparung + Einebnung rund um den Pool (gemeinsamer Shader-Teil für Foto- und Schattenschicht). */
const poolUniforms = () => ({
  uPoolInv: { value: new THREE.Matrix4() }, uHalb: { value: new THREE.Vector2(3, 2) }, uRadius: { value: 0 },
  uRand: { value: 1.2 }, uAktiv: { value: 0 },
});
function poolShader(mat, uniforms) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    const kopf = `
      uniform mat4 uPoolInv; uniform vec2 uHalb; uniform float uRadius; uniform float uRand; uniform float uAktiv;
      varying vec3 vWelt;
      float poolSdf(vec3 w) { vec2 q = (uPoolInv * vec4(w, 1.0)).xz; vec2 d = abs(q) - (uHalb - uRadius); return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - uRadius; }`;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + kopf)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 w0 = (modelMatrix * vec4(transformed, 1.0)).xyz;
        if (uAktiv > 0.5) { // Gelände rund um den Pool sanft auf Bodenhöhe einebnen
          float f = 1.0 - smoothstep(0.0, uRand, poolSdf(w0));
          if (abs(w0.y) < 0.8) transformed.y = mix(transformed.y, transformed.y - w0.y, f);
        }`)
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWelt = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + kopf)
      .replace('void main() {', 'void main() {\n  if (uAktiv > 0.5 && poolSdf(vWelt) < 0.0 && vWelt.y < 0.6) discard; // Loch für das Becken');
  };
  mat.customProgramCacheKey = () => 'ki-gelaende';
}

/**
 * Baut das Gelände. Rückgabe: { gruppe, uniforms } – uniforms werden bei jeder Pool-Verschiebung aktualisiert.
 * aufloesung: Gitterpunkte entlang der Bildbreite.
 */
export function gelaendeBauen(img, t, k, p, schattenStaerke, aufloesung = 300) {
  const seitenverh = img.naturalWidth / img.naturalHeight;
  const nx = aufloesung, ny = Math.max(2, Math.round(aufloesung / seitenverh));
  const pos = new Float32Array((nx + 1) * (ny + 1) * 3), uv = new Float32Array((nx + 1) * (ny + 1) * 2), zs = new Float32Array((nx + 1) * (ny + 1));
  const P = new THREE.Vector3();
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const u = i / nx, v = j / ny, idx = j * (nx + 1) + i;
    const z = tiefeBei(t, k, p, u, v); zs[idx] = z;
    weltPunkt(k, p, u, v, z, P);
    pos.set([P.x, P.y, P.z], idx * 3); uv.set([u, 1 - v], idx * 2);
  }
  // Dreiecke; an Tiefensprüngen auftrennen (außer am Boden, der flach in die Ferne läuft)
  const ind = [];
  const ok = (a, b, c) => {
    const za = zs[a], zb = zs[b], zc = zs[c], hi = Math.max(za, zb, zc), lo = Math.min(za, zb, zc);
    if (hi >= p.ferne && lo < p.ferne) return false;                           // Übergang zum Hintergrund
    const boden = Math.abs(pos[a * 3 + 1]) < 0.3 && Math.abs(pos[b * 3 + 1]) < 0.3 && Math.abs(pos[c * 3 + 1]) < 0.3;
    return boden || hi / lo < 1.2 + 0.004 * lo;
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    if (ok(a, c, b)) ind.push(a, c, b);
    if (ok(b, c, d)) ind.push(b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(ind);
  geo.computeVertexNormals();

  const tex = new THREE.Texture(img); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.needsUpdate = true;
  const uniforms = poolUniforms();
  const foto = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide });
  poolShader(foto, uniforms);
  const schatten = new THREE.ShadowMaterial({ opacity: schattenStaerke, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  poolShader(schatten, uniforms);
  const gruppe = new THREE.Group();
  const m1 = new THREE.Mesh(geo, foto); m1.name = 'KI_Gelaende'; m1.renderOrder = -1;
  const m2 = new THREE.Mesh(geo, schatten); m2.receiveShadow = true; m2.name = 'KI_Gelaende_Schatten';
  gruppe.add(m1, m2);
  return { gruppe, uniforms, textur: tex };
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
