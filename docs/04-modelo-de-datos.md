# 04 — Modelo de datos

Nombres finales de tablas/campos en inglés en el schema de Prisma; acá se describen
con nombres en español por claridad conceptual. El schema debe implementar TODAS
las entidades y restricciones de este documento.

## Diagrama conceptual

```
Libro 1──N Membresia N──1 Socio 1──N Movimiento N──1 Acta
                              │
        ┌──────────┬──────────┼───────────┬─────────────┬──────────────┐
        N          N          N           N             N              N
   Documento    Cuota      Pago──1 Recibo │       Notificacion   SuscripcionMP
                                          │
                                     Presentacion (re-empadronamiento)
Solicitud (alta web) ──N Documento
ProcesoReempadronamiento 1──N Presentacion
Usuario N──N Rol · Noticia · Calle · ValorCuota · Feriado · Auditoria · WebhookEvent
```

## Entidades

### Socio (persona)
Identidad única de la persona a través de todos los libros.
- `id`, `apellido_nombre` (como viene del padrón; opcionalmente split posterior),
  `dni` (UNIQUE, nullable solo para históricos sin dato), `fecha_nacimiento`,
  `estado_civil`, `nacionalidad`, `ocupacion`, `telefono`
- Domicilio: `calle_id` (FK Calle, nullable), `calle_texto` (para colaboradores u
  otras direcciones fuera del barrio), `altura`, `barrio`
- Domicilio electrónico: `email`, `email_estado`
  (`sin_email` | `declarado` | `verificado` | `rebotado`), `email_verificado_at`
- Estado actual (desnormalizado para consultas; la verdad es el historial de
  Movimientos): `categoria` (activo|adherente|colaborador|cadete|honorario|vitalicio),
  `estado` (`vigente` | `suspendido` | `baja`), `motivo_baja` (catálogo REG-18),
  `fecha_ingreso` (fecha del acta de alta original — NUNCA se pisa en cambios de
  libro ni de categoría), `fecha_egreso`
- Flags: `bloqueado_reingreso` (expulsados, REG-04), `rechazo_hasta` (REG-05)
- `usuario_id` (FK Usuario, nullable)

### Libro
- `numero` (1, 2, 3…), `estado` (`abierto`|`cerrado`), `acta_apertura_id`,
  `acta_cierre_id`, `fecha_apertura`, `fecha_cierre`
- Solo puede existir UN libro abierto a la vez.

### Membresia (número de socio por libro)
- `socio_id`, `libro_id`, `numero_socio` — UNIQUE(`libro_id`,`numero_socio`)
  y UNIQUE(`socio_id`,`libro_id`)
- El "número de socio actual" de una persona = su membresía en el libro abierto.

### Acta
- `id`, `tipo` (`comision_directiva` | `asamblea`), `numero`, `fecha`,
  `descripcion`, `creado_por`
- La **fecha del acta define la fecha de ingreso** de las altas que contiene (REG-11).

### Movimiento (historial de estados)
- `socio_id`, `tipo` (`alta` | `baja` | `cambio_categoria` | `reingreso` |
  `suspension` | `fin_suspension` | `migracion_libro`), `fecha` (= fecha del acta),
  `acta_id` (obligatoria salvo `migracion_libro` que hereda el acta de cierre),
  `categoria_anterior`, `categoria_nueva`, `motivo` (catálogo), `detalle`, `creado_por`

### Solicitud (alta web)
- `id`, datos personales completos del formulario (espejo de Socio), `categoria_solicitada`,
  `estado`:
  `iniciada` → `pendiente_pago` (esperando autorización del débito en MP)
  → `aprobada_pendiente_acta` (débito autorizado y 1er pago OK ⇒ aceptación automática
     REG-12; falta solo el asiento en acta) → `alta_completada`
  · rama sin débito (adherente que no adhiere): `pendiente_cd` → `alta_completada` | `rechazada`
  · acciones de CD sobre `aprobada_pendiente_acta`: confirmar (default), `recategorizada`
    (cambia categoría + ajusta suscripción MP), `rechazada` (retiene cuota de ingreso, REG-12.b)
- `preapproval_id` (MP), `mp_payment_id_ingreso`, `acta_id`, `ip`, `user_agent`,
  `acepto_terminos_at`, `turnstile_ok`
- Al completarse el alta se crea Socio + Membresia (número siguiente del libro abierto)
  + Movimiento de alta.

### Documento
- `id`, `owner_type` (`solicitud` | `socio` | `presentacion`), `owner_id`,
  `tipo` (`dni_frente` | `dni_dorso` | `anexo`), `path`, `mime`, `size`,
  `subido_at`, `validado_por` (nullable), `validado_at`
- Conservación **permanente** (decisión institucional). Acceso solo admin, auditado.

### Cuota (período devengado)
- `socio_id`, `periodo` (YYYY-MM), `monto` (valor vigente al devengar),
  `estado` (`pendiente` | `pagada` | `exenta` | `anulada`), `pago_id` (nullable)
- Se generan el día 1 de cada mes para activos y colaboradores vigentes.
  Adherentes NO devengan (su aporte es voluntario y se registra como Pago suelto).
  Honorarios y vitalicios: exentos (no devengan).
- La cuota de ingreso se modela como Pago tipo `ingreso`, no como Cuota.

### Pago
- `id`, `socio_id` (nullable si aún es Solicitud), `solicitud_id` (nullable),
  `tipo` (`debito` | `link` | `efectivo` | `voluntaria` | `ingreso` | `extraordinaria`),
  `monto`, `fecha`, `periodo_aplicado` (nullable), `mp_payment_id` (UNIQUE, nullable),
  `preapproval_id` (nullable), `registrado_por` (nullable; admin para efectivo),
  `recibo_id`
