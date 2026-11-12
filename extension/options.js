"use strict";

// ---------- Translations (from _locales) ----------
document.documentElement.lang = browser.i18n.getUILanguage();
for (const el of document.querySelectorAll("[data-i18n]")) {
  const text = browser.i18n.getMessage(el.dataset.i18n);
  if (text) el.textContent = text;
}
for (const el of document.querySelectorAll("[data-i18n-title]")) {
  const text = browser.i18n.getMessage(el.dataset.i18nTitle);
  if (text) el.title = text;
}

const DEFAULTS = {
  glass: true,
  glassOpacity: 18,
  autoHideSingle: true,
  neutralLight: "#ffffff",
  neutralDark: "#3a3a3c"
};
const $ = id => document.getElementById(id);
const glass = $("glass");
const opacity = $("opacity");
const out = $("opacity-value");
const row = $("opacity-row");
const autohide = $("autohide");
const neutralLight = $("neutral-light");
const neutralDark = $("neutral-dark");
const previewBar = $("preview-bar");
const previewWin = $("preview-win");

const save = obj => browser.storage.local.set(obj).catch(() => {});

function renderGlass(on, value) {
  row.classList.toggle("disabled", !on);
  opacity.disabled = !on;
  out.value = `${value} %`;
  previewBar.style.setProperty("--alpha", on ? value / 100 : 1);
}

function render(s) {
  glass.checked = s.glass;
  opacity.value = s.glassOpacity;
  autohide.checked = s.autoHideSingle;
  neutralLight.value = s.neutralLight;
  neutralDark.value = s.neutralDark;
  renderGlass(s.glass, s.glassOpacity);
}

browser.storage.local.get(DEFAULTS).then(render);

glass.addEventListener("change", () => {
  save({ glass: glass.checked });
  renderGlass(glass.checked, Number(opacity.value));
});

// Live preview while dragging, saving slightly debounced.
let timer = 0;
opacity.addEventListener("input", () => {
  const v = Number(opacity.value);
  renderGlass(glass.checked, v);
  clearTimeout(timer);
  timer = setTimeout(() => save({ glassOpacity: v }), 60);
});

autohide.addEventListener("change", () => save({ autoHideSingle: autohide.checked }));

// Default colours: applied when the picker is released.
neutralLight.addEventListener("change", () => save({ neutralLight: neutralLight.value }));
neutralDark.addEventListener("change", () => save({ neutralDark: neutralDark.value }));
$("reset-neutral").addEventListener("click", () => {
  neutralLight.value = DEFAULTS.neutralLight;
  neutralDark.value = DEFAULTS.neutralDark;
  save({ neutralLight: DEFAULTS.neutralLight, neutralDark: DEFAULTS.neutralDark });
});

// Preview swatches: how it looks over sites of different colours.
$("chips").addEventListener("click", e => {
  const b = e.target.closest("button[data-tint]");
  if (!b) return;
  for (const o of b.parentElement.children) o.setAttribute("aria-pressed", String(o === b));
  previewWin.style.setProperty("--tint", b.dataset.tint);
  const [r, g, bl] = b.dataset.tint.split(",").map(Number);
  const dark = 0.2126 * r + 0.7152 * g + 0.0722 * bl < 110;
  const field = previewBar.querySelector(".field");
  field.style.color = dark ? "rgba(255,255,255,.75)" : "rgba(0,0,0,.65)";
  field.style.background = dark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.08)";
  for (const d of previewBar.querySelectorAll(".dots i")) {
    d.style.background = dark ? "rgba(255,255,255,.3)" : "rgba(0,0,0,.18)";
  }
});

// If something is changed from the button menu while this page is open.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (Object.keys(changes).some(k => k in DEFAULTS)) {
    browser.storage.local.get(DEFAULTS).then(render);
  }
});
