"use strict";

const t = key => browser.i18n.getMessage(key);

// ---------- Settings ----------
// glass: translucent toolbars (needs huewolf-glass.css and Mica/acrylic).
// glassOpacity: % of site colour in the glass (0 = transparent, 100 = opaque).
// autoHideSingle: hide the tab row when there is only one tab.
// neutralLight / neutralDark: colour for pages without a background and for
//   internal pages (new tab, settings, add-ons, PDF...) in light / dark mode.
const DEFAULTS = {
  glass: true,
  glassOpacity: 18,
  autoHideSingle: true,
  neutralLight: "#ffffff",
  neutralDark: "#3a3a3c"
};
let settings = { ...DEFAULTS };

// Colour per tab (so switching tabs re-tints instantly).
// NEUTRAL = internal page or no colour: resolved on demand, so it follows
// light/dark mode and the settings.
const NEUTRAL = "neutral";
const tabColors = new Map();
// State per window: { color, key, dark }.
const windowState = new Map();

const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
const hex = c => "#" + [c.r, c.g, c.b].map(v => clamp(v).toString(16).padStart(2, "0")).join("");
const rgba = (c, a) => `rgba(${clamp(c.r)}, ${clamp(c.g)}, ${clamp(c.b)}, ${a})`;
const mix = (a, b, k) => ({ r: a.r + (b.r - a.r) * k, g: a.g + (b.g - a.g) * k, b: a.b + (b.b - a.b) * k });
const lum = c => {
  const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
};
const valid = c => c && [c.r, c.g, c.b].every(Number.isFinite);
const isDark = c => lum(c) < 0.179; // point where light text gives more contrast
const systemDark = () => matchMedia("(prefers-color-scheme: dark)").matches;
const fromHex = (s, fallback) => {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(s || "");
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : fallback;
};

// Default colour (white in light mode, grey in dark mode, or the one chosen
// in Settings).
const neutralColor = () => systemDark()
  ? fromHex(settings.neutralDark, { r: 58, g: 58, b: 60 })
  : fromHex(settings.neutralLight, { r: 255, g: 255, b: 255 });
const resolve = c => c === NEUTRAL ? neutralColor() : c;

// Can the extension read this page? Internal pages (about:, new tab,
// settings, add-ons, moz-extension:, view-source:, reader...) cannot: for
// them the neutral colour is applied immediately, without waiting for
// anything to fail.
const canScript = url => /^(https?|file):/i.test(url || "");

// Promise with a time limit: some privileged pages never answer (neither
// yes nor no), which used to leave the previous site's tint in place.
const withTimeout = (p, ms) => Promise.race([
  p, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
]);

function buildTheme(c) {
  const dark = isDark(c);
  const fg = dark ? { r: 245, g: 245, b: 247 } : { r: 29, g: 29, b: 31 };
  const field = mix(c, fg, 0.09);
  const bar = settings.glass ? rgba(c, settings.glassOpacity / 100) : hex(c);
  return {
    colors: {
      frame: hex(c),
      frame_inactive: hex(c),
      toolbar: bar,
      tab_selected: hex(mix(c, fg, 0.13)),
      tab_text: hex(fg),
      tab_background_text: hex(fg),
      tab_line: "transparent",
      toolbar_text: hex(fg),
      icons: hex(fg),
      toolbar_field: hex(field),
      toolbar_field_text: hex(fg),
      toolbar_field_border: "transparent",
      toolbar_field_focus: hex(field),
      toolbar_field_text_focus: hex(fg),
      toolbar_field_border_focus: rgba(fg, 0.25),
      toolbar_top_separator: "transparent",
      toolbar_bottom_separator: "transparent",
      toolbar_vertical_separator: rgba(fg, 0.15),
      bookmark_text: hex(fg),
      // Menus and dropdowns matching the toolbar.
      popup: hex(mix(c, dark ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 }, 0.35)),
      popup_text: hex(fg),
      popup_border: rgba(fg, 0.12),
      popup_highlight: rgba(fg, 0.1),
      popup_highlight_text: hex(fg),
      sidebar: hex(c),
      sidebar_text: hex(fg),
      sidebar_border: rgba(fg, 0.12)
    },
    // Menus and the Windows material are light or dark to match the
    // toolbar; websites follow the system mode.
    properties: {
      color_scheme: dark ? "dark" : "light",
      content_color_scheme: "system"
    }
  };
}

async function applyColor(windowId, color, force = false) {
  const key = `${hex(color)}|${settings.glass}|${settings.glassOpacity}`;
  const prev = windowState.get(windowId);
  if (!force && prev?.key === key) return;
  windowState.set(windowId, { color, key, dark: isDark(color) });
  renderIcon(windowId);
  try {
    await browser.theme.update(windowId, buildTheme(color));
  } catch (err) {
    windowState.delete(windowId);
    console.error("Huewolf: theme.update failed", err);
  }
}

