# poolmaris 3D-Pool-Konfigurator

Konfiguriert zusammen mit Kunden einen Pool und zeigt ihn live in 3D. Läuft komplett lokal im Browser, ohne Verbindung nach außen und ohne Preise.

## Starten

Doppelklick auf `start.command`. Das öffnet `http://localhost:8765/app/` im Browser.
Der kleine Webserver lauscht nur auf diesem Rechner (127.0.0.1) und wird mit Strg+C oder durch Schließen des Terminal-Fensters beendet.
Voraussetzung: `python3` (auf dem Mac vorhanden).

`index.html` direkt per Doppelklick zu öffnen funktioniert nicht, weil der Browser dann das Laden der Produktdaten blockiert.

## Bedienung

- **Ansicht:** Ziehen = drehen, Mausrad oder zwei Finger = zoomen, rechte Maustaste oder zwei Finger ziehen = verschieben.
- **Kundengarten (Foto):** Unter „Darstellung → Umgebung“ ein Gartenfoto laden. Kamerahöhe, Neigung und Bildwinkel an das Foto anpassen, den Pool mit Maus oder Finger an die gewünschte Stelle ziehen (Mausrad dreht ihn), Sonne und Helligkeit passend einstellen. Screenshot und Zusammenfassung enthalten Foto und Pool. Das Foto bleibt nur auf diesem Rechner, es wird nicht hochgeladen und nicht mit der Konfiguration gespeichert.
- **Umgebung:** Unter „Darstellung“ lässt sich zwischen Rasen (Garten) und freiem 3D-Modell ohne Rasen umschalten. Das freie Modell zeigt den Pool als geschlossenen Körper und lässt sich auch von unten ansehen.
- **Schnitt:** Im freien Modell lässt sich bei Systemstein-, Kompakt- und Polypropylen-Becken ein Quer- oder Längsschnitt zeigen (Schichten des Wandaufbaus, Lage per Regler). Der Aufbau steht pro Pool im Feld `aufbau` der JSON-Datei. Die Folie ist im Schnitt überhöht dargestellt.
- **Beleuchtung:** Meist an einer Seite (Standard: 2 Scheinwerfer an der langen Seite). Seite und Lage entlang der Wand sind wählbar.
- **Skimmer:** Standard ist ein Skimmer an der Schmalseite gegenüber dem Einstieg, bei größeren Becken zwei. Die Schwelle (24 m², bestätigt) steht in `skimmer_regel` in der JSON-Datei.
- **Qualität:** Unter „Darstellung“ gibt es vier Stufen: Niedrig, Mittel, Hoch (Standard: Himmel, Spiegelungen, Lichtbrechung im Wasser, Lichtmuster am Boden, Umgebungsverdeckung und Kantenglättung) und Ultra (sehr scharf, bewegtes Wasser). Auf schwacher Grafik runterschalten.
- **Öffnen und Verschieben:** Überdachung, Rollabdeckungen und WaluDeck lassen sich mit einem Regler öffnen bzw. verschieben.
- **Nicht kombinierbare Optionen** sind ausgegraut, darunter steht der Grund.
- **Ergebnis festhalten:** Zusammenfassung drucken oder als PDF sichern, Screenshot (PNG), 3D-Modell (GLB, der Pool immer als geschlossener Körper ohne Rasen), Konfiguration speichern und wieder laden. Alles wird direkt heruntergeladen, nichts hochgeladen.

## Aufbau

