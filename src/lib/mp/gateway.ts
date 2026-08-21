// Único punto de contacto con la API de Mercado Pago. El dominio consume ESTA
// interfaz, nunca el SDK: los tests mockean MpGateway y no hay red en vitest.
// SDK oficial `mercadopago` v2 (docs/03). `/authorized_payments` no está en el
// SDK: va con fetch autenticado directo, documentado acá y en la spec §3.
import { MercadoPagoConfig, Payment, PreApproval, PreApprovalPlan } from "mercadopago";

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
  getPreapproval(id: string): Promise<{
    id: string;
    status: string;
    payerEmail: string | null;
    externalReference: string | null;
  }>;
  getPayment(id: string): Promise<{
    id: string;
    status: string;
    transactionAmount: number;
    externalReference: string | null;
  }>;
  getAuthorizedPayment(id: string): Promise<{
    id: string;
    preapprovalId: string | null;
    status: string;
  }>;
};

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
      return {
        id: res.id ?? id,
        status: res.status ?? "unknown",
        payerEmail: res.payer_email ?? null,
        externalReference: res.external_reference ?? null,
      };
    },
    async getPayment(id) {
      const res = await new Payment(mp()).get({ id });
      if (typeof res.transaction_amount !== "number") {
        throw new Error(`El pago ${id} no tiene monto en MP.`);
      }
      return {
        id: String(res.id ?? id),
        status: res.status ?? "unknown",
        transactionAmount: res.transaction_amount,
        externalReference: res.external_reference ?? null,
      };
    },
    async getAuthorizedPayment(id) {
      const res = await fetch(`https://api.mercadopago.com/authorized_payments/${id}`, {
        headers: { Authorization: `Bearer ${accessToken()}` },
      });
      if (!res.ok) throw new Error(`authorized_payments/${id} respondió ${res.status}`);
      const data = (await res.json()) as {
        id?: number;
        preapproval_id?: string;
        status?: string;
      };
      return {
        id: String(data.id ?? id),
        preapprovalId: data.preapproval_id ?? null,
        status: data.status ?? "unknown",
      };
    },
  };
}

export const mpGateway: MpGateway = makeMpGateway();
