/* MINT-Bot – tägliche Science Facts & Experimente für zuhause.
   Vanilla JS, kein Build-Step. Fortschritt liegt im localStorage dieses Geräts. */
"use strict";

// Einfacher Mitbenutzungs-Schutz für die LLM-Endpoints (siehe api/_claude.js).
const APP_TOKEN = "mint-bot-familie";

const SENSORIK = {
  laut: { icon: "🔊", label: "laut" },
  nass: { icon: "💧", label: "nass" },
  matschig: { icon: "🟤", label: "matschig" },
  klebrig: { icon: "🍯", label: "klebrig" },
  riecht: { icon: "👃", label: "riecht" },
  knall: { icon: "💥", label: "knallt" },
  dunkel: { icon: "🌑", label: "dunkel" },
  sprudelt: { icon: "🫧", label: "sprudelt" },
  kalt: { icon: "❄️", label: "kalt" },
};

const KATEGORIEN = {
  "weltraum-physik": { icon: "🚀", label: "Weltraum & Physik" },
  "natur-tiere": { icon: "🐞", label: "Natur & Tiere" },
  technik: { icon: "⚙️", label: "Technik & Maschinen" },
  kuechenchemie: { icon: "🧪", label: "Küchen-Chemie" },
};

const state = { experiments: [], schedule: {}, byId: new Map(), tab: "heute", detailId: null };

// ---------- Datum (immer Europe/Berlin, egal wo das Gerät steht) ----------
function berlinDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
}
function prettyDate(iso) {
  return new Date(iso + "T12:00:00").toLocaleDateString("de-DE", {
    weekday: "long", day: "numeric", month: "long",
  });
}

// ---------- Auswahl des Tages-Experiments ----------
function experimentForDate(dateStr) {
  const id = state.schedule[dateStr];
  if (id && state.byId.has(id)) return state.byId.get(id);
  // Fallback: deterministische Auswahl, damit die App nie leer ist.
  let hash = 0;
  for (const ch of dateStr) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return state.experiments[hash % state.experiments.length];
}

// ---------- localStorage ----------
const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) { localStorage.setItem(key, JSON.stringify(value)); },
};
const getDone = () => store.get("mint.done", []); // [{id, date}]
const getFavs = () => store.get("mint.favs", []);
const stepsKey = (ctx) => `mint.steps.${ctx}`;

// ---------- Rendering-Helfer ----------
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? "" : v);
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

// ---------- Eltern-Bereich ----------
function parentBox(exp, { open = false, materialProminent = false } = {}) {
  const kat = KATEGORIEN[exp.kategorie];
  const badges = el("div", { class: "badge-row" },
    el("span", { class: "badge" }, `${kat.icon} ${kat.label}`),
    el("span", { class: "badge" }, `⏱️ ca. ${exp.dauerMinuten} Min`),
    exp.sensorik.map((s) => el("span", { class: "badge" }, `${SENSORIK[s].icon} ${SENSORIK[s].label}`)),
    exp.wartezeit ? el("span", { class: "badge warn" }, `⏳ Wartezeit: ${exp.wartezeit}`) : null,
    exp.ort === "draussen" ? el("span", { class: "badge" }, "🌳 draußen") : null,
  );
  const material = el("ul", { class: "material-list" },
    exp.material.map((m) =>
      el("li", {}, el("input", { type: "checkbox", "aria-label": `${m} bereitgelegt` }), m)
    )
  );
  return el("details", { class: "card parent-box", open: open || materialProminent },
    el("summary", {}, "👋 Für Eltern: Vorbereitung"),
    badges,
    el("p", { class: "parent-info" }, exp.elternInfo),
    el("div", { class: "section-title" }, "🧺 Das braucht ihr:"),
    material,
  );
}

