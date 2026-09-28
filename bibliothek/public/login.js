"use strict";
const form = document.getElementById("login-form");
const meldung = document.getElementById("meldung");

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const knopf = form.querySelector("button");
  knopf.disabled = true;
  meldung.textContent = "";
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: form.code.value }),
    });
    if (res.ok) { location.replace("/"); return; }
    const daten = await res.json().catch(() => ({}));
    meldung.textContent = daten.error || "Das hat nicht geklappt.";
  } catch {
    meldung.textContent = "Keine Verbindung. Bitte später nochmal versuchen.";
  } finally {
    knopf.disabled = false;
  }
});
