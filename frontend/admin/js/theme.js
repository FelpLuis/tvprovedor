// aplicado antes da renderização para evitar "piscar" o tema
(function () {
  try {
    var t = localStorage.getItem('uds.theme');
    if (t === 'light' || t === 'dark') { document.documentElement.setAttribute('data-theme', t); }
  } catch (e) { /* ignora */ }
})();
