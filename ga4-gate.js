/* GA4-poort — 10 september 2026.
 *
 * Waarom dit bestaat. gtag('config', ...) vuurde de page_view direct bij het
 * laden van de pagina. Alles wat JavaScript uitvoert telde dus als bezoeker, en
 * dat doen verificatiebots ook: op 10 sep kwamen 92 IP's binnen vijf seconden
 * langs nadat er YouTube-beschrijvingen waren aangepast. In onze eigen
 * logmeting worden die eruit gefilterd, maar GA4 kan dat niet — het bewaart
 * geen IP-adressen en biedt ze niet als dimensie, en zijn enige IP-knop wil een
 * vaste lijst ranges terwijl die zwerm over 933 verschillende /16's zat.
 *
 * Dus wordt de page_view hier pas verstuurd na een echt signaal: een handeling
 * van de bezoeker, of vier seconden zichtbaar aanwezig blijven. De meeste
 * verificatiebots laden, voeren uit en zijn binnen een seconde weg.
 *
 * De prijs, bewust geaccepteerd: wie binnen vier seconden wegklikt zonder iets
 * te doen, telt niet meer mee. Bij ons volume is dat een reëel verlies, maar een
 * cijfer dat je kunt vertrouwen is meer waard dan een hoger cijfer dat je niet
 * kunt uitleggen.
 *
 * Dit bestand staat los van de pagina's zodat een wijziging hier niet opnieuw
 * door 46 generatoren en 1.400 gerenderde bestanden hoeft.
 */
(function () {
  if (typeof gtag !== 'function') { return; }
  if (window.__ga4poort) { return; }
  window.__ga4poort = true;

  gtag('config', 'G-CW1KZ258ZV', { send_page_view: false });

  var verstuurd = false;
  function tel(waarom) {
    if (verstuurd) { return; }
    verstuurd = true;
    gtag('event', 'page_view', { engagement_signal: waarom });
  }

  var soorten = ['pointermove', 'pointerdown', 'keydown', 'scroll', 'touchstart'];
  soorten.forEach(function (s) {
    addEventListener(s, function () { tel(s); }, { once: true, passive: true });
  });

  // Vier seconden, maar alleen als de pagina echt zichtbaar was. Een
  // voorgeladen of achtergrondtabblad is geen bezoek.
  setTimeout(function () {
    if (document.visibilityState === 'visible') { tel('dwell4s'); }
  }, 4000);
})();
