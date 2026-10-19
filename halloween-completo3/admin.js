// Panel de administradores conectado a Supabase.
// Los datos de conexión se escriben en config.js. La contraseña ya no está en el código:
// el inicio de sesión lo maneja Supabase, y los QR se firman y validan en el servidor.
var cfg = window.CONFIG_SUPABASE || {};
var db = null;
try {
  db = supabase.createClient(cfg.url, cfg.anonKey, {
    // La sesión vive solo en memoria: al salir o recargar se pide la contraseña otra vez.
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false }
  });
} catch (e) {}

var $ = function (id) { return document.getElementById(id); };
var scanner = null;
var autenticado = false;
var invitados = [];

function activo() { return autenticado; }
function hora(iso) { return iso ? new Date(iso).toLocaleString('es-MX') : ''; }

/* ---------- Datos ---------- */
async function cargar() {
  var r = await db.from('invitados').select('*').order('creado', { ascending: false });
  if (r.error) { alert('No se pudo cargar la lista: ' + r.error.message); return; }
  invitados = r.data || [];
  pintar();
}

/* ---------- Validación (se hace en el servidor) ---------- */
async function validar(texto) {
  var r = await db.rpc('validar_boleto', { p_codigo: (texto || '').trim() });
  if (r.error) return { tipo: 'error', msg: 'No se pudo verificar el boleto: ' + r.error.message };
  return r.data;
}

function pintarResultado(cont, r) {
  var titulos = {
    valido: '✔ Boleto válido',
    entrada: '✔ Entrada registrada',
    usado: '⚠ Boleto ya usado',
    falso: '✖ Boleto NO válido',
    error: '⚠ No se pudo verificar'
  };
  cont.innerHTML = '';
  var d = document.createElement('div');
  d.className = 'res res-' + r.tipo;
  var h = document.createElement('h3'); h.textContent = titulos[r.tipo] || 'Resultado';
  var p = document.createElement('p'); p.textContent = r.msg;
  d.appendChild(h); d.appendChild(p);
  if (r.tipo === 'valido') {
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = 'Registrar entrada';
    b.onclick = async function () {
      b.disabled = true;
      var e = await db.rpc('registrar_entrada', { p_id: r.id });
      if (e.error) {
        pintarResultado(cont, { tipo: 'error', msg: 'No se pudo registrar la entrada: ' + e.error.message });
        return;
      }
      pintarResultado(cont, e.data);
      cargar();
    };
    d.appendChild(b);
  }
  cont.appendChild(d);
}

/* ---------- Vista ---------- */
function mostrar() {
  var ok = activo();
  $('login').hidden = ok;
  $('panel').hidden = !ok;
  if (ok) cargar();
}

function pintar() {
  var q = $('buscar').value.trim().toLowerCase();
  var total = 0, entradas = 0;
  invitados.forEach(function (g) { total += g.precio; if (g.usado) entradas++; });
  $('t-invitados').textContent = invitados.length;
  $('t-entradas').textContent = entradas;
  $('t-dinero').textContent = '$' + total;

  var visibles = invitados.filter(function (g) {
    return !q || g.nombre.toLowerCase().indexOf(q) > -1 || (g.telefono || '').indexOf(q) > -1;
  });
  $('vacio').hidden = visibles.length > 0;
  var cuerpo = $('lista');
  cuerpo.innerHTML = '';

  visibles.forEach(function (g) {
    var tr = document.createElement('tr');
    [g.nombre, g.telefono || '—', '$' + g.precio, g.usado ? 'Entró' : 'Pendiente'].forEach(function (txt) {
      var td = document.createElement('td'); td.textContent = txt; tr.appendChild(td);
    });
    var td = document.createElement('td');
    var ver = document.createElement('button');
    ver.type = 'button'; ver.className = 'sec'; ver.textContent = 'Ver QR';
    ver.onclick = function () { mostrarQR(g); };
    var del = document.createElement('button');
    del.type = 'button'; del.textContent = 'Quitar';
    del.setAttribute('aria-label', 'Quitar a ' + g.nombre);
    del.onclick = async function () {
      if (!confirm('¿Quitar a ' + g.nombre + ' de la lista? Su QR dejará de ser válido.')) return;
      var r = await db.from('invitados').delete().eq('id', g.id);
      if (r.error) { alert('No se pudo quitar: ' + r.error.message); return; }
      cargar();
    };
    td.appendChild(ver); td.appendChild(del);
    tr.appendChild(td);
    cuerpo.appendChild(tr);
  });
}

