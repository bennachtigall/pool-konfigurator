# poolmaris 3D-Pool-Konfigurator

Du baust in diesem Ordner einen 3D-Pool-Konfigurator für poolmaris (ähnlich wie VirtualPools). Damit stellen wir zusammen mit Kunden einen Pool nach allen unseren Konfigurationsmöglichkeiten zusammen, und das Ergebnis erscheint live als 3D-Modell.

Alles, was du brauchst, liegt in diesem Projektordner. Sieh dich zuerst selbst um und lies diese Datei komplett, bevor du anfängst.

## Projektordner

```
~/Documents/poolmaris/Pool-Konfigurator/
├── CLAUDE.md                      ← dieser Auftrag
├── daten/
│   └── poolmaris-konfiguration.json   ← fertige Produktdaten (ohne Preise), Regeln, offene Punkte
└── datenblaetter/                 ← Kopien der Original-Datenblätter (PDF), nur lesen
    ├── 1_Pools/
    │   ├── Rundpool.pdf
    │   ├── Rundpool ohne Beton.pdf
    │   ├── Ovalpool Komplettset.pdf
    │   ├── Polypropylenpools mit Skimmer.pdf
    │   ├── Systempool Ausstattung und Preisübersicht.pdf
    │   └── Systempool Kompakt.pdf
    ├── 2_Umrandung/
    │   └── Beckenrandsteine.pdf
    ├── 3_Zubehoer/
    │   └── Poolmaris Premium Skimmer.pdf
    ├── 4_Ueberdachungen/
    │   ├── Azure Bausatz.pdf, Azure hochwertiger Bausatz.pdf
    │   ├── Azure Flat Compact Datenblatt.pdf, Azure Flat Compact Info.pdf
    │   ├── Alukov vormontiert.pdf
    │   ├── Parade High.pdf, Parade High Datenblatt.pdf
    │   ├── Parade Low.pdf
    │   └── Elegant Neo.pdf
    └── 5_Abdeckungen/
        ├── Sicherheitsabdeckung Safty individual.pdf
        ├── WaluDeck verschiebbare Poolterrasse.pdf
        ├── WaluRoll RollTop 100.pdf
        └── WaluRoll RollTop 300.pdf
```

Hinweise zu den Dateien:
- Die PDFs in `datenblaetter/` niemals verändern, verschieben oder löschen.
- `daten/poolmaris-konfiguration.json` ist die wichtigste Quelle für den Code. Sie wurde bereits aus allen Datenblättern erstellt.
- `Parade High Datenblatt.pdf` hat eine kaputte Textebene. Nutze `Parade High.pdf` oder sieh dir die Seiten als Bild an.
- Mehrere Azure-Dateien überschneiden sich inhaltlich. Das ist normal.

## Wichtig: keine Preise

Der Konfigurator zeigt nirgends Preise an. Auch wenn in den Datenblättern Preise stehen, übernimm sie weder in die Daten noch in die Oberfläche.

## Rahmenbedingungen

- Kein eigener Server. Die App läuft lokal im Browser, ohne Installation (Doppelklick auf `index.html` oder ein einfacher lokaler Start).
- Sicherheit hat Priorität: keine Verbindung nach außen, keine Speicherung von Kundendaten auf fremden Servern, keine Tracker oder Analyse-Dienste. Bibliotheken wie Three.js werden lokal in den Projektordner gelegt, nicht per CDN geladen.
- Läuft auf einem normalen, relativ neuen Firmen-Laptop (Lenovo, integrierte Grafik). Performance schlank halten und eine Qualitätsstufe zum Runterschalten einbauen.
- Bedienoberfläche auf Deutsch, einfach und kundentauglich.

## Technischer Ansatz

- 3D-Darstellung mit Three.js.
- Pools und Bauteile parametrisch im Code erzeugen (Becken, Treppen, Umrandung, Überdachung, Abdeckung), sodass sich das Modell bei jeder Änderung sofort anpasst.
- Nur komplexe Einzelteile, die sich nicht sinnvoll parametrisch bauen lassen, als glTF/GLB einbinden. Frag vorher nach.
- Alle Produktdaten kommen aus `daten/poolmaris-konfiguration.json`. Keine Produktdaten fest im Code, damit wir Optionen später ohne Code-Änderungen pflegen können.
- Die Regeln im Abschnitt `regeln` der JSON-Datei steuern, welche Optionen kombinierbar sind (z. B. Roll'Top nicht bei Rund- und Ovalpools).

## Vorgehen in Phasen

Arbeite strikt Schritt für Schritt und warte nach jeder Phase auf meine Freigabe.

### Phase 1: Daten prüfen
- Lies die JSON-Datei und gleiche sie stichprobenartig mit den Datenblättern ab.
- Ergänze Fehlendes, ohne etwas zu erfinden.
- Geh mit mir die `offene_punkte` am Ende der JSON-Datei durch. Für fehlende Treppenmaße schlag sinnvolle Richtwerte vor und lass sie mich bestätigen.

### Phase 2: Prototyp mit einem Beckentyp
- Starte mit dem Systemsteinpool (P40): Größe, Folienfarbe, Einstieg/Treppe.
- 3D-Ansicht mit Drehen, Zoomen und Verschieben per Maus und Touch.
- Einfache Umgebung (Rasen, Licht, Wasser), realistisch genug, aber performant.

### Phase 3: Alle Pools und Optionen
- Alle Beckentypen, Treppen, Umrandungen, Zubehör, Überdachungen und Abdeckungen aus der JSON-Datei.
- Abhängigkeiten und Regeln umsetzen. Nicht kombinierbare Optionen ausgrauen und kurz erklären, warum.

### Phase 4: Ergebnis festhalten
- Zusammenfassung aller gewählten Optionen, druckbar bzw. als PDF speicherbar (ohne Preise).
- Screenshot des 3D-Modells.
- Export des 3D-Modells als Datei (GLB).
- Konfiguration lokal als Datei speichern und wieder laden.

### Phase 5 (optional, später)
- AR-Ansicht, um den Pool im Garten des Kunden zu platzieren.
- Eventuell Hosting als Web-App, dann mit Prüfung von Sicherheit und DSGVO.

## Arbeitsweise

- Erklär kurz, was du vorhast, bevor du größere Änderungen machst.
- Code sauber strukturieren und kommentieren. Neuer Code kommt in einen eigenen Ordner `app/`.
- Bei Unklarheiten zu Produkten immer nachfragen statt annehmen.
