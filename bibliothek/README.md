# 📚 MINT-Bibliothek

Geschützte Nur-Lese-Seite für Bekannte: alle bisherigen Themen des MINT-Bots,
mit Suche, Filtern und dem gewohnten Schritt-für-Schritt-Ablauf. Kein Heute,
kein Morgen, kein Geschafft, keine Sterne, kein Erklär-Helfer.

**Seite:** https://mint-bibliothek.vercel.app

## Warum sie das Original nicht verändern kann

Das Projekt hat keine Datenbank-Zugangsdaten (`MINT_DB_URL`, `MINT_WRITE_TOKEN`)
und ruft keine Endpoints der Haupt-App auf. Die Häkchen landen nur im
`localStorage` der Besucher (`bib.steps.<id>`). Das ist Absicht, nicht Lücke.

## Woher die Daten kommen

`build.mjs` kopiert beim Deploy aus dem Repo-Root:

- `style.css` → gleiches Design ohne Kopie im Repo
- `data/experiments.json`, `data/schedule.json`, `data/videos.json` → `bibliothek/data/`
  (nicht öffentlich; nur `/api/themen` liefert sie, mit Login)

„Bisherig“ = im Plan mit Datum bis heute (Europe/Berlin). Jeder Push auf `main`
deployt beide Projekte, also kommen neue Themen und Videos automatisch mit.

## Zugang

Ein Code pro Person, gespeichert in `BIB_ZUGAENGE` (`name:code,…`). Das
Session-Cookie gilt 180 Tage, wird aber bei jedem Aufruf gegen die Liste
geprüft: wer gesperrt ist, fliegt beim nächsten Laden raus.

```sh
node scripts/zugang.mjs neu anna        # Code erzeugen, Vercel aktualisieren, neu ausrollen
node scripts/zugang.mjs sperren anna    # Zugang entziehen
node scripts/zugang.mjs liste           # wer hat Zugang (ohne Codes)
```

Die Codes liegen nur lokal im Obsidian-Vault unter
`Manual Notes/Zugaenge/MINT-Bibliothek.md`. Der Ordner steht in der
`.brainignore` und geht deshalb nie in die Second-Brain-Datenbank.

## Videos

`data/videos.json` im Repo-Root, eine Zeile pro freigegebenem ErklärBär-Video:

```json
"papier-bruecke": [{ "sprache": "de", "url": "https://youtu.be/3WRz9lP5uV8" }]
```

Nur öffentliche oder nicht gelistete Videos eintragen, private spielen für
Bekannte nicht. `npm run validate` prüft ID, URL und Sprache.

## Einrichtung (einmalig)

- Vercel-Projekt `mint-bibliothek`, gleiches GitHub-Repo, **Root Directory `bibliothek`**.
  „Include files outside the root directory“ muss an sein, sonst findet `build.mjs` die Daten nicht.
- Env-Vars (Production):
  - `BIB_SESSION_SECRET`: 64 Hex-Zeichen, `openssl rand -hex 32`
  - `BIB_ZUGAENGE`: nur über `scripts/zugang.mjs` pflegen
