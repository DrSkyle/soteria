/* Soteria by DrSkyle: i18n.
 * Tiny translation helper. Picks the person's language (their setting, or the
 * browser's), falls back to English for anything missing, and fills in
 * {placeholders}. The translations are bundled in locales.js, so nothing is
 * fetched and it works in web pages, extension pages and tests alike.
 */
(function (root) {
  "use strict";

  const DVL = (root.DevilabsSoteria = root.DevilabsSoteria || {});
  const RTL = new Set(["ar", "he", "fa", "ur"]);
  let current = "en";

  const has = (code) => !!(DVL.locales && DVL.locales[code]);
  // "pt-BR" -> "pt", "zh-Hans-CN" -> "zh"; anything unknown -> English.
  function pick(code) {
    const base = String(code || "en").toLowerCase().split(/[-_]/)[0];
    return has(base) ? base : "en";
  }
  function browserLanguage() {
    const n = root.navigator;
    return n ? (n.languages && n.languages[0]) || n.language : "en";
  }
  function setLanguage(pref) {
    current = pref && pref !== "auto" ? pick(pref) : pick(browserLanguage());
    return current;
  }
  const language = () => current;
  const dir = () => (RTL.has(current) ? "rtl" : "ltr");

  function t(key, vars) {
    const table = (DVL.locales && DVL.locales[current]) || {};
    let s = table[key];
    if (s == null) s = DVL.locales && DVL.locales.en ? DVL.locales.en[key] : undefined;
    if (s == null) return key;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
  }

  // Fills a page from data attributes:
  //   data-i18n="key"                       -> the element's text
  //   data-i18n-attr="placeholder=key;aria-label=key2"  -> attributes
  function apply(doc) {
    const d = doc || root.document;
    d.documentElement.lang = current;
    d.documentElement.dir = dir();
    for (const el of d.querySelectorAll("[data-i18n]")) el.textContent = t(el.getAttribute("data-i18n"));
    for (const el of d.querySelectorAll("[data-i18n-attr]")) {
      for (const pair of el.getAttribute("data-i18n-attr").split(";")) {
        const [attr, key] = pair.split("=");
        if (attr && key) el.setAttribute(attr.trim(), t(key.trim()));
      }
    }
  }

  setLanguage("auto");
  DVL.i18n = Object.freeze({ t, apply, setLanguage, language, dir, pick });
  if (typeof module !== "undefined" && module.exports) module.exports = DVL.i18n;
})(typeof globalThis !== "undefined" ? globalThis : this);
