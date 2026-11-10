# AGENTS.md

## Propósito del repositorio
PurplePlan: pizarra colaborativa P2P (post-its, imágenes, formas, dibujo y
voz) como sitio web 100% estático. Sin framework, sin backend, sin build en
runtime: HTML + vanilla JS + Tailwind precompilado, listo para GitHub Pages.
Detalles de decisión en `docs/proposals/`.

## Reglas no negociables
1. **Commits y trazabilidad:** Un cambio por commit, Conventional Commits,
   prohibido el push automático sin orden explícita y nunca commitear en
   estado rojo.
    * **Formato:** `<tipo>: <descripción>`.
    * **Tipos:** `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `ci`.
    * **Límite:** Máximo **50 caracteres** en el asunto (atómico, sin cuerpo).
2. **Seguridad:** Prohibido incluir credenciales, secretos o tokens en ningún
   archivo de código o documentación.
3. **Testing:** Antes de commitar código nuevo o modificado, verificar el
   tablero manualmente (regresiones de pan/zoom, sync, undo). No deshabilitar
   verificaciones existentes para pasar el build.
4. **Alcance estático:** No introducir frameworks, bundlers ni secretos de
   infraestructura. Las nuevas capacidades deben mantener el modelo "archivos
   listos para GitHub Pages + WebRTC P2P".

## Estructura de contexto y skills disponibles
* El contexto permanente se mantiene acotado en este archivo (`/AGENTS.md`).
* Los procedimientos específicos se cargan a demanda desde
  `.agent/skills/<nombre-skill>/SKILL.md` cuando la tarea lo requiere:
  * `css-build`: regenerar el CSS compilado de Tailwind.
  * `deploy-pages`: publicar/verificar el despliegue en GitHub Pages.
