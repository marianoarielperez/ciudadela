# 01 — Visión y alcance

## Qué es SIGeV

SIGeV es la plataforma web de la **Asociación Vecinal del Barrio Ciudadela**
(asociación civil sin fines de lucro, Comodoro Rivadavia, Chubut, bajo contralor
de la IGJ del Chubut). Reemplaza la gestión en papel del registro de asociados
y digitaliza tres procesos:

1. **Asociarse** desde la web, con adhesión al débito automático de Mercado Pago.
2. **Re-empadronarse** (proceso de depuración de socios adherentes, Art. 9° bis
   y Art. 40 del estatuto reformado el 15/08/2026, pendiente de oficialización por IGJ).
3. **Pagar y registrar cuotas sociales**: débitos automáticos conciliados solos,
   links de pago, y registro de efectivo por tesorería, con recibos PDF numerados.

Además: sitio público institucional (hero, cartelera de noticias, ubicación, estatuto),
panel de administración para la Comisión Directiva (CD) y panel de autogestión para socios.

## Contexto y números

- Padrón actual (Libro N° 1): 283 fichas históricas, **160 socios vigentes**
  (55 activos + 105 adherentes). Tras el re-empadronamiento se esperan **~70 socios**.
- Cuotas actuales: Activo $6.000/mes (obligatoria), Adherente $3.000/mes (voluntaria),
  Colaborador $3.000/mes (obligatoria). Los montos NO se hardcodean: viven en los
  Planes de suscripción de Mercado Pago y la CD los actualiza desde el panel de MP.
- Cuenta de MP institucional, a nombre de la asociación (CUIT propio, IVA exento).
- Ya existen suscripciones activas creadas desde el panel de MP (ej. "Cuota Social ACTIVO");
  deben poder vincularse a socios una única vez y conciliarse automáticamente.

## Usuarios y roles

| Rol | Quién | Qué hace |
|---|---|---|
| `superadmin` | Mariano | Todo + configuración, usuarios, interruptores de módulos |
| `admin` | Presidente, secretario, tesorero y CD | Solicitudes, altas/bajas por acta, noticias, tesorería, re-empadronamiento, documentos |
| `socio` | Cada asociado con email | Ver sus datos y estado de cuenta, pagar pendientes, actualizar datos, solicitar baja |

Los roles son acumulables (un directivo es `admin` + `socio`). Autenticación por
email + contraseña para todos; recupero por email. Los socios cargados desde ficha
reciben una invitación "creá tu contraseña" cuando se les registra un email.

## Qué NO es / fuera de alcance

- **No** da de alta socios sin resolución de CD: toda alta, baja o cambio de categoría
  queda vinculada a un **acta** (ver `02-marco-estatutario.md`).
- **No** gestiona categorías cadete, honorario ni vitalicio desde el alta web
  (van por sede / asamblea; el sistema sí las modela y puede registrarlas desde el panel).
- **No** implementa contabilidad general ni facturación electrónica ARCA
  (pendiente externo: el contador de la vecinal confirmará si el recibo interno alcanza).
- **No** maneja votación electrónica ni el proceso electoral (solo exporta el padrón
  electoral para la Junta Electoral).
- **No** almacena datos de tarjetas: todo pago pasa por Mercado Pago.

## Principios de diseño

1. **El estatuto es el spec.** Cada regla de negocio cita su artículo. Ante duda,
   gana la interpretación más conservadora del estatuto.
2. **Trazabilidad ante la IGJ.** El sistema espeja los libros físicos (registro de
   asociados y actas). Todo movimiento tiene acta, fecha y responsable.
3. **Notificación fehaciente.** El email es el "domicilio electrónico" del Art. 5° quater:
   se verifica, se registran envíos y rebotes, y existe el mecanismo subsidiario de cartelera.
4. **Escala chica, robustez alta.** ~70-300 registros, decenas de usuarios. Nada de
   sobre-ingeniería: monolito Next.js, una base MariaDB, un VPS.
5. **Privacidad primero.** DNIs y documentos bajo llave (Ley 25.326), consulta pública
   nunca revela el padrón.
