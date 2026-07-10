---
name: mint-experimente
description: Generiert neue Experimente für den MINT-Bot-Pool und verlängert den Tages-Schedule. Aufrufen, wenn die ⚠️-Push-Nachricht kommt ("Nur noch X Tage geplant") oder auf Wunsch. Optionales Argument = Anzahl und/oder Kategorie, z.B. "/mint-experimente 30" oder "/mint-experimente 20 weltraum-physik".
---

# Neue MINT-Bot-Experimente generieren

Du erweiterst den kuratierten Experimente-Pool (`data/experiments.json`) und den Tagesplan (`data/schedule.json`). Standard: **30 neue Experimente**, gleichmäßig über die Kategorien; danach den Schedule so verlängern, dass wieder mindestens 90 Tage abgedeckt sind.

## Zielgruppe (unbedingt beachten)

Kind, geboren 2020, hochfunktionaler Autismus + ADHS, sehr interessiert. Ein Elternteil liest vor und begleitet. Daraus folgt für jede Formulierung:

- **Wörtlich und konkret**: keine Ironie, keine unaufgelösten Metaphern. Nichts als "Magie" verkaufen — immer erklären, was wirklich passiert.
- **Kurze Sätze**, ein Gedanke pro Satz. Schritte = eine konkrete Handlung pro Schritt.
- **Vorhersehbarkeit**: Wartezeiten und Überraschungsmomente (Knall, lautes Geräusch) explizit ankündigen (`wartezeit`, `sensorik`, `elternInfo`).
- **5–15 Min aktive Zeit** (ADHS-Aufmerksamkeitsspanne), `nochmalTauglich: true` bevorzugen — Wiederholung ist erwünscht.
- **Nur Haushaltsmaterial**, sicher für 5–6-Jährige; alles Heiße/Scharfe/Elektrische ist explizit Erwachsenen-Schritt ("Ein Erwachsener ...") und steht in `elternInfo`.
- Nur klassische, physikalisch/chemisch korrekte, erprobte Heimexperimente — nichts erfinden, das nicht zuverlässig funktioniert.

## Schema

Ein Eintrag in `data/experiments.json` (Pflichtfelder, geprüft von `scripts/validate.mjs`):

```json
{
  "id": "kebab-case-eindeutig",
  "titel": "Kurzer konkreter Titel",
  "emoji": "🌋",
  "kategorie": "weltraum-physik | natur-tiere | technik | kuechenchemie",
  "typ": "experiment | beispiel",
  "fakt": "1-2 Sätze, kindgerecht, als Aufhänger (min. 20 Zeichen)",
  "dauerMinuten": 10,
  "wartezeit": null,
  "ort": "drinnen | draussen | egal",
  "sensorik": ["laut", "nass", "matschig", "klebrig", "riecht", "knall", "dunkel", "sprudelt", "kalt"],
  "material": ["..."],
  "elternInfo": "Vorbereitung/Stolperfallen für Eltern, 1-2 Sätze",
  "schritte": [{ "text": "Ein kurzer Satz, eine Handlung (max. 160 Zeichen).", "emoji": "🥄" }],
  "wasPassiert": "Beobachtung in Kindersprache",
  "erklaerung": "Die Wissenschaft dahinter, kindgerecht, 3-4 Sätze",
  "nochmalTauglich": true
}
```

Regeln: 3–6 Schritte; `sensorik` nur aus der Enum-Liste; `wartezeit` als String, wenn es eine gibt ("2 Tage – zwischendurch gucken"), sonst `null`; `typ: "beispiel"` für anschauliche Demos ohne echten Versuchsaufbau (Fallback, sparsam einsetzen).

## Vorgehen

1. Lies `data/experiments.json` und sammle alle vorhandenen `id`s und `titel` — **keine Duplikate oder nahen Varianten** davon generieren.
2. Generiere die gewünschte Anzahl neuer Einträge (Standard 30, gleichmäßig über die 4 Kategorien; wenn der Aufruf eine Kategorie nennt, nur diese). Hänge sie an das Array an.
3. Verlängere den Schedule mit `node scripts/build-schedule.mjs <tage>`, bis ab heute wieder ≥ 90 Tage abgedeckt sind (das Script mischt Kategorien und vermeidet zwei gleiche hintereinander).
4. Validiere: `node scripts/validate.mjs` muss "Alles gültig ✔" ausgeben.
5. Erstelle einen Branch, committe `data/experiments.json` + `data/schedule.json`, pushe und öffne einen **Pull Request** mit einer kurzen Liste der neuen Titel pro Kategorie. Andreas reviewt und mergt; der Merge deployt automatisch via Vercel.
