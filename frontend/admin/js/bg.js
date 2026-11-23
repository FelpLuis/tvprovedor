// Parallax suave do fundo (o "U" da marca acompanha levemente o mouse).
(function () {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { return; }
  var root = document.documentElement;
  var tx = 0, ty = 0, x = 0, y = 0, raf = null;
  function loop() {
    x += (tx - x) * 0.06;
    y += (ty - y) * 0.06;
    root.style.setProperty('--mx', x.toFixed(3));
    root.style.setProperty('--my', y.toFixed(3));
    raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.001 ? requestAnimationFrame(loop) : null;
  }
  window.addEventListener('pointermove', function (e) {
    tx = e.clientX / window.innerWidth - 0.5;
    ty = e.clientY / window.innerHeight - 0.5;
    if (!raf) { raf = requestAnimationFrame(loop); }
  }, { passive: true });
})();
