/* Hace de pasarela Supabase: /rest/v1/* -> PostgREST, con interruptor para
 * simular que se cae la red y con retardo para simular que va lenta.
 *
 *   node sync_proxy.js <puerto propio> <puerto de PostgREST>
 *
 * Solo lo usa tools/test_sync.py. No pinta nada en producción. */
const http = require('http');

const PUERTO = Number(process.argv[2] || 53001);
const DESTINO = Number(process.argv[3] || 53000);
const ESTADO = { caido: false, retardo: 0, peticiones: 0 };

const srv = http.createServer((req, res) => {
  if (req.url === '/__control') {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      Object.assign(ESTADO, JSON.parse(b || '{}'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ESTADO));
    });
    return;
  }
  if (ESTADO.caido) { req.socket.destroy(); return; }
  ESTADO.peticiones++;

  const ruta = req.url.replace(/^\/rest\/v1/, '');
  const hacer = () => {
    const up = http.request({ host: '127.0.0.1', port: DESTINO, path: ruta,
                              method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    up.on('error', () => { try { res.writeHead(502); res.end('{}'); } catch (e) {} });
    req.pipe(up);
  };
  if (ESTADO.retardo) setTimeout(hacer, ESTADO.retardo); else hacer();
});
srv.listen(PUERTO, '127.0.0.1', () => console.log('pasarela en ' + PUERTO));
