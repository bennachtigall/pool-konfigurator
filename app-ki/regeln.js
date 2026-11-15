// Regeln: welche Optionen bei welchem Pool kombinierbar sind. Alles wird aus den Feldern
// "bedingungen" usw. der JSON-Datei gelesen, hier steht keine Produktlogik fest.
import { waehleGroesse } from './ueberdachung.js';
import { saftyGroesse, fmt } from './abdeckung.js';

const ok = { ok: true };
const nein = (grund) => ({ ok: false, grund });

/** Allgemeine Prüfung auf Beckenform und Größe über das Feld "bedingungen". */
function bedingungen(b, pool, m) {
  if (!b) return ok;
  if (b.nur_formen && !b.nur_formen.includes(pool.form)) return nein(b.grund_form);
  if (b.nicht_fuer_formen && b.nicht_fuer_formen.includes(pool.form)) return nein(b.grund_form);
  if ((b.max_laenge && m.L > b.max_laenge) || (b.max_breite && m.B > b.max_breite)) return nein(b.grund_groesse);
  return ok;
}

export const umrandungStatus = (u, pool, m) => bedingungen(u.bedingungen, pool, m);

/** Überdachung: Form + passende Größe (inkl. Umrandungsbreite). Gibt bei ok die gewählte Größe mit. */
export function ueberdachungStatus(u, pool, m, rand) {
  const b = bedingungen(u.bedingungen, pool, m);
  if (!b.ok) return b;
  const g = waehleGroesse(u, m, rand);
  return g.ok ? g : nein(g.grund);
}

/** Abdeckung: Form, Größe und typspezifische Grenzen. */
export function abdeckungStatus(a, pool, m) {
  const b = bedingungen(a.bedingungen, pool, m);
  if (!b.ok) return b;
  if (a.id === 'safty_individual' && !saftyGroesse(a, m)) return nein(a.bedingungen.grund_groesse);
  return ok;
}

/** WaluDeck-Ausführung C/D nur bis 8,20 m Beckenlänge. */
export function ausfuehrungStatus(a, key, m) {
  const max = a.bedingungen.ausfuehrungen_max_laenge?.[key];
  return max && m.L > max ? nein(a.bedingungen.grund_ausfuehrung) : ok;
}

/** LED-Einträge (Zubehör) für einen Pool. Liefert { liste, grundNicht }. */
export function ledListe(daten, pool) {
  const liste = [];
  let grundNicht = null;
  for (const [id, z] of Object.entries(daten.zubehoer)) {
    if (!id.startsWith('led')) continue;
    grundNicht = grundNicht || z.grund_nicht;
    if (!(pool.optionen || []).includes(id)) continue;
    if (z.varianten) z.varianten.forEach((v) => liste.push({ id: `${id}:${v}`, name: `${z.name} (${daten.bezeichnungen[v] || v})`, farbe: v }));
    else liste.push({ id, name: z.name, farbe: id.includes('rgb') ? 'rgb' : 'weiss' });
  }
  return { liste, grundNicht };
}

/** Premium Skimmer nur für die in "fuer" genannten Pools. */
export function skimmerStatus(daten, pool) {
  const z = daten.zubehoer.premium_skimmer;
  return z.fuer.includes(pool.id) ? ok : nein(z.grund_nicht);
}

export { fmt };
