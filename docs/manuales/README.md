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
`-` y `1.` de dos niveles, tablas GFM, bloques de código con lenguaje, citas `>`,
imágenes `![leyenda](../img/m1/01-x.png)` solas en su párrafo (PNG), `---`, y el
front matter `title / subtitle / series / docx / version / date`. Otra sintaxis
corta el build con archivo y línea.

## Capturas

(Se completa en la Tarea 13.)