// ---------- LLM-Anbindung ----------
async function askApi(endpoint, payload) {
  const res = await fetch(`/api/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Mint-Token": APP_TOKEN },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data.text;
}

function llmErrorBox(e) {
  const hint = /nicht eingerichtet|501/.test(String(e.message))
    ? "Der Erklär-Helfer ist noch nicht eingerichtet (ANTHROPIC_API_KEY fehlt auf Vercel)."
    : "Der Erklär-Helfer ist gerade nicht erreichbar. Fragt einfach später nochmal.";
  return el("div", { class: "llm-error" }, `🙁 ${hint}`);
}

function stepHelpButton(exp, step, container) {
  return el("button", {
    class: "step-help-btn",
    "aria-label": "Hilfe zu diesem Schritt",
    onclick: async (ev) => {
      ev.stopPropagation();
      const old = container.querySelector(".help-answer, .llm-error, .llm-loading");
      if (old) { old.remove(); return; }
      const loading = el("div", { class: "llm-loading" }, "💭 Ich überlege …");
      container.append(loading);
      try {
        const text = await askApi("help", { titel: exp.titel, fakt: exp.fakt, schritt: step.text });
        loading.replaceWith(el("div", { class: "help-answer" }, text));
      } catch (e) {
        loading.replaceWith(llmErrorBox(e));
      }
    },
  }, "❓");
}

function detailsAskBox(exp) {
  const answers = el("div");
  const input = el("input", {
    type: "text",
    placeholder: "Deine Frage dazu … (optional)",
    "aria-label": "Eigene Frage zum Thema",
  });
  async function ask(frage) {
    const loading = el("div", { class: "llm-loading" }, "💭 Ich überlege …");
    answers.append(loading);
    try {
      const text = await askApi("details", {
        titel: exp.titel, fakt: exp.fakt, erklaerung: exp.erklaerung, frage: frage || null,
      });
      loading.replaceWith(el("div", { class: "llm-answer" }, text));
    } catch (e) {
      loading.replaceWith(llmErrorBox(e));
    }
  }
  return el("div", { class: "ask-box" },
    el("button", { class: "btn btn-secondary", onclick: () => ask(null) }, "🔍 Mehr wissen"),
    answers,
    el("div", { class: "ask-row" },
      input,
      el("button", {
        class: "btn btn-secondary",
        onclick: () => { if (input.value.trim()) { ask(input.value.trim()); input.value = ""; } },
      }, "Fragen")
    ),
  );
}

// ---------- Experiment-Karte ----------
function experimentCard(exp, { date, stepsContext, showDone = true } = {}) {
  const frag = document.createDocumentFragment();
  frag.append(parentBox(exp, { open: false }));

  frag.append(el("div", { class: "card hero" },
    el("span", { class: "big-emoji" }, exp.emoji),
    el("h1", {}, exp.titel),
    el("p", { class: "fakt" }, exp.fakt),
  ));

  // Schritte mit Abhaken + Fortschrittsbalken
  const ctx = stepsContext ?? `${date}`;
  let checked = new Set(store.get(stepsKey(ctx), []));
  const progressLabel = el("div", { class: "progress" });
  const progressFill = el("div");
  const updateProgress = () => {
    progressLabel.textContent = `${checked.size} von ${exp.schritte.length} Schritten geschafft`;
    progressFill.style.width = `${(checked.size / exp.schritte.length) * 100}%`;
  };

  const stepsWrap = el("div");
  exp.schritte.forEach((step, i) => {
    const answerSlot = el("div");
    const btn = el("button", {
      class: "step" + (checked.has(i) ? " done" : ""),
      "aria-pressed": checked.has(i) ? "true" : "false",
      onclick: () => {
        if (checked.has(i)) checked.delete(i); else checked.add(i);
        btn.classList.toggle("done", checked.has(i));
        btn.setAttribute("aria-pressed", checked.has(i) ? "true" : "false");
        store.set(stepsKey(ctx), [...checked]);
        updateProgress();
      },
    },
      el("span", { class: "step-num" }, String(i + 1)),
      el("span", { class: "step-emoji" }, step.emoji),
      el("span", { class: "step-text" }, step.text),
      stepHelpButton(exp, step, answerSlot),
    );
    stepsWrap.append(btn, answerSlot);
  });
  updateProgress();

  frag.append(
    el("div", { class: "section-title" }, "🧑‍🔬 Los geht's – Schritt für Schritt:"),
    progressLabel,
    el("div", { class: "progress-bar" }, progressFill),
    stepsWrap,
  );

  // Auflösung erst nach dem Ausprobieren aufklappen
  frag.append(el("details", { class: "reveal" },
    el("summary", {}, "👀 Was passiert da?"),
    el("p", {}, exp.wasPassiert),
  ));
  frag.append(el("details", { class: "reveal" },
    el("summary", {}, "🧠 Warum ist das so?"),
    el("p", {}, exp.erklaerung),
    detailsAskBox(exp),
  ));

  if (showDone) frag.append(actionRow(exp, date, ctx));
  return frag;
}

function actionRow(exp, date, ctx) {
  const doneToday = getDone().some((d) => d.id === exp.id && d.date === date);
  const favs = getFavs();

  const doneArea = el("div");
  if (doneToday) {
    doneArea.append(el("div", { class: "done-banner" }, "🏅 Geschafft! Super gemacht!"));
  } else {
    doneArea.append(el("button", {
      class: "btn btn-primary",
      onclick: (ev) => {
        const done = getDone();
        done.push({ id: exp.id, date });
        store.set("mint.done", done);
        confetti();
        ev.currentTarget.replaceWith(el("div", { class: "done-banner" }, "🏅 Geschafft! Super gemacht!"));
      },
    }, "🎉 Geschafft!"));
  }

  const favBtn = el("button", {
    class: "btn btn-secondary fav-btn" + (favs.includes(exp.id) ? " active" : ""),
    onclick: (ev) => {
      let f = getFavs();
      f = f.includes(exp.id) ? f.filter((x) => x !== exp.id) : [...f, exp.id];
      store.set("mint.favs", f);
      ev.currentTarget.classList.toggle("active", f.includes(exp.id));
      ev.currentTarget.textContent = f.includes(exp.id) ? "⭐ Auf der Nochmal-Liste" : "☆ Auf die Nochmal-Liste";
    },
  }, favs.includes(exp.id) ? "⭐ Auf der Nochmal-Liste" : "☆ Auf die Nochmal-Liste");

  return el("div", { class: "action-row" }, doneArea, favBtn);
}

// ---------- Konfetti (nur nach aktivem Tippen) ----------
function confetti() {
  const layer = document.getElementById("confetti-layer");
  const colors = ["#3a7d5d", "#d9a514", "#4a7fb5", "#c2604e", "#8e6bb0"];
  for (let i = 0; i < 80; i++) {
    const c = document.createElement("div");
    c.className = "confetto";
    c.style.left = Math.random() * 100 + "vw";
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 1.6 + Math.random() * 1.6 + "s";
    c.style.animationDelay = Math.random() * 0.4 + "s";
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    layer.append(c);
    setTimeout(() => c.remove(), 4000);
  }
}

// ---------- Ansichten ----------
function renderHeute(view) {
  const date = berlinDate(0);
  view.append(experimentCard(experimentForDate(date), { date }));
}

function renderMorgen(view) {
  const date = berlinDate(1);
  const exp = experimentForDate(date);
  view.append(el("div", { class: "preview-banner" },
    `🌙 Vorschau für Eltern – das kommt morgen (${prettyDate(date)}). Material heute schon bereitlegen und dem Kind ankündigen.`));
  view.append(parentBox(exp, { materialProminent: true }));
  view.append(el("div", { class: "card hero" },
    el("span", { class: "big-emoji" }, exp.emoji),
    el("h1", {}, exp.titel),
    el("p", { class: "fakt" }, exp.fakt),
  ));
}

function renderNochmal(view) {
  const favs = getFavs().map((id) => state.byId.get(id)).filter(Boolean);
  if (state.detailId) {
    const exp = state.byId.get(state.detailId);
    view.append(el("button", { class: "back-btn", onclick: () => { state.detailId = null; render(); } }, "← Zurück zur Liste"));
    view.append(experimentCard(exp, { date: berlinDate(0), stepsContext: `replay.${exp.id}` }));
    return;
  }
  if (!favs.length) {
    view.append(el("div", { class: "empty-state" },
      el("span", { class: "big-emoji" }, "⭐"),
      "Hier landen Experimente, die ihr nochmal machen wollt.", el("br"),
      "Tippt dafür beim Experiment auf „Auf die Nochmal-Liste“."));
    return;
  }
  favs.forEach((exp) => {
    view.append(el("button", {
      class: "list-item",
      onclick: () => { state.detailId = exp.id; render(); },
    },
      el("span", { class: "li-emoji" }, exp.emoji),
      el("span", {}, exp.titel, el("span", { class: "li-sub" }, `${KATEGORIEN[exp.kategorie].icon} ${KATEGORIEN[exp.kategorie].label} · ⏱️ ${exp.dauerMinuten} Min`)),
    ));
  });
}

function renderGeschafft(view) {
  const done = getDone().slice().sort((a, b) => b.date.localeCompare(a.date));
  if (state.detailId) {
    const exp = state.byId.get(state.detailId);
    view.append(el("button", { class: "back-btn", onclick: () => { state.detailId = null; render(); } }, "← Zurück zur Liste"));
    view.append(experimentCard(exp, { date: berlinDate(0), stepsContext: `replay.${exp.id}`, showDone: false }));
    return;
  }
  if (!done.length) {
    view.append(el("div", { class: "empty-state" },
      el("span", { class: "big-emoji" }, "🏅"),
      "Noch kein Experiment geschafft – heute ist ein guter Tag dafür!"));
    return;
  }
  view.append(el("div", { class: "done-banner" }, `🏅 Ihr habt schon ${done.length} Experiment${done.length === 1 ? "" : "e"} geschafft!`));
  done.forEach(({ id, date }) => {
    const exp = state.byId.get(id);
    if (!exp) return;
    view.append(el("button", {
      class: "list-item",
      onclick: () => { state.detailId = id; render(); },
    },
      el("span", { class: "li-emoji" }, exp.emoji),
      el("span", {}, exp.titel, el("span", { class: "li-sub" }, prettyDate(date))),
    ));
  });
}

// ---------- App-Gerüst ----------
function render() {
  const view = document.getElementById("view");
  view.replaceChildren();
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === state.tab));
  ({ heute: renderHeute, morgen: renderMorgen, nochmal: renderNochmal, geschafft: renderGeschafft })[state.tab](view);
  window.scrollTo(0, 0);
}

async function init() {
  document.getElementById("header-date").textContent = prettyDate(berlinDate(0));
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => { state.tab = t.dataset.tab; state.detailId = null; render(); }));
  try {
    const [experiments, schedule] = await Promise.all([
      fetch("data/experiments.json").then((r) => r.json()),
      fetch("data/schedule.json").then((r) => r.json()),
    ]);
    state.experiments = experiments;
    state.schedule = schedule;
    state.byId = new Map(experiments.map((e) => [e.id, e]));
    render();
  } catch (e) {
    document.getElementById("view").append(
      el("div", { class: "empty-state" }, "🙁 Die Experimente konnten nicht geladen werden. Bitte Seite neu laden."));
  }
}

init();
