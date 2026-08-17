# SIGeV — Sistema Integral de Gestión Vecinal

**Asociación Vecinal del Barrio Ciudadela** — Comodoro Rivadavia, Chubut.

Plataforma web: sitio institucional, alta de socios con débito automático de
Mercado Pago, re-empadronamiento estatutario (Art. 9° bis), tesorería con recibos
numerados, y paneles de administración y autogestión.

## Contenido de esta carpeta

```
sigev/
├── CLAUDE.md                  ← Convenciones y stack para Claude Code (leer primero)
├── docs/
│   ├── 01-vision-y-alcance.md
│   ├── 02-marco-estatutario.md   ← Reglas de negocio (el spec del estatuto)
│   ├── 03-arquitectura-e-infraestructura.md
│   ├── 04-modelo-de-datos.md
│   ├── 05-flujos-funcionales.md
│   ├── 06-integracion-mercadopago.md
│   ├── 07-plan-de-etapas.md      ← Módulos 0-6 con criterios de aceptación
│   └── 08-seguridad-y-privacidad.md
├── datos/
│   ├── padron_socios.xlsx        ← Libro N° 1 (esqueleto, 285 filas)
│   └── calles_inicial.csv        ← 40 calles catastrales del barrio
└── assets/
    ├── logo.png                  ← Logo institucional (celeste #2E9BDF)
    └── hero.jpg                  ← Foto aérea del barrio (hero de la home)
```

## Cómo arrancar

1. Abrir esta carpeta con **Claude Code**.
2. Pedirle que lea `CLAUDE.md` y los docs, y que ejecute el **Módulo 0** del plan
   de etapas.
3. Avanzar módulo por módulo validando los criterios de aceptación.

## Estado institucional

Estatuto reformado aprobado por Asamblea Extraordinaria del 15/08/2026, en trámite
ante la IGJ del Chubut. El sistema se desarrolla y prueba en staging
(`sigev.redaccion.ar`, Mercado Pago en modo prueba); el lanzamiento público en
`vecinalciudadela.com.ar` se hace al oficializarse la reforma.