```
CLAUDE.md                 Auftrag und Rahmenbedingungen
start.command             lokaler Start
daten/
  poolmaris-konfiguration.json   alle Produktdaten, Regeln, Farben (ohne Preise)
datenblaetter/            Original-Datenblätter (PDF), nur lesen
app/
  index.html, style.css   Oberfläche (Deutsch)
  main.js                 Zustand, Bedienfeld, 3D-Szene, Ergebnis festhalten
  pool.js                 Becken (rechteck, rund, oval), Treppen, Skimmer, Düsen, LED
  koerper.js              geschlossener Poolkörper (Styroporsteine, PP-Fertigbecken) für das freie Modell und den GLB-Export
  foto.js                 Kundengarten-Foto: Kamera, unsichtbarer Boden mit Schatten, Bild zusammensetzen
  materialien.js, umgebung.js   Wasser-Normalmap, Steinstruktur, Himmel und Spiegelungskarten
  schnitt.js              Quer-/Längsschnitt mit Schichten des Wandaufbaus
  umrandung.js            Beckenrandsteine
  ueberdachung.js         Überdachungen (Größenwahl + Geometrie)
  abdeckung.js            Safty, WaluDeck, Roll'Top 100/300
  regeln.js               Kombinierbarkeit, liest die Felder "bedingungen" aus der JSON
  export.js               Screenshot-, GLB-, Konfigurations-Dateien
  lib/                    Three.js 0.187.0 lokal (inkl. Sky, RoomEnvironment, GLTFExporter, OrbitControls und Nachbearbeitung GTAO/SMAA) (MIT-Lizenz, siehe THREE-LICENSE.txt)
```

## Produktdaten pflegen

Alle Produktdaten stehen in `daten/poolmaris-konfiguration.json`, nichts davon fest im Code.

- **Neue Größe, Farbe oder Option:** in der JSON-Datei ergänzen, die Oberfläche übernimmt sie.
- **Regeln:** Pro Eintrag gibt es ein Feld `bedingungen` (z. B. `nur_formen`, `max_laenge`) mit dem Text, der als Begründung angezeigt wird. Die Texte unter `regeln` sind nur zur Dokumentation.
- **Farben im 3D-Modell:** Abschnitt `farben_3d` (Richtwerte, mit echten Mustern abgleichen). Die Wasserfarben (`wasser_hex`) stammen aus qualitativen Ratgeberaussagen, keine Messwerte.
- **Treppenmaße:** `treppen._richtwerte` (am 2026-11-15 bestätigt, nicht aus den Datenblättern).
- **Keine Preise** in die Datei schreiben.
- **Neue Produkte mit neuer Geometrie** (z. B. eine neue Abdeckung) brauchen zusätzlich Code in `app/`.

## Offene Punkte (Stand 2026-11-15)

Siehe `offene_punkte` am Ende der JSON-Datei:
- Elegant Neo: Größen fehlen (Überdachung ist solange gesperrt).
- Azure Flat Compact vormontiert: die 7 Modellgrößen fehlen (ebenfalls gesperrt).
- Rundpool: Ist „Hellgrau“ dieselbe Folie wie „Grau“?
- Roll'Top 100/300: Ist die Lamelle „Mittelgrau“ wählbar? Beim 100 steht im Datenblatt „nicht kompatibel“, vorläufig ist sie bei beiden wählbar.

## Bekannte Grenzen

- Alle Becken werden als eingelassen dargestellt (Rundpool ohne Handlauf und Stahlmantel über dem Rasen).
- Überdachungen und Abdeckungen sind detailliert, aber nicht maßstabsgetreu bis ins Letzte: Roll'Top-Bankgröße geschätzt, Elemente der Überdachung vereinfacht, Beton und Baustahl im Schnitt sind Richtwerte.
- Überdachungen und Abdeckungen gibt es nur für Rechteckpools.
- Die Wasserfläche ist ein einfaches, leicht durchsichtiges Rechteck ohne Wellen.
- Nicht getestet: Touch-Bedienung, Handy-Ansicht, Leistung auf dem Firmen-Laptop, echter Druckdialog, GLB-Datei in einem 3D-Programm.

## Phase 5 (optional, später)

AR-Ansicht und Hosting als Web-App. Vor einem Hosting müssen Sicherheit und DSGVO geprüft werden, denn bisher läuft alles nur lokal.
