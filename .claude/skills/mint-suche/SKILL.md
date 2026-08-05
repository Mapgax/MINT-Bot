---
name: mint-suche
description: Durchsucht die MINT-Bot-Themenhistorie in der Datenbank – was wurde gemacht, was behalten, was verpasst. Aufrufen bei Fragen wie "welche Magnet-Experimente haben wir verpasst?", "was haben wir letzte Woche gemacht?", "haben wir schon was mit Luft gemacht?" oder "/mint-suche <thema>".
---

# MINT-Bot: Themen suchen

Beantwortet Fragen zur Historie des MINT-Bots. Datenquelle ist das Schema
`mint` in der second_brain-Datenbank auf Aiven, abgefragt über
`scripts/query.mjs`.

## Voraussetzung

`.env.local` im MINT-Bot-Verzeichnis muss `MINT_DB_URL_JOB` enthalten. Fehlt
sie, meldet das Script das und du sagst es dem Nutzer – rate nicht aus
`data/experiments.json`, denn dort steht kein Status.

## Die vier Status

| Status | Bedeutung |
|---|---|
| `neu` | war noch nie dran |
| `nochmal` | geschafft **und** mit Stern behalten – steht in der App auf der Nochmal-Liste |
| `archiviert` | geschafft, ohne Stern – taucht in der App nicht mehr auf, ist aber hier auffindbar |
| `fundus` | ein vergangener Tag ohne „geschafft" – keine Zeit gehabt, kann wieder eingeplant werden |

`archiviert` heißt **nicht** gelöscht. Genau dafür gibt es diese Suche.

## Befehle

Immer aus `/Users/andreas/Projects/AI/MINT-Bot` heraus ausführen.

```sh
node scripts/query.mjs magnet                  # Volltext, alle Status
node scripts/query.mjs magnet --status fundus  # nur Verpasstes
node scripts/query.mjs --status nochmal        # alles auf der Nochmal-Liste
node scripts/query.mjs --verlauf 30            # Tagesverlauf, letzte 30 Tage
node scripts/query.mjs magnet --json           # maschinenlesbar
```

Die Suche nutzt deutsches Stemming (`Magnete` findet `Magnet`) plus einen
Substring-Fallback, weil Postgres keine Komposita zerlegt.

## Vorgehen

1. Suchwort aus der Frage ableiten. Bei „was haben wir letzte Woche gemacht?"
   ist `--verlauf 7` richtig, nicht die Volltextsuche.
2. Passenden `--status`-Filter setzen, wenn die Frage einen nennt
   („verpasst" → `fundus`, „nochmal machen" → `nochmal`).
3. Ergebnis auf Deutsch zusammenfassen. Titel und Fakt nennen, Status in
   Klartext übersetzen („liegt im Fundus" statt „status=fundus").
4. Findet die Suche nichts, ein zweites Mal mit einem breiteren Wort probieren
   (`Magnet-Schatzsuche` → `magnet`), bevor du „nichts gefunden" meldest.

## Grenzen

- Der Status stammt aus der App. Solange ein Gerät seine Änderungen nicht
  synchronisiert hat, steht der betroffene Tag hier noch auf `fundus`.
- Neue Experimente erzeugt der Skill `/mint-experimente`, nicht dieser hier.