function mostrarQR(g) {
  $('ticket').hidden = false;
  $('ticket-nombre').textContent = g.nombre;
  $('ticket-codigo').textContent = g.codigo;
  $('qr').innerHTML = '';
  new QRCode($('qr'), { text: g.codigo, width: 240, height: 240, correctLevel: QRCode.CorrectLevel.H });
  $('ticket').scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('bajar-qr').onclick = async function () {
    var lienzo = await dibujarInvitacion(g, $('qr').querySelector('canvas'));
    var a = document.createElement('a');
    a.href = lienzo.toDataURL('image/png');
    a.download = 'invitacion-' + g.nombre.replace(/\s+/g, '-') + '.png';
    a.click();
  };
}

/* ---------- Eventos ---------- */
$('form-login').addEventListener('submit', async function (e) {
  e.preventDefault();
  if (!db) { $('error-login').textContent = 'Falta configurar config.js con los datos de Supabase.'; return; }
  $('error-login').textContent = 'Entrando…';
  var r = await db.auth.signInWithPassword({ email: $('correo').value.trim(), password: $('clave').value });
  if (r.error) {
    var m = r.error.message || '';
    $('error-login').textContent = /invalid login credentials/i.test(m)
      ? 'Correo o contraseña incorrectos (o el usuario no existe en Supabase).'
      : 'Error de Supabase: ' + m;
    return;
  }
  autenticado = true;
  $('clave').value = ''; $('error-login').textContent = '';
  mostrar();
});

$('form-invitado').addEventListener('submit', async function (e) {
  e.preventDefault();
  var boton = e.target.querySelector('button[type="submit"]');
  boton.disabled = true;
  var r = await db.rpc('crear_invitado', {
    p_nombre: $('nombre').value.trim(),
    p_telefono: $('telefono').value.trim(),
    p_precio: Number($('fase').value)
  });
  boton.disabled = false;
  if (r.error) { alert('No se pudo crear el boleto: ' + r.error.message); return; }
  $('nombre').value = ''; $('telefono').value = '';
  invitados.unshift(r.data);
  pintar(); mostrarQR(r.data);
});

$('cerrar-ticket').addEventListener('click', function () { $('ticket').hidden = true; });
$('buscar').addEventListener('input', pintar);
$('actualizar').addEventListener('click', cargar);

$('salir').addEventListener('click', async function () {
  detener();
  autenticado = false;
  try { await db.auth.signOut(); } catch (e) {}
  mostrar();
});

document.querySelectorAll('.tab[data-tab]').forEach(function (t) {
  t.addEventListener('click', function () {
    document.querySelectorAll('.tab[data-tab]').forEach(function (x) {
      x.classList.toggle('activa', x === t);
    });
    ['invitados', 'escaner', 'verificar'].forEach(function (n) {
      $('tab-' + n).hidden = n !== t.dataset.tab;
    });
    if (t.dataset.tab !== 'escaner') detener();
    if (t.dataset.tab === 'invitados') cargar();
  });
});

$('form-verificar').addEventListener('submit', async function (e) {
  e.preventDefault();
  pintarResultado($('res-manual'), await validar($('codigo-manual').value));
});

/* ---------- Escáner ---------- */
function detener() {
  if (scanner) {
    var s = scanner; scanner = null;
    s.stop().then(function () { s.clear(); }).catch(function () {});
  }
  $('iniciar-scan').hidden = false;
  $('parar-scan').hidden = true;
}

$('iniciar-scan').addEventListener('click', function () {
  $('res-scan').innerHTML = '';
  scanner = new Html5Qrcode('lector');
  scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: 240 }, async function (texto) {
    detener();
    pintarResultado($('res-scan'), await validar(texto));
  }).then(function () {
    $('iniciar-scan').hidden = true;
    $('parar-scan').hidden = false;
  }).catch(function () {
    scanner = null;
    $('res-scan').textContent = 'No se pudo abrir la cámara. Da permiso al navegador y abre la página desde https.';
  });
});
$('parar-scan').addEventListener('click', detener);

