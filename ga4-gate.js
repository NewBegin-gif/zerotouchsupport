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
 * De wachtrij. In GA4 maakt ELK event een gebruiker, niet alleen de page_view.
 * Een poort die alleen de page_view tegenhoudt is dus geen poort: conversion.js
 * vuurde na 800 ms een exposure-event en daarmee telde de bot alsnog. Daarom
 * window.__ga4wacht: elk script dat pas na de poort wil meten zet zijn functie
 * daarin, en het maakt niet uit wie eerst laadt. Na het opengaan wordt de rij
 * geleegd en vervangen door een object dat meteen uitvoert.
 *
 * Dit bestand staat los van de pagina's zodat een wijziging hier niet opnieuw
 * door 40 generatoren en 1.444 gerenderde bestanden hoeft.
 */
(function () {
  if (typeof gtag !== 'function') { return; }
  if (window.__ga4poort) { return; }
  window.__ga4poort = true;

  window.__ga4wacht = window.__ga4wacht || [];

  gtag('config', 'G-CW1KZ258ZV', { send_page_view: false });

  var soorten = ['pointermove', 'pointerdown', 'keydown', 'scroll', 'touchstart'];
  var open = false;

  function poortOpen(waarom) {
    if (open) { return; }
    open = true;
    soorten.forEach(function (s) { removeEventListener(s, opSignaal); });
    gtag('event', 'page_view', { engagement_signal: waarom });
    var rij = window.__ga4wacht || [];
    window.__ga4wacht = {
      push: function (fn) { try { fn(); } catch (_) {} }
    };
    for (var i = 0; i < rij.length; i++) {
      try { rij[i](); } catch (_) {}
    }
  }

  // isTrusted is alleen waar bij een echte handeling van de gebruiker; een
  // script dat een event naspeelt komt er niet mee door. Kost een echte
  // bezoeker niets en sluit de goedkoopste manier om deze poort te omzeilen.
  //
  // Bewust GEEN once:true: dan zou een nagespeeld event de luisteraar
  // opsouperen en zou een echte handeling erna de poort mislopen. De
  // luisteraars gaan er pas af als de poort daadwerkelijk opengaat.
  function opSignaal(e) {
    if (e && e.isTrusted === false) { return; }
    poortOpen(e && e.type ? e.type : 'interactie');
  }
  soorten.forEach(function (s) {
    addEventListener(s, opSignaal, { passive: true });
  });

  // Vier seconden, maar alleen als de pagina echt zichtbaar was. Een
  // voorgeladen of achtergrondtabblad is geen bezoek.
  setTimeout(function () {
    if (document.visibilityState === 'visible') { poortOpen('dwell4s'); }
  }, 4000);
})();
