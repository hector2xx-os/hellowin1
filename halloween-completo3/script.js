// Cuenta regresiva hasta el viernes 30 de octubre de 2026, 8:00 p. m.
(function () {
  var fin = new Date(2026, 9, 30, 20, 0, 0).getTime();

  function dos(n) {
    return String(n).padStart(2, '0');
  }

  function actualizar() {
    var restante = fin - Date.now();
    if (restante <= 0) {
      document.getElementById('cuenta').innerHTML =
        '<p>La fiesta ya comenzó o terminó. ¡Gracias por venir!</p>';
      return;
    }
    var s = Math.floor(restante / 1000);
    document.getElementById('d').textContent = Math.floor(s / 86400);
    document.getElementById('h').textContent = dos(Math.floor((s % 86400) / 3600));
    document.getElementById('m').textContent = dos(Math.floor((s % 3600) / 60));
    document.getElementById('s').textContent = dos(s % 60);
  }

  actualizar();
  setInterval(actualizar, 1000);
})();

// Murciélagos que caen por toda la pantalla
(function () {
  var cont = document.getElementById('murcielagos');
  if (!cont || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var cantidad = window.innerWidth < 600 ? 8 : 14;
  for (var i = 0; i < cantidad; i++) {
    var m = document.createElement('div');
    m.className = 'murci cae';
    var tam = 50 + Math.random() * 70;
    m.style.width = tam + 'px';
    m.style.left = Math.random() * 96 + '%';
    m.style.animationDuration = (9 + Math.random() * 9) + 's';
    m.style.animationDelay = (-Math.random() * 18) + 's';
    m.style.opacity = 0.55 + Math.random() * 0.45;
    var v = document.createElement('div');
    v.className = 'vaiven';
    v.style.animationDuration = (1.8 + Math.random() * 2) + 's';
    var img = document.createElement('img');
    img.src = 'murcielagos.png';
    img.alt = '';
    v.appendChild(img);
    m.appendChild(v);
    cont.appendChild(m);
  }
})();