function showNeutral(tab) {
  tabColors.set(tab.id, NEUTRAL);
  if (tab.active) applyColor(tab.windowId, neutralColor());
}

async function reapplyAll() {
  for (const [id, st] of windowState) applyColor(id, st.color, true);
}

// Ask the active tab for its colour.
// - Internal page → neutral colour right away.
// - Website → ask the page script (or inject it if the tab was opened
//   before installing). If it does not answer and the page has finished
//   loading (PDF, protected Mozilla domains...) → neutral colour.
async function refreshTab(tab) {
  if (!tab || !tab.active) return;
  const url = tab.url || "";

  if (!canScript(url)) {
    // A new tab briefly goes through about:blank: waiting for the real
    // page avoids a flicker.
    if (url === "about:blank" && tab.status === "loading") return;
    showNeutral(tab);
    return;
  }

  try {
    await withTimeout(browser.tabs.sendMessage(tab.id, { type: "refresh" }), 600);
    return;
  } catch (_) {}
  try {
    await withTimeout(browser.tabs.executeScript(tab.id, { file: "content.js", runAt: "document_end" }), 1500);
    return;
  } catch (_) {}

  // No answer: check the tab's current state.
  let now;
  try { now = await browser.tabs.get(tab.id); } catch (_) { return; }
  if (!now.active || now.url !== url) return;   // something else now: another call handles it
  if (now.status !== "complete") return;          // still loading: it will report when done
  showNeutral(now);
}

const refreshActiveTabs = () =>
  browser.tabs.query({ active: true }).then(tabs => tabs.forEach(refreshTab)).catch(() => {});

browser.runtime.onMessage.addListener((msg, sender) => {
  const tab = sender.tab;
  if (msg?.type !== "page-color" || !tab || !valid(msg.color)) return;
  // Late message from a page that is gone (e.g. Settings was opened).
  if (!canScript(tab.url)) return;
  tabColors.set(tab.id, msg.color);
  if (tab.active) applyColor(tab.windowId, msg.color);
});

browser.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  const cached = tabColors.get(tabId);
  if (cached) applyColor(windowId, resolve(cached));
  try { refreshTab(await browser.tabs.get(tabId)); } catch (_) {}
});

browser.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url && !canScript(info.url)) tabColors.set(tabId, NEUTRAL);
  if (!tab.active) return;
  if (info.url) {
    // To an internal page: right away. To a website (including in-page
    // navigation on sites like YouTube): a little later, once it has painted.
    if (!canScript(info.url)) refreshTab(tab);
    else setTimeout(() => browser.tabs.get(tabId).then(refreshTab, () => {}), 150);
  } else if (info.status === "complete") {
    refreshTab(tab);
  }
}, { properties: ["url", "status"] });

browser.tabs.onRemoved.addListener(tabId => tabColors.delete(tabId));
browser.windows.onRemoved.addListener(windowId => windowState.delete(windowId));

// When returning to a window, make sure its tint matches its tab.
browser.windows.onFocusChanged.addListener(windowId => {
  if (windowId === browser.windows.WINDOW_ID_NONE) return;
  browser.tabs.query({ active: true, windowId }).then(tabs => tabs.forEach(refreshTab)).catch(() => {});
});

// If the system light/dark mode changes, update every window.
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", refreshActiveTabs);

// ---------- Button to hide / show the tab row ----------
// The extension cannot touch the interface directly: it changes the button
// title IN EACH WINDOW and userChrome.css hides that window's row when the
// title is "Show tabs" (in the browser's language). All logic lives here:
//   hidden = hidden by hand  ||  (one tab and auto-hide, unless "Show" was
//            clicked in that window)
// If you add a translation, also add its "actionShow" text to the CSS
// selectors in chrome/huewolf.css.
const TITLE_SHOW = t("actionShow");
const TITLE_HIDE = t("actionHide");
let tabsHidden = false;            // hidden by hand (remembered)
const forceShow = new Set();       // single-tab windows where "Show" was clicked
const tabCounts = new Map();       // window → number of tabs
const hiddenIn = windowId =>
  tabsHidden ||
  (settings.autoHideSingle && tabCounts.get(windowId) === 1 && !forceShow.has(windowId));

