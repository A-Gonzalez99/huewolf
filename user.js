// Huewolf — copy this file to the root of your LibreWolf profile folder
// (the one that contains the chrome folder) and restart the browser.

// Allow chrome/userChrome.css to load.
user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);

// Glass version only (huewolf-glass.css), Windows 11:
// Windows translucent material behind the window.
user_pref("widget.windows.mica", true);
// 0 = automatic, 1 = mica (desktop wallpaper only), 2 = acrylic (blurs what is behind), 3 = alternative mica
user_pref("widget.windows.mica.toplevel-backdrop", 2);
