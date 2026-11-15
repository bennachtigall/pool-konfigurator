#!/bin/bash
# Startet den Konfigurator lokal. Der kleine Webserver lauscht nur auf diesem Rechner (127.0.0.1),
# es gibt keine Verbindung nach außen. Beenden mit Strg+C oder Fenster schließen.
cd "$(dirname "$0")" || exit 1
PORT=8765
echo "poolmaris Pool-Konfigurator läuft auf http://localhost:$PORT/app/"
( sleep 1; open "http://localhost:$PORT/app/" ) &
exec python3 -m http.server "$PORT" --bind 127.0.0.1
cd ~/Documents/poolmaris/Pool-Konfigurator && ./start.command
http://localhost:8765/app/
