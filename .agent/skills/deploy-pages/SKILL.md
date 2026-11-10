---
name: deploy-pages
description: Publicar o verificar el despliegue de PurplePlan en GitHub Pages. NO invocar para cambios locales que aún no van a producción ni para gestionar salas o señalización.
---

# Deploy a GitHub Pages

## Cuándo usar
* Se pidió subir la versión actual a producción.
* Hay que verificar que un despliegue recién hecho sirvió los assets nuevos.

## Procedimiento paso a paso
1. El repo es 100% estático: no hay build de deploy. Confirmar que
   `css/styles.css`, `js/app.js`, `vendor/` y `webfonts/` están commiteados.
2. Push a `main` (solo con orden explícita del usuario).
3. En el repo GitHub: Settings → Pages → Source: Deploy from a branch,
   rama `main`, directorio `/ (root)`. `.nojekyll` ya está commiteado.
4. Esperar el deploy (~2 minutos) y validar.

## Verificación
* `https://<user>.github.io/<repo>/` responde 200 y carga sin 404 en consola.
* Rutas verificadas relativas: `css/styles.css`, `js/app.js`,
  `vendor/peerjs.min.js`, `webfonts/*.woff2`, `static/corazon.svg` (favicon)
  (resuelven bajo el subpath del repo).
* Crear sala y unirse desde otra pestaña/navegador para validar el P2P.
