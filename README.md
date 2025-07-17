# 1. Ins Projektverzeichnis wechseln
cd /pfad/zum/projekt

# 2. Git initialisieren (nur einmal nötig)
git init

# 3. Sicherstellen, dass der richtige Branch verwendet wird
git checkout -B main

# 4. Änderungen übernehmen
git add .

# 5. Commit erstellen
git commit -m "Automatisches Update durch Codex"

# 6. Direkt zu main pushen (ggf. mit --force, wenn nötig)
git push -u origin main
