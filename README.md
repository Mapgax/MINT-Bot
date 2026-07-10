# 🔬 MINT-Bot

Jeden Tag ein Science Fact mit einem Experiment, das man sofort zuhause machen kann – gebaut für ein neugieriges Kind (geb. 2020) mit Fokus auf klare Struktur, Vorhersehbarkeit und sichtbaren Fortschritt.

**Web-App:** https://mint-bot.vercel.app *(URL ggf. anpassen)*

## Was es kann

- **Heute**: Tageskarte mit Fakt, Material-Checkliste, abhakbaren Schritt-Karten, „Was passiert?"-Auflösung und 🎉-Geschafft-Button mit Konfetti.
- **Morgen**: Eltern-Vorschau zum Material-Richten und Ankündigen.
- **Nochmal**: Favoriten-Liste für Experimente, die wiederholt werden wollen.
- **Geschafft**: Archiv aller erledigten Experimente.
- **❓ Hilfe / 🔍 Mehr wissen**: LLM-Erklär-Helfer (Claude) formuliert Schritte einfacher bzw. beantwortet Kinder-Fragen zum Thema.
- **Push**: morgens (7:00) die Tageskarte, abends (19:00) die Vorschau – per [ntfy.sh](https://ntfy.sh). Warnung, wenn der Experimente-Plan nur noch ≤10 Tage abdeckt.

## Einmaliges Setup

1. **ntfy-App installieren** ([Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy) / [iOS](https://apps.apple.com/app/ntfy/id1625396347)) und das Topic **`mint-bot-1e55da271c89`** abonnieren („+" → Topic-Name eingeben). Wer das Topic kennt, kann mitlesen – bei Bedarf in `scripts/notify.mjs` und als Repo-Variable `NTFY_TOPIC` ändern.
2. **Vercel**: Projekt mit diesem Repo verbinden (Import via vercel.com). Env-Var **`ANTHROPIC_API_KEY`** setzen (für die Hilfe-Buttons; [Spending-Limit](https://console.anthropic.com/) empfohlen). Ohne Key funktioniert alles außer den zwei LLM-Buttons.
3. **GitHub-Repo-Variablen** (Settings → Secrets and variables → Actions → Variables), optional: `NTFY_TOPIC` und `APP_URL` – sonst gelten die Defaults aus `scripts/notify.mjs`.

## Nachschub an Experimenten

Wenn die ⚠️-Push kommt („Nur noch X Tage geplant"): Claude-Code-Session auf diesem Repo starten und **`/mint-experimente`** aufrufen. Claude generiert ~30 neue Experimente nach festen Regeln (Schema, Sicherheits- und Formulierungs-Guidelines in `.claude/skills/mint-experimente/SKILL.md`) und öffnet einen Pull Request zum Review.

## Entwicklung

```sh
npm run validate                                   # Daten-Schema prüfen
npm run schedule -- 30                             # Schedule um 30 Tage verlängern
node scripts/notify.mjs morgen --dry-run --force   # Push testen ohne Senden
npx serve .                                        # App lokal (LLM-Buttons nur auf Vercel)
```

Projektüberblick für Claude-Sessions: `CLAUDE.md`.