// Light icon on dark toolbars and vice versa.
function renderIcon(windowId) {
  const st = windowState.get(windowId);
  const dark = st ? st.dark : systemDark();
  const name = (hiddenIn(windowId) ? "tabs-off-" : "tabs-") + (dark ? "light" : "dark");
  browser.browserAction.setIcon({ windowId, path: `icons/${name}.svg` }).catch(() => {});
  // Badge contrasting with the toolbar: light on dark, dark on light.
  browser.browserAction.setBadgeBackgroundColor({ windowId, color: dark ? "#f5f5f7" : "#1d1d1f" }).catch(() => {});
  browser.browserAction.setBadgeTextColor({ windowId, color: dark ? "#1d1d1f" : "#ffffff" }).catch(() => {});
}

// Counts tabs and sets the badge, the title (read by the CSS) and the icon.
// ignoreTabId: when closing a tab, Firefox may still return it in query.
async function renderWindow(windowId, ignoreTabId) {
  try {
    const tabs = await browser.tabs.query({ windowId });
    const n = tabs.filter(tab => tab.id !== ignoreTabId).length;
    tabCounts.set(windowId, n);
    // With several tabs again, the forced "Show" is no longer needed:
    // next time only one is left, the row hides on its own again.
    if (n > 1) forceShow.delete(windowId);
    await browser.browserAction.setTitle({ windowId, title: hiddenIn(windowId) ? TITLE_SHOW : TITLE_HIDE });
    await browser.browserAction.setBadgeText({ windowId, text: n > 99 ? "99+" : String(n) });
    renderIcon(windowId);
  } catch (_) {}
}

async function renderAllWindows() {
  for (const w of await browser.windows.getAll()) renderWindow(w.id);
}

browser.tabs.onCreated.addListener(tab => renderWindow(tab.windowId));
browser.tabs.onRemoved.addListener((tabId, info) => {
  if (!info.isWindowClosing) renderWindow(info.windowId, tabId);
});
browser.tabs.onAttached.addListener((_, info) => renderWindow(info.newWindowId));
browser.tabs.onDetached.addListener((tabId, info) => renderWindow(info.oldWindowId, tabId));
browser.windows.onCreated.addListener(w => renderWindow(w.id));
browser.windows.onRemoved.addListener(windowId => {
  forceShow.delete(windowId);
  tabCounts.delete(windowId);
});

// Click: does what that window's title says.
browser.browserAction.onClicked.addListener(async tab => {
  const windowId = tab.windowId;
  if (hiddenIn(windowId)) {
    tabsHidden = false;
    if (tabCounts.get(windowId) === 1) forceShow.add(windowId);
  } else {
    tabsHidden = true;
    forceShow.clear();
  }
  browser.storage.local.set({ tabsHidden }).catch(() => {});
  renderAllWindows();
});

// ---------- Button menu (right-click) ----------
function buildMenu() {
  browser.menus.removeAll().then(() => {
    browser.menus.create({
      id: "glass",
      type: "checkbox",
      title: t("menuGlass"),
      checked: settings.glass,
      contexts: ["browser_action"]
    });
    browser.menus.create({
      id: "autoHideSingle",
      type: "checkbox",
      title: t("menuAutoHide"),
      checked: settings.autoHideSingle,
      contexts: ["browser_action"]
    });
    browser.menus.create({ id: "sep", type: "separator", contexts: ["browser_action"] });
    browser.menus.create({
      id: "options",
      title: t("menuOptions"),
      contexts: ["browser_action"]
    });
  });
}

browser.menus.onClicked.addListener(info => {
  if (info.menuItemId === "glass") browser.storage.local.set({ glass: info.checked });
  if (info.menuItemId === "autoHideSingle") browser.storage.local.set({ autoHideSingle: info.checked });
  if (info.menuItemId === "options") browser.runtime.openOptionsPage();
});

// ---------- Settings changes (from the menu or the settings page) ----------
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  for (const k of Object.keys(DEFAULTS)) {
    if (k in changes) settings[k] = changes[k].newValue ?? DEFAULTS[k];
  }
  if ("glass" in changes) browser.menus.update("glass", { checked: settings.glass }).catch(() => {});
  if ("autoHideSingle" in changes) {
    browser.menus.update("autoHideSingle", { checked: settings.autoHideSingle }).catch(() => {});
    renderAllWindows();
  }
  if ("glass" in changes || "glassOpacity" in changes) reapplyAll();
  // Open websites are notified too (content.js listens to the same change).
  if ("neutralLight" in changes || "neutralDark" in changes) refreshActiveTabs();
});

// ---------- Startup ----------
browser.storage.local.get({ ...DEFAULTS, tabsHidden: false }).then(r => {
  for (const k of Object.keys(DEFAULTS)) settings[k] = r[k];
  tabsHidden = r.tabsHidden === true;
}).catch(() => {}).finally(() => {
  buildMenu();
  renderAllWindows();
  // Tint the active tab of each window.
  refreshActiveTabs();
});
