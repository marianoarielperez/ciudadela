// Único punto de contacto con la API de Mercado Pago. El dominio consume ESTA
// interfaz, nunca el SDK: los tests mockean MpGateway y no hay red en vitest.
// SDK oficial `mercadopago` v2 (docs/03). `/authorized_payments` y las búsquedas
// no están en el SDK (o no paginan): van con fetch autenticado directo,
// documentado acá y en la spec §3.
import { MercadoPagoConfig, Payment, PreApproval, PreApprovalPlan, Preference } from "mercadopago";

export type MpPaymentDetails = {
  id: string;
  status: string;
  statusDetail: string | null;
  transactionAmount: number;
  externalReference: string | null;
  /** `date_approved` de MP como instante UTC; null si el pago no está aprobado. */
  dateApproved: Date | null;
  payerEmail: string | null;
  description: string | null;
};

export type MpAuthorizedPayment = {
  id: string;
  preapprovalId: string | null;
  status: string;
  /** El `payment.id` del cobro real; null mientras MP no lo haya creado. */
  paymentId: string | null;
  amount: number | null;
  dateCreated: Date | null;
  externalReference: string | null;
};

export type MpPreapproval = {
  id: string;
  status: string;
  payerEmail: string | null;
  externalReference: string | null;
  amount: number | null;
  reason: string | null;
  nextPaymentDate: Date | null;
  dateCreated: Date | null;
};

export type MpGateway = {
  getPlan(planId: string): Promise<{ id: string; reason: string; amount: number }>;
  /** Suscripción SIN plan asociado, con pago pendiente: es el ÚNICO flujo de
   *  `POST /preapproval` que devuelve `init_point` para redirigir al vecino.
   *
   *  El flujo CON `preapproval_plan_id` exige `card_token_id` + `status:
   *  "authorized"` (medido contra la API real el 21/08/2026: responde
   *  `{"message":"card_token_id is required","status":400}`), o sea el
   *  formulario de tarjeta en NUESTRO sitio y sin pantalla de autorización de
   *  MP. Por eso el body lleva `reason` + `auto_recurring` inline y NO lleva
   *  plan. Ver `docs/06` §2 antes de "restaurarlo".
   *
   *  `amount` es el que MP le cobra al vecino: quien llame tiene que leerlo
   *  fresco, no de una caché (ver `asociate/actions.ts`). */
  createPreapproval(input: {
    reason: string;
    amount: number;
    payerEmail: string;
    externalReference: string;
    backUrl: string;
  }): Promise<{ id: string; initPoint: string; status: string }>;
  cancelPreapproval(id: string): Promise<void>;
  updatePreapprovalAmount(id: string, amount: number): Promise<void>;
  getPreapproval(id: string): Promise<MpPreapproval>;
  getPayment(id: string): Promise<MpPaymentDetails>;
  getAuthorizedPayment(id: string): Promise<MpAuthorizedPayment>;
  /** `GET /preapproval/search`, paginado hasta agotar. */
  searchPreapprovals(input?: { status?: string }): Promise<MpPreapproval[]>;
  /** `GET /authorized_payments/search?preapproval_id=`: la ÚNICA forma de hallar
   *  los cobros de una suscripción (docs/11 §7). */
  searchAuthorizedPayments(preapprovalId: string): Promise<MpAuthorizedPayment[]>;
  /** `GET /v1/payments/search` aprobados por `date_approved` desde `since`. */
  searchPayments(input: { since: Date }): Promise<MpPaymentDetails[]>;
  /** Checkout Pro. La preferencia NO se persiste: el pago se reconoce por la referencia. */
  createPreference(input: {
    title: string;
    amount: number;
    externalReference: string;
    backUrl: string;
    notificationUrl: string;
    /** Instante en que MP deja de aceptar el enlace. Obligatorio: sin él la
     *  preferencia no vence nunca y el importe congelado sobrevive a una
     *  actualización de cuota (REG-34). Ver `PAYMENT_LINK_TTL_HOURS`. */
    expiresAt: Date;
  }): Promise<{ id: string; initPoint: string }>;
};

const API = "https://api.mercadopago.com";
const PAGE = 100;

/** MP manda ISO con offset argentino (`...-03:00`). El gateway es el ÚNICO
 *  lugar donde eso se convierte a `Date`: nadie más parsea strings de MP. */
