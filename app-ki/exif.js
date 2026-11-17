// Liest die Brennweite aus den EXIF-Daten eines JPEG-Fotos (lokal, ohne Bibliothek).
// Daraus ergibt sich der Bildwinkel genau statt geschätzt – wichtig für einen stimmigen Maßstab.

/** Liefert { f35, f, modell } oder null. f35 = Brennweite umgerechnet auf Kleinbild (mm). */
export async function exifLesen(datei) {
  try {
    const buf = await datei.slice(0, 256 * 1024).arrayBuffer();
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xffd8) return null; // kein JPEG
    let o = 2;
    while (o + 4 < v.byteLength) {
      const marker = v.getUint16(o), len = v.getUint16(o + 2);
      if (marker === 0xffe1 && v.getUint32(o + 4) === 0x45786966) return tiffLesen(v, o + 10); // "Exif"
      if ((marker & 0xff00) !== 0xff00) break;
      o += 2 + len;
    }
  } catch { /* keine EXIF-Daten */ }
  return null;
}

function tiffLesen(v, t) {
  const le = v.getUint16(t) === 0x4949;
  const u16 = (p) => v.getUint16(t + p, le), u32 = (p) => v.getUint32(t + p, le);
  const eintraege = (ifd) => { const n = u16(ifd), e = []; for (let i = 0; i < n; i++) { const p = ifd + 2 + i * 12; e.push({ tag: u16(p), typ: u16(p + 2), anz: u32(p + 4), wert: p + 8 }); } return e; };
  const text = (e) => { const p = e.anz > 4 ? u32(e.wert) : e.wert; let s = ''; for (let i = 0; i < e.anz - 1; i++) s += String.fromCharCode(v.getUint8(t + p + i)); return s.trim(); };
  const ifd0 = eintraege(u32(4));
  const modell = ifd0.find((e) => e.tag === 0x0110), exifZeiger = ifd0.find((e) => e.tag === 0x8769);
  const erg = { modell: modell ? text(modell) : '' };
  if (exifZeiger) for (const e of eintraege(u32(exifZeiger.wert))) {
    if (e.tag === 0xa405) erg.f35 = u16(e.wert);                                         // Brennweite Kleinbild
    if (e.tag === 0x920a) { const p = u32(e.wert); erg.f = u32(p) / u32(p + 4); }          // echte Brennweite
  }
  return erg.f35 ? erg : null;
}

/** Horizontaler Bildwinkel (°) aus Kleinbild-Brennweite; Bezug ist die Bilddiagonale (43,27 mm). */
export function bildwinkelAusF35(f35, breite, hoehe) {
  const a = breite / hoehe, diag = 43.27, b = (diag * a) / Math.sqrt(1 + a * a);
  return (2 * Math.atan(b / (2 * f35)) * 180) / Math.PI;
}
