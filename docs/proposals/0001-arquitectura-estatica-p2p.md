# ADR 0001: Arquitectura estática y P2P para PurpleBoard

* **Estado:** Propuesta
* **Fecha:** 2026-10-23
* **Autores:** Lucas Trecanao

## Contexto

PurpleBoard nació como prototipo monolítico `PurpleBoard.html` y necesitaba
producción con presupuesto cero. Un backend (WebSocket, persistencia de
salas, cuentas) sumaría costo operativo y de mantenimiento desproporcionado
para el uso actual: sesiones de colaboración ad-hoc compartiendo un ID.

## Decisión

Arquitectura 100% frontend estática, sin backend propio:

* Sitio de archivos servidos tal cual (GitHub Pages, `.nojekyll`), sin build
  en runtime: Tailwind precompilado y commiteado junto al fuente en
  `src/styles.css`.
* Colaboración P2P (data channels + voz) con PeerJS vendoreado; el signaling
  queda como infraestructura externa (comunidad de PeerJS) y es del
  reemplazable por configuración (self-host) sin cambiar el frontend.
* Persistencia local por navegador (localStorage con manejo de cuota) más
  export/import JSON manual.
* Seguridad en el cliente: escape de HTML (anti-XSS) y allowlist de URLs
  antes de inyectar contenido.

Límites: no hay sync multi-dispositivo, ni cuentas, ni historial de salas en
servidor; los IDs de sala no son un mecanismo de acceso restringido.

## Mecanismo de control

Pendiente de implementación en este repositorio:

1. CI check que verifique que `index.html`/`js/app.js`/`src/styles.css` no
   referencian CDNs o rutas absolutas (`/css`, `//`) que rompan el subpath de
   Pages.
2. CI check de bytes con límite para `AGENTS.md` y presencia de frontmatter
   en `.agent/skills/*/SKILL.md` (cubre ADR 0004 del marco de gobernanza).
3. `gitleaks` en CI (secretos, regla del ADR 0004 del marco).

## Evidencia de uso

Reescritura completa del prototipo, verificada localmente: assets locales sin
referencias a CDNs (grep sobre `index.html`, `js/`, `vendor/`), rutas
relativas que resuelven bajo subpath, y alternativas con Docker o backend
propios descartadas por decisión de presupuesto.

## Consecuencias

### Positivas
* Costo de producción cero y deploy reproducible sin pipeline.
* El contenido de la pizarra no pasa por ningún servidor propio
  (superficie de ataque mínima).
* Simpleza deliberada: cualquier cambio es un diff revisable en un solo
  archivo de lógica (`js/app.js`).

### Negativas
* Requiere recordar regenerar el CSS tras agregar clases de Tailwind
  (documentado en `.agent/skills/css-build/SKILL.md`).
* Dependencia del signaling comunitario para crear/unirse a salas.