function isoToDate(s: unknown): Date | null {
  if (typeof s !== "string" || s === "") return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function numberOrNull(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** El inverso de `isoToDate`: MP quiere las fechas de vencimiento en ISO 8601
 *  CON offset (`yyyy-MM-ddTHH:mm:ss.SSS±hh:mm`). Argentina es UTC-3 fijo y sin
 *  DST, así que la conversión es una resta y no hace falta Intl. Se escribe con
 *  el offset argentino y no con `Z` porque es el formato que la documentación de
 *  MP fija y el único que sus ejemplos muestran. */
function toMpDateTime(d: Date): string {
  return `${new Date(d.getTime() - 3 * 60 * 60_000).toISOString().slice(0, 23)}-03:00`;
}

type RawPayment = {
  id?: number | string;
  status?: string;
  status_detail?: string;
  transaction_amount?: number;
  external_reference?: string | null;
  date_approved?: string | null;
  payer?: { email?: string | null } | null;
  description?: string | null;
};

function mapPayment(res: RawPayment, fallbackId: string): MpPaymentDetails {
  if (typeof res.transaction_amount !== "number") {
    throw new Error(`El pago ${fallbackId} no tiene monto en MP.`);
  }
  return {
    id: String(res.id ?? fallbackId),
    status: res.status ?? "unknown",
    statusDetail: res.status_detail ?? null,
    transactionAmount: res.transaction_amount,
    externalReference: res.external_reference ?? null,
    dateApproved: isoToDate(res.date_approved),
    payerEmail: res.payer?.email ?? null,
    description: res.description ?? null,
  };
}

type RawAuthorized = {
  id?: number | string;
  preapproval_id?: string;
  status?: string;
  payment?: { id?: number | string } | null;
  transaction_amount?: number;
  date_created?: string;
  external_reference?: string | null;
};

function mapAuthorized(data: RawAuthorized, fallbackId: string): MpAuthorizedPayment {
  return {
    id: String(data.id ?? fallbackId),
    preapprovalId: data.preapproval_id ?? null,
    status: data.status ?? "unknown",
    paymentId: data.payment?.id != null ? String(data.payment.id) : null,
    amount: numberOrNull(data.transaction_amount),
    dateCreated: isoToDate(data.date_created),
    externalReference: data.external_reference ?? null,
  };
}

type RawPreapproval = {
  id?: string;
  status?: string;
  payer_email?: string | null;
  external_reference?: string | null;
  reason?: string | null;
  auto_recurring?: { transaction_amount?: number } | null;
  next_payment_date?: string | null;
  date_created?: string | null;
};

function mapPreapproval(res: RawPreapproval, fallbackId: string): MpPreapproval {
  return {
    id: res.id ?? fallbackId,
    status: res.status ?? "unknown",
    payerEmail: res.payer_email ?? null,
    externalReference: res.external_reference ?? null,
    amount: numberOrNull(res.auto_recurring?.transaction_amount),
    reason: res.reason ?? null,
    nextPaymentDate: isoToDate(res.next_payment_date),
    dateCreated: isoToDate(res.date_created),
  };
}

function accessToken(): string {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error("MP_ACCESS_TOKEN no está configurado.");
  return token;
}

export function makeMpGateway(): MpGateway {
  // Lazy: la config se construye recién en la primera llamada, así el import
  // del módulo no explota en dev sin credenciales (mismo criterio que el
  // transporte de email, que cae a consola).
  let client: MercadoPagoConfig | null = null;
  function mp(): MercadoPagoConfig {
    if (!client) client = new MercadoPagoConfig({ accessToken: accessToken() });
    return client;
  }

  // Búsquedas por fetch directo: el SDK no expone `/preapproval/search` ni
  // `/authorized_payments` y su `payments.search` no pagina por nosotros. Una
  // respuesta no-2xx lanza (es un fallo técnico, que el llamador convierte en
  // 500 o en `errors[]` del cron), nunca se traduce a "no hay resultados".
  //
  // `pageSize` es OPCIONAL y no por prolijidad: `/authorized_payments/search`
  // RECHAZA el parámetro `limit` por encima de ~15 con
  // `{"message":"Invalid value for limit","status":400}`, así que mandarle el
  // `PAGE` de 100 lo hacía fallar SIEMPRE. Verificado contra la API el
  // 23/08/2026: sin `limit` responde 200 y pagina de a 12 por su cuenta;
  // `/v1/payments/search`, en cambio, acepta 100 sin chistar.
  //
  // El bucle ya avanza con `page.length` y corta contra `paging.total`, así que
  // omitir `limit` es correcto para cualquier tamaño de página que elija MP —
  // y es más robusto que adivinarle el tope, que es de ellos y puede cambiar.
  async function searchAll<T>(
    path: string,
    params: Record<string, string>,
    label: string,
    pageSize?: number,
  ): Promise<T[]> {
    const out: T[] = [];
    let offset = 0;
    for (;;) {
      const qs = new URLSearchParams({
        ...params,
        ...(pageSize === undefined ? {} : { limit: String(pageSize) }),
        offset: String(offset),
      });
      const res = await fetch(`${API}${path}?${qs}`, {
        headers: { Authorization: `Bearer ${accessToken()}` },
      });
      if (!res.ok) throw new Error(`${label} respondió ${res.status}`);
      const data = (await res.json()) as { paging?: { total?: number }; results?: T[] };
      const page = data.results ?? [];
      out.push(...page);
      offset += page.length;
      const total = data.paging?.total ?? out.length;
      if (page.length === 0 || offset >= total) return out;
    }
  }

  return {
    async getPlan(planId) {
      const plan = await new PreApprovalPlan(mp()).get({ preApprovalPlanId: planId });
      const amount = plan.auto_recurring?.transaction_amount;
      if (!plan.id || typeof amount !== "number") {
        throw new Error(`El plan ${planId} no tiene monto en MP.`);
      }
      return { id: plan.id, reason: plan.reason ?? "", amount };
    },
    async createPreapproval(input) {
      const res = await new PreApproval(mp()).create({
        body: {
          reason: input.reason,
          // Mensual en ARS y nada más: es la cuota societaria (REG-34), no un
          // catálogo. Fijarlo acá —y no como parámetro— deja un solo lugar
          // donde mirar si algún día hay otra periodicidad, y coincide con el
          // criterio de `updatePreapprovalAmount`, que también fija "ARS".
          auto_recurring: {
            frequency: 1,
            frequency_type: "months",
            transaction_amount: input.amount,
            currency_id: "ARS",
          },
          payer_email: input.payerEmail,
          // Obligatorio en las suscripciones sin plan, y además es lo que el
          // webhook usa para encontrar la solicitud (`^solicitud:(\d+)$`).
          external_reference: input.externalReference,
          back_url: input.backUrl,
          status: "pending",
        },
      });
      if (!res.id || !res.init_point) throw new Error("MP no devolvió la suscripción creada.");
      return { id: res.id, initPoint: res.init_point, status: res.status ?? "pending" };
    },
    async cancelPreapproval(id) {
      await new PreApproval(mp()).update({ id, body: { status: "cancelled" } });
    },
    async updatePreapprovalAmount(id, amount) {
      await new PreApproval(mp()).update({
        id,
        body: { auto_recurring: { transaction_amount: amount, currency_id: "ARS" } },
      });
    },
    async getPreapproval(id) {
      const res = await new PreApproval(mp()).get({ id });
      return mapPreapproval(res as RawPreapproval, id);
    },
    async getPayment(id) {
      const res = await new Payment(mp()).get({ id });
      return mapPayment(res as RawPayment, id);
    },
    async getAuthorizedPayment(id) {
      const res = await fetch(`${API}/authorized_payments/${id}`, {
        headers: { Authorization: `Bearer ${accessToken()}` },
      });
      if (!res.ok) throw new Error(`authorized_payments/${id} respondió ${res.status}`);
      return mapAuthorized((await res.json()) as RawAuthorized, id);
    },
    async searchPreapprovals(input) {
      const params: Record<string, string> = {};
      if (input?.status) params.status = input.status;
      const rows = await searchAll<RawPreapproval>(
        "/preapproval/search",
        params,
        "preapproval/search",
        PAGE,
      );
      return rows.map((r) => mapPreapproval(r, r.id ?? ""));
    },
    async searchAuthorizedPayments(preapprovalId) {
      // SIN `limit`: este endpoint lo rechaza (ver la cabecera de `searchAll`).
      // Es el que sostiene el paso 2 de la conciliación —recuperar un débito
      // cuyo webhook no llegó—, así que mandárselo lo dejaba caído en silencio:
      // el cron contaba el error y seguía, y nadie miraba `errors[]`.
      const rows = await searchAll<RawAuthorized>(
        "/authorized_payments/search",
        { preapproval_id: preapprovalId },
        "authorized_payments/search",
      );
      return rows.map((r) => mapAuthorized(r, String(r.id ?? "")));
    },
    async searchPayments(input) {
      const rows = await searchAll<RawPayment>(
        "/v1/payments/search",
        {
          sort: "date_approved",
          criteria: "desc",
          range: "date_approved",
          begin_date: input.since.toISOString(),
          end_date: new Date().toISOString(),
          status: "approved",
        },
        "payments/search",
        PAGE,
      );
      // Un resultado sin monto se descarta en vez de tirar: el cron no puede
      // caerse entero por una fila rara de MP.
      return rows
        .filter((r) => typeof r.transaction_amount === "number")
        .map((r) => mapPayment(r, String(r.id ?? "")));
    },
    async createPreference(input) {
      const res = await new Preference(mp()).create({
        body: {
          items: [
            {
              id: input.externalReference,
              title: input.title,
              quantity: 1,
              unit_price: input.amount,
              currency_id: "ARS",
            },
          ],
          external_reference: input.externalReference,
          back_urls: { success: input.backUrl, pending: input.backUrl, failure: input.backUrl },
          auto_return: "approved",
          notification_url: input.notificationUrl,
          // El enlace vence de verdad: `expires` sin `expiration_date_to` no
          // hace nada, y `expiration_date_to` sin `expires` tampoco. Van los
          // dos. No mandamos `expiration_date_from`: sería "ahora", y un reloj
          // de MP adelantado unos segundos rechazaría la preferencia entera.
          expires: true,
          expiration_date_to: toMpDateTime(input.expiresAt),
        },
      });
      if (!res.id || !res.init_point) throw new Error("MP no devolvió la preferencia creada.");
      return { id: res.id, initPoint: res.init_point };
    },
  };
}

export const mpGateway: MpGateway = makeMpGateway();
