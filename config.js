/* Soteria by DrSkyle: project links.
 * Empty values simply hide the matching buttons.
 *   supportUrl   donation page (GitHub Sponsors, Ko-fi, Buy Me a Coffee...)
 *   sourceUrl    public source repository
 *   partnerUrl   hosted partner page (dist/partner.html)
 */
(function (root) {
  "use strict";
  const DVL = (root.DevilabsSoteria = root.DevilabsSoteria || {});
  DVL.config = Object.freeze({
    supportUrl: "https://www.patreon.com/cw/DrSkyle/membership",
    sourceUrl: "https://github.com/DrSkyle/soteria",
    partnerUrl: "",
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
