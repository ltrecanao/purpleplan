# PurplePlan

Pizarra colaborativa P2P: post-its, imágenes, conexiones con flechas, dibujo
libre y llamadas de voz, todo con **archivos estáticos** sin framework ni
backend.

Proyecto 100% estático, listo para desplegar en **GitHub Pages**.
Licencia: **AGPL-3.0** (ver [LICENSE](LICENSE)).

## Estructura

```
purpleplan/
├── index.html            # UI (única página)
├── js/app.js             # Toda la lógica (canvas, sync, voz, autosave)
├── css/
│   ├── styles.css        # Tailwind compilado + estilos propios (PURGEADO — no editar a mano)
│   └── fontawesome.min.css
├── webfonts/             # Fuentes de Font Awesome
├── vendor/peerjs.min.js  # PeerJS 1.5.2 vendoreado
├── src/styles.css        # Fuente CSS de Tailwind (@tailwind + estilos propios)
└── tailwind.config.js    # Config de Tailwind
```

## Deploy a GitHub Pages

1. Crear un repo en GitHub y subir este contenido (la raíz del contenido queda
   en la raíz del repo o en la carpeta que uses como fuente de Pages).
2. En el repo: **Settings → Pages → Source**: `Deploy from a branch`, rama
   `main`, directorio `/ (root)`.
3. En unos 2 minutos el sitio queda publicado en
   `https://tuusuario.github.io/nombre-repo/`.

No hay build step: `css/styles.css` está pre-compilado y commiteado.

## Uso

- **Post-its**: crecen con el texto (altura dinámica) y se redimensionan con el
  handle de la esquina inferior derecha. Se eliminan con el botón rojo de tacho
  (aparece al seleccionar la nota, en la esquina superior izquierda).
- **Imágenes**: redimensionables con el mismo handle (mantiene proporción) y
  con su propio botón de eliminar al seleccionarlas.
- **Dibujo**: al activar "Dibujar" aparece el selector de forma: lápiz libre,
  línea recta, rectángulo y círculo. Todas las formas quedan como trazos
  eliminables con clic (menú flotante → Eliminar) y entran en el undo/redo.
- Crear una sala con el botón de puerta y compartir el ID, o unirse con el ID
  del anfitrión. La colaboración (tablero + voz) es P2P vía WebRTC.
  Al crear/unirse aparece un panel de invitación con botones para copiar el ID,
  copiar el **enlace de invitación** (`...?room=ID`, precarga el id del
  destinatario) o compartir nativo del SO si está disponible. El botón de
  puerta reabre ese panel cuando ya estás conectado.
- El tablero se guarda automáticamente en el navegador (localStorage) y se
  restaura al recargar. También se puede exportar/importar JSON manualmente.
- Cada vez que alguien se une tarde, el anfitrión le envía el estado completo
  de la pizarra.

## Regenerar el CSS (solo si agregás clases nuevas)

`css/styles.css` está purgeado: si agregás clases de Tailwind nuevas en
`index.html` o `js/app.js` hay que recompilar. Dos opciones:

```bash
# Opción A: con Node instalado
npx tailwindcss@3.4.17 -c tailwind.config.js -i src/styles.css -o css/styles.css --minify

# Opción B: con el CLI standalone (sin Node):
#   descargá el binario de https://github.com/tailwindlabs/tailwindcss/releases/tag/v3.4.17
./tailwindcss-linux-x64 -c tailwind.config.js -i src/styles.css -o css/styles.css --minify
```

## Licencia

Distribuido bajo la GNU Affero General Public License v3.0
([LICENSE](LICENSE)). AGPL exige que quien modifique el proyecto y lo
ofrezca como servicio de red ponga a disposición el código fuente
modificado — publicar el repo es eso mismo, así que el despliegue actual
ya cumple.

## Limitaciones conocidas (aceptadas por ahora)

- **Signaling**: usa el servidor de la comunidad de PeerJS (el default de
  `new Peer(...)`). Es gratuito y sin SLA; si falla, la conexión de salas no
  funciona hasta que se recupere. Cuando haya presupuesto, self-hospedar
  `peerjs-server` y configurar los peers así:

  ```js
  new Peer(id, { host: 'tu-host.com', port: 443, path: '/peerjs', secure: true });
  ```

- **Salas**: no hay autenticación; cualquiera con el ID puede entrar. Los IDs
  son aleatorios y no recomendables de adivinar, pero no es un mecanismo de
  acceso restringido.
- **Persistencia**: localStorage por navegador con manejo de cuota excedida;
  si el tablero tiene muchas imágenes grandes, el autosave avisa y conviene
  usar el export manual de JSON.
- El historial de undo/redo es local; las acciones de otros peers no se
  rehacen desde tu historial.