- Un pago por débito/link llega por webhook y se aplica automáticamente a la cuota
  pendiente más antigua (o al período del mes si no hay atrasos).

### Recibo
- `numero` correlativo único global formato `AAAA-NNNNN` (una sola serie para todos
  los medios de pago), `pago_id`, `pdf_path`, `emitido_at`, `enviado_email_at`
- Numeración asignada en transacción (tabla de secuencia o MAX+1 con lock) — sin huecos.

### SuscripcionMP
- `socio_id`, `preapproval_id` (UNIQUE), `plan` (`activo` | `adherente` | `colaborador`),
  `status` (según MP: authorized | paused | cancelled…), `payer_email`,
  `vinculada_manualmente` (bool, para las preexistentes), `ultimo_sync_at`

### ValorCuota (historial, REG-34)
- `categoria`, `monto`, `vigente_desde`, `acta_id`
- Fuente de verdad operativa = Planes de MP; esta tabla es el espejo histórico para
  cálculo de deudas y reingresos. Se actualiza a mano desde el panel cuando la CD
  cambia el plan en MP (el sync diario detecta divergencias y avisa).

### ProcesoReempadronamiento
- `id`, `libro_id`, `estado` (`preparacion` | `primera_instancia` | `segunda_instancia`
  | `cierre_pendiente` | `cerrado`), `fecha_convocatoria`, `fin_primera` (+30 días),
  `fin_segunda` (+10 días), `fecha_oficializacion_igj`, `fecha_estimada_elecciones`
  (nullable, para validar REG-26), `acta_convocatoria_id`, `acta_cierre_id`

### Presentacion (re-empadronamiento de un adherente)
- `proceso_id`, `socio_id` (UNIQUE por proceso), `estado`
  (`pendiente` | `presentada` | `validada` | `observada` | `rechazada` | `baja_declarada`),
  `presentada_at`, `validada_por`, `observacion`, datos confirmados/actualizados
  (email, teléfono, domicilio), documentos (FK Documento)
- `baja_declarada` guarda `acta_id`, `notificada_at` y `recurso_hasta`
  (= notificada_at + 30 días, REG-24).

### Notificacion
- `socio_id` (nullable para solicitudes), `tipo` (catálogo: verificacion_email,
  invitacion_password, resultado_solicitud, reempadronamiento_1, reempadronamiento_2,
  baja_declarada, recordatorio_cuota, alerta_mora, recibo, generica…),
  `via` (`email` | `cartelera`), `enviada_at`, `estado` (`enviada` | `entregada` |
  `rebotada` | `fijada_cartelera` | `cumplida_cartelera`), `brevo_message_id`,
  `cartelera_desde`, `cartelera_hasta` (20 días hábiles, REG-10), `payload_resumen`

### Usuario / Rol
- `Usuario`: `email` (UNIQUE), `password_hash` (bcrypt), `socio_id` (nullable),
  `activo`, `ultimo_login`
- Roles: `superadmin` | `admin` | `socio` — tabla N:N, acumulables.

### Noticia
- `titulo`, `slug`, `cuerpo` (markdown o rich text simple), `imagen_path` (nullable),
  `estado` (`borrador` | `publicada`), `publicada_at`, `autor_id`

### Calle
- Importada de `datos/calles_inicial.csv`: `id_calle`, `orden_carga`, `nombre_calle`,
  `nombre_normalizado` (lowercase, sin tildes, sin espacios dobles ni comas espaciadas,
  para el buscador). ABM solo superadmin.

### Feriado
- `fecha`, `descripcion` — para cómputo de días hábiles (REG-10). ABM admin.

### Configuracion
- Clave/valor tipado: `asociate_activo` (bool), `reempadronamiento_proceso_id`
  (nullable — si está seteado, ASOCIATE se suspende y REEMPADRONATE se activa),
  `elecciones_en_curso` (bool, REG-07), textos legales (términos, consentimiento
  de datos), datos de contacto, links de estatuto.

### Auditoria
- `usuario_id`, `accion`, `entidad`, `entidad_id`, `detalle_json`, `ip`, `timestamp`
- Se registra: login, aprobación/rechazo/recategorización de solicitudes, altas/bajas/
  movimientos, registro de pagos en efectivo, anulaciones, visualización de documentos,
  cambios de configuración, cierres de libro.

### WebhookEvent
- `origen` (`mp` | `brevo`), `event_id_externo` (UNIQUE por origen — idempotencia),
  `topic`, `payload` (JSON crudo), `recibido_at`, `procesado_at`, `resultado`, `error`

## Importación inicial (seed del Libro N° 1)

Script `scripts/import-padron.ts` que lee `datos/padron_socios.xlsx`:

1. Crea Libro 1 (abierto) y las 285 membresías con su `numero_socio` original.
   Los 20 números ausentes (REG-35) no se crean: son huecos legítimos del libro.
2. Crea cada Socio con lo que haya: `apellido_nombre`, `categoria_socio`,
   `fecha_ingreso`, `estado` (`activo`='Si' → vigente; 'No' → baja), `fecha_egreso`,
   `motivo_baja` mapeado al catálogo (`Mora`→`cesantia_mora`, `Fallecido/a`→
   `fallecimiento`, domicilios fuera del barrio→`cesantia_mudanza`, `-`→null).
3. Los DNI/domicilios/emails faltantes quedan null: se completan a mano desde el
   panel admin (pantalla de edición de socio pensada para carga rápida desde ficha,
   con navegación siguiente/anterior por número de socio).
4. El campo `debito_automatico`='Si' del Excel marca candidatos a vincular
   suscripciones MP preexistentes (ver `06-integracion-mercadopago.md`).
5. El import es idempotente (re-ejecutable sin duplicar) y genera reporte de
   inconsistencias.