$('exportar').addEventListener('click', function () {
  var filas = [['Nombre', 'Teléfono', 'Precio', 'Fecha de compra', 'Código', 'Entró']].concat(
    invitados.map(function (g) {
      return [g.nombre, g.telefono || '', g.precio, hora(g.creado), g.codigo, g.usado ? hora(g.usado_en) : ''];
    })
  );
  var csv = filas.map(function (f) {
    return f.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
  }).join('\n');
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'invitados-halloween.csv';
  a.click();
  URL.revokeObjectURL(a.href);
});

// Si el navegador restaura la página al volver atrás, se cierra la sesión.
window.addEventListener('pageshow', function (e) {
  if (e.persisted) { autenticado = false; mostrar(); }
});
window.addEventListener('pagehide', function () { autenticado = false; detener(); });

mostrar();

/* ---------- Invitación descargable ---------- */
function nombreFase(precio) {
  return precio === 150 ? 'Fase 1' : precio === 180 ? 'Fase 2' : 'Día del evento';
}

function cargarImagen(src) {
  return new Promise(function (ok) {
    var img = new Image();
    img.onload = function () { ok(img); };
    img.onerror = function () { ok(null); };
    img.src = src;
  });
}

async function dibujarInvitacion(g, qrCanvas) {
  try { await document.fonts.load('800 40px Nunito'); } catch (e) {}
  var W = 1080, H = 1880;
  var c = document.createElement('canvas');
  c.width = W; c.height = H;
  var x = c.getContext('2d');
  var TEXTO = "'Nunito',Arial,sans-serif";
  var ROSA = '#e040fb';

  function caja(px, py, w, h, r) {
    x.beginPath();
    if (x.roundRect) x.roundRect(px, py, w, h, r); else x.rect(px, py, w, h);
  }
  function texto(t, px, py, fuente, color, glow) {
    x.font = fuente; x.fillStyle = color; x.textAlign = 'center';
    x.shadowColor = glow || 'transparent'; x.shadowBlur = glow ? 24 : 0;
    x.fillText(t, px, py);
    x.shadowBlur = 0;
  }

  // Fondo y arte del cartel
  x.fillStyle = '#0d0218'; x.fillRect(0, 0, W, H);
  var arte = typeof FONDO_INVITACION === 'string' ? await cargarImagen(FONDO_INVITACION) : null;
  if (arte) x.drawImage(arte, 0, 0, 1080, 1080);
  var fade = x.createLinearGradient(0, 960, 0, 1100);
  fade.addColorStop(0, 'rgba(13,2,24,0)'); fade.addColorStop(1, '#0d0218');
  x.fillStyle = fade; x.fillRect(0, 960, W, 140);

  // Invitado
  texto('Invitación para', 540, 1145, '800 32px ' + TEXTO, '#d9a0ff');
  var tam = 84;
  do { x.font = '800 ' + tam + 'px ' + TEXTO; tam -= 4; } while (x.measureText(g.nombre).width > 920 && tam > 28);
  texto(g.nombre, 540, 1230, x.font, '#ffffff', 'rgba(224,64,251,.7)');

  // Hora y lugar
  texto('Inicio 8:00 p. m.   |   Lugar: por confirmar', 540, 1295, '800 34px ' + TEXTO, '#f6eefe');

  // Boleto comprado
  x.lineWidth = 4; x.strokeStyle = ROSA;
  caja(170, 1330, 740, 120, 28); x.fillStyle = 'rgba(224,64,251,.12)'; x.fill(); x.stroke();
  texto('Tu boleto', 540, 1372, '800 28px ' + TEXTO, '#d9a0ff');
  texto(nombreFase(g.precio) + '  ·  $' + g.precio, 540, 1428, '800 54px ' + TEXTO, '#ffffff');

  // QR
  x.fillStyle = '#ffffff'; caja(350, 1480, 380, 380, 24); x.fill();
  x.imageSmoothingEnabled = false;
  x.drawImage(qrCanvas, 370, 1500, 340, 340);
  return c;
}
