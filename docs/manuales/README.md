# Manuales y documentación técnica de SIGeV

Fuente en Markdown, salida en Word. **Se edita el Markdown y se regenera el Word;
nunca al revés.**

| Carpeta | Qué hay |
|---|---|
| `tecnica/` | Serie técnica T1-T7 (para el desarrollador que hereda el proyecto) |
| `usuario/` | Manuales M1 (operador), M2 (socio), M3 (vecino) |
| `img/` | Logo y capturas (`m1/`, `m2/`, `m3/`) |
| `word/` | Los `.docx` generados (se commitean) |

## Regenerar los Word

    npm run docs:build                          # todos
    npm run docs:build docs/manuales/usuario/M2-manual-del-socio.md

En Windows con Word instalado el build actualiza el índice solo. Sin Word queda
el campo sin calcular: abrir el `.docx`, clic en el índice y F9.

## Markdown admitido

Títulos `#` a `####`, párrafos, **negrita**, *cursiva*, `código`, enlaces, listas
`-` y `1.` de dos niveles, tablas GFM de hasta **8 columnas**, bloques de código con
lenguaje, citas `>`, imágenes `![leyenda](../img/m1/01-x.png)` solas en su párrafo
(PNG), `---`, y el front matter
`title / subtitle / series / docx / version / date`. Otra sintaxis corta el build
con archivo y línea.

`![leyenda](../img/m1/01-x.png "w=8")` fija el ancho de la imagen en centímetros
(de 4 a 16; sin título ocupa el ancho útil, 16 cm). Una captura más alta que la
página se reduce sola para entrar entera en una, con su leyenda.

No se admiten: el tachado `~~texto~~`, las casillas `- [ ]`, el HTML (ni en bloque
ni inline), las definiciones de enlace `[x]: url`, un tercer nivel de lista ni
títulos `#####`. Una lista ordenada **siempre arranca en 1**: el número que se
escriba (`3.`) se ignora.

## Capturas

Las capturas salen del dev server local con `scripts/docs/capture.ts`
(`playwright-core` sobre el Chrome instalado; no descarga navegadores). Hace falta:

1. el dev server corriendo (`npm run dev`, puerto 3000, o `DOCS_CAPTURE_BASE_URL`);
2. los usuarios de prueba con la contraseña `SEED_TEST_PASSWORD` del `.env`
   (`npx tsx scripts/docs/reset-test-passwords.ts` la reaplica; solo contra localhost);
3. los estados sembrados que describe `docs/manuales/img/SIEMBRA.md`
   (noticia, alta en cola, reporte, exención, re-empadronamiento convocado, bandeja).

    npm run docs:capture            # todas
    npm run docs:capture m1         # un manual
    npm run docs:capture m1 -- --only 20   # una sola (por prefijo)

La lista de capturas vive en `scripts/docs/capture-plan.ts`. Ninguna captura puede
mostrar datos de un socio real: se usan los `*.prueba` y fichas inventadas.

## Mantenimiento

Al cerrar un módulo que cambie una pantalla o una regla: actualizar el Markdown del
documento que la describe, re-capturar lo que cambió, `npm run docs:build`, y
commitear el `.md`, los PNG y el `.docx` juntos. Subir `version` y `date` en el
front matter.
