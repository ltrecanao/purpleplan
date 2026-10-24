---
name: css-build
description: Regenerar css/styles.css (Tailwind compilado) tras agregar clases de Tailwind nuevas en index.html o js/app.js. NO invocar si solo se modifica lógica JS, contenido HTML o clases que ya existen.
---

# CSS Build (Tailwind)

## Cuándo usar
* Se agregaron clases de Tailwind nuevas en `index.html`, `js/app.js` o
  `src/styles.css`.
* Solo si se sospecha que el purge eliminó clases en uso.

## Procedimiento paso a paso
1. Con Node disponible:
   `npx tailwindcss@3.4.17 -c tailwind.config.js -i src/styles.css -o css/styles.css --minify`
2. Sin Node: descargar el binario standalone de
   https://github.com/tailwindlabs/tailwindcss/releases (v3.4.x, misma arquitectura)
   y ejecutar:
   `./tailwindcss-linux-x64 -c tailwind.config.js -i src/styles.css -o css/styles.css --minify`
3. El resultado va siempre commiteado; no existe build en runtime.

## Verificación
* `grep -o "CLASE-NUEVA" css/styles.css` para cada clase nueva
  (chequear al menos 3 clases representativas).
* Abrir la app y revisar el elemento estilizado buscado (no solo el output).
