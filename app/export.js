// Ergebnis festhalten: Screenshot, GLB-Export, Konfiguration speichern/laden.
// Alles geschieht lokal im Browser (Datei-Download). Es wird nichts hochgeladen oder gesendet.
import { GLTFExporter } from './lib/GLTFExporter.js';

/** Lädt Daten als Datei herunter (lokaler Download, keine Netzverbindung). */
export function speichereDatei(dateiname, blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: dateiname });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Dateiname wie "poolmaris-systemsteinpool-2026-11-15.glb". */
export function dateiname(poolId, endung) {
  return `poolmaris-${poolId}-${new Date().toISOString().slice(0, 10)}.${endung}`;
}

/** Exportiert die übergebenen 3D-Objekte als GLB (Rasen und Himmel bleiben bewusst draußen). */
export function exportiereGLB(objekte) {
  return new Promise((ok, fehler) => {
    new GLTFExporter().parse(objekte, (ergebnis) => ok(new Blob([ergebnis], { type: 'model/gltf-binary' })), fehler, { binary: true });
  });
}

const FORMAT = 'poolmaris-konfiguration';

/** Konfiguration als JSON-Text. Enthält nur die Auswahl, keine Produktdaten und keine Preise. */
export function konfigAlsText(zustand, daten) {
  return JSON.stringify({ format: FORMAT, version: 1, datenstand: daten._info.stand, gespeichert: new Date().toISOString(), zustand }, null, 2);
}

/**
 * Liest eine Konfigurationsdatei. Übernommen werden nur bekannte Felder mit passendem Typ;
 * den Rest (ungültige Kombinationen) korrigiert die App danach selbst über ihre Regeln.
 */
export function konfigLesen(text, daten, vorlage) {
  let o;
  try { o = JSON.parse(text); } catch { throw new Error('Die Datei ist keine gültige Konfiguration.'); }
  if (!o || o.format !== FORMAT || typeof o.zustand !== 'object' || o.zustand === null) throw new Error('Das ist keine poolmaris-Konfigurationsdatei.');
  const z = o.zustand;
  const pool = daten.pools.find((p) => p.id === z.poolId);
  if (!pool) throw new Error('Der Beckentyp aus der Datei ist in den aktuellen Produktdaten nicht mehr vorhanden.');
  const neu = structuredClone(vorlage);
  for (const k of Object.keys(vorlage)) if (k in z && typeof z[k] === typeof vorlage[k] && z[k] !== null) neu[k] = z[k];
  if (!Number.isInteger(neu.groesseIdx) || neu.groesseIdx < 0 || neu.groesseIdx >= pool.groessen.length) neu.groesseIdx = 0;
  if (!Number.isInteger(neu.ledAnzahl) || neu.ledAnzahl < 1 || neu.ledAnzahl > 4) neu.ledAnzahl = 2;
  return neu;
}
