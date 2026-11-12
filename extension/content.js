(() => {
  "use strict";
  // If the background script injects it again into a tab that already has
  // it, do not duplicate: just request a fresh report.
  if (typeof window.__huewolf === "function") {
    window.__huewolf();
    return;
  }

  // Default colour when the site has no background (the same one
  // background.js uses for internal pages). Can be changed in Settings.
  const fromHex = (s, fallback) => {
    const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(s || "");
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : fallback;
  };
  const FALLBACK_LIGHT = { r: 255, g: 255, b: 255 }; // white
  const FALLBACK_DARK = { r: 58, g: 58, b: 60 };     // grey #3a3a3c
  let defaultLight = FALLBACK_LIGHT;
  let defaultDark = FALLBACK_DARK;
  const setDefaults = s => {
    if ("neutralLight" in s) defaultLight = fromHex(s.neutralLight, FALLBACK_LIGHT);
    if ("neutralDark" in s) defaultDark = fromHex(s.neutralDark, FALLBACK_DARK);
  };

  // ---------- Colours ----------
  // Reads rgb()/rgba() and color(srgb ...). Any other format (oklch, lab,
  // names, hex from <meta>) is first converted to sRGB with color-mix.
  const alpha = a => a === undefined ? 1 : a.endsWith("%") ? parseFloat(a) / 100 : +a;
  const parse = s => {
    let m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(s);
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: alpha(m[4]) };
    m = /^color\(srgb\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i.exec(s);
    if (m) return { r: m[1] * 255, g: m[2] * 255, b: m[3] * 255, a: alpha(m[4]) };
    return null;
  };

  const toColor = value => {
    if (!value) return null;
    value = value.trim();
    const direct = parse(value);
    if (direct) return direct;
    const el = document.createElement("i");
    el.style.color = `color-mix(in srgb, ${value} 100%, transparent)`;
    if (!el.style.color) return null; // not a valid colour
    el.style.display = "none";
    document.documentElement.appendChild(el);
    const out = parse(getComputedStyle(el).color);
    el.remove();
    return out;
  };

  const solid = value => {
    const c = toColor(value);
    return c && c.a >= 0.5 ? { r: c.r, g: c.g, b: c.b } : null;
  };
  const close = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < 24;

  // Visible background of an element: the first ancestor with an opaque one.
  const backgroundAt = el => {
    for (; el && el.nodeType === 1; el = el.parentElement) {
      const c = solid(getComputedStyle(el).backgroundColor);
      if (c) return c;
    }
    return null;
  };

  // ---------- Detection, from most to least reliable ----------
  function detect() {
    // 1. <meta name="theme-color">, respecting media="(prefers-color-scheme: …)".
    for (const meta of document.querySelectorAll('meta[name="theme-color" i]')) {
      const media = meta.getAttribute("media");
      if (media) { try { if (!matchMedia(media).matches) continue; } catch (_) { continue; } }
      const c = solid(meta.getAttribute("content"));
      if (c) return c;
    }

    // 2. Colour of the top strip of the page (header), if uniform.
    const w = innerWidth;
    if (w > 0 && innerHeight > 0) {
      const top = [0.1, 0.5, 0.9]
        .map(x => backgroundAt(document.elementFromPoint(w * x, 2)))
        .filter(Boolean);
      for (const c of top) {
        if (top.filter(o => close(o, c)).length >= 2) return c;
      }
    }

    // 3. Background of the body or the document.
    const body = document.body && solid(getComputedStyle(document.body).backgroundColor);
    if (body) return body;
    const root = solid(getComputedStyle(document.documentElement).backgroundColor);
    if (root) return root;

    // 4. No background: the default. White in light mode, grey in dark.
    //    (If the site forces dark with color-scheme: dark, grey as well.)
    const scheme = (getComputedStyle(document.documentElement).colorScheme || "").trim();
    const dark = scheme === "dark" || matchMedia("(prefers-color-scheme: dark)").matches;
    return dark ? defaultDark : defaultLight;
  }

  // ---------- Reporting (only when it changes) ----------
  let last = "";
  let timer = 0;
  const send = force => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (document.hidden) return;
      let c;
      try { c = detect(); } catch (_) { return; }
      const key = `${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)}`;
      if (!force && key === last) return;
      last = key;
      browser.runtime.sendMessage({ type: "page-color", color: c }).catch(() => {});
    }, force ? 0 : 150);
  };
  window.__huewolf = () => send(true);

  browser.runtime.onMessage.addListener(m => {
    if (m?.type === "refresh") send(true);
  });

  // Settings changed while the site is open: recalculate.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !("neutralLight" in changes || "neutralDark" in changes)) return;
    setDefaults({
      ...("neutralLight" in changes && { neutralLight: changes.neutralLight.newValue }),
      ...("neutralDark" in changes && { neutralDark: changes.neutralDark.newValue })
    });
    send(true);
  });

  // First report as soon as the default colours are known.
  browser.storage.local.get(["neutralLight", "neutralDark"])
    .then(setDefaults, () => {})
    .finally(() => send(true));

  addEventListener("load", () => send(), { once: true });
  addEventListener("pageshow", () => send(true));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) send(true); });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => send());

  // Sites that paint late: a couple more checks.
  setTimeout(() => send(), 1000);
  setTimeout(() => send(), 3000);

  // Only watch what usually changes the colour (theme-color in <head> and
  // the classes/styles of <html> and <body> when switching to dark mode),
  // not the whole DOM.
  const observer = new MutationObserver(() => send());
  const opts = { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-color-mode"] };
  observer.observe(document.documentElement, opts);
  if (document.body) observer.observe(document.body, opts);
  if (document.head) observer.observe(document.head, {
    childList: true, subtree: true, attributes: true, attributeFilter: ["content", "media"]
  });
})();
