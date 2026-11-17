// Liest Aufnahmedaten aus Fotos (JPEG und HEIC, lokal, ohne Bibliothek):
//  – Brennweite (Kleinbild) → genauer Bildwinkel (wichtig für den Maßstab)
//  – GPS-Standort, Genauigkeit und Kompassrichtung der Kamera → Lage und Blickrichtung mehrerer Fotos zueinander
// Die Daten werden nur im Browser ausgewertet und nirgendwohin gesendet.

/**
 * Liefert { f35, f, modell, lat, lon, richtung, genauigkeit } (fehlende Werte undefined) oder null.
 * Sucht den EXIF-Block ("Exif\0\0" + TIFF-Kopf) in den ersten Megabytes – funktioniert bei JPEG und HEIC.
 */
export async function exifLesen(datei) {
  try {
    const buf = await datei.slice(0, 3 * 1024 * 1024).arrayBuffer();
    const b = new Uint8Array(buf), v = new DataView(buf);
    for (let i = 0; i < b.length - 10; i++) {
      if (b[i] === 0x45 && b[i + 1] === 0x78 && b[i + 2] === 0x69 && b[i + 3] === 0x66 && b[i + 4] === 0 && b[i + 5] === 0) {
        const t = i + 6, kopf = v.getUint16(t);
        if (kopf === 0x4949 || kopf === 0x4d4d) { const e = tiffLesen(v, t); if (e) return e; }
      }
    }
  } catch { /* keine lesbaren Aufnahmedaten */ }
  return null;
}

function tiffLesen(v, t) {
  const le = v.getUint16(t) === 0x4949;
  const u16 = (p) => v.getUint16(t + p, le), u32 = (p) => v.getUint32(t + p, le);
  const eintraege = (ifd) => { const n = u16(ifd), e = []; for (let i = 0; i < n; i++) { const p = ifd + 2 + i * 12; e.push({ tag: u16(p), typ: u16(p + 2), anz: u32(p + 4), wert: p + 8 }); } return e; };
  const text = (e) => { const p = e.anz > 4 ? u32(e.wert) : e.wert; let s = ''; for (let i = 0; i < e.anz - 1; i++) s += String.fromCharCode(v.getUint8(t + p + i)); return s.trim(); };
  const rational = (e, k = 0) => { const p = u32(e.wert) + 8 * k; return u32(p) / u32(p + 4); };
  const ifd0 = eintraege(u32(4));
  const modell = ifd0.find((e) => e.tag === 0x0110), exifZeiger = ifd0.find((e) => e.tag === 0x8769), gpsZeiger = ifd0.find((e) => e.tag === 0x8825);
  const erg = { modell: modell ? text(modell) : '' };
  if (exifZeiger) for (const e of eintraege(u32(exifZeiger.wert))) {
    if (e.tag === 0xa405) erg.f35 = u16(e.wert);                                         // Brennweite Kleinbild
    if (e.tag === 0x920a) erg.f = rational(e);                                           // echte Brennweite
  }
  if (gpsZeiger) {
    const g = {};
    for (const e of eintraege(u32(gpsZeiger.wert))) g[e.tag] = e;
    const grad = (e) => rational(e, 0) + rational(e, 1) / 60 + rational(e, 2) / 3600;
    const ref = (e) => String.fromCharCode(v.getUint8(t + e.wert));
    if (g[2] && g[4]) {
      erg.lat = grad(g[2]) * (g[1] && ref(g[1]) === 'S' ? -1 : 1);
      erg.lon = grad(g[4]) * (g[3] && ref(g[3]) === 'W' ? -1 : 1);
    }
    if (g[0x11]) erg.richtung = rational(g[0x11]);                                       // Kompassrichtung der Kamera (Grad)
    if (g[0x1f]) erg.genauigkeit = rational(g[0x1f]);                                    // horizontale Genauigkeit (m)
  }
  return erg.f35 || erg.lat !== undefined ? erg : null;
}

/** Horizontaler Bildwinkel (°) aus Kleinbild-Brennweite; Bezug ist die Bilddiagonale (43,27 mm). */
export function bildwinkelAusF35(f35, breite, hoehe) {
  const a = breite / hoehe, diag = 43.27, b = (diag * a) / Math.sqrt(1 + a * a);
  return (2 * Math.atan(b / (2 * f35)) * 180) / Math.PI;
}

/** GPS-Position in Meter relativ zu einem Bezugspunkt: x = Osten, z = −Norden (Blick nach −z = Norden). */
export function gpsZuMeter(lat, lon, lat0, lon0) {
  const r = 6378137, rad = Math.PI / 180;
  return { x: (lon - lon0) * rad * r * Math.cos(lat0 * rad), z: -(lat - lat0) * rad * r };
}

/** Erkennt HEIC/HEIF-Dateien (iPhone-Standard), die Chrome und Edge nicht anzeigen können. */
export function istHeic(datei) {
  return /\.(heic|heif)$/i.test(datei.name) || /heic|heif/i.test(datei.type);
}
