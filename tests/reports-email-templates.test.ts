// Las tres plantillas de Reportes (spec §9): el acuse no promete resolución y
// cierra con el canal ARCO; el aviso dice "presentado ante" o "trató tu
// iniciativa" según el tipo; la alerta a la Comisión lleva identidad completa
// (decisión del operador) y escapa el texto del vecino en el HTML.
import { describe, expect, it } from "vitest";
import { reportBoardAlertEmail, reportFiledEmail, reportReceivedEmail } from "@/lib/email/templates";

describe("reportReceivedEmail", () => {
  it("nombra el número, no promete resolución y cita el email de contacto", () => {
    const m = reportReceivedEmail({ number: 14, kind: "claim", categoryLabel: "Calles y vía pública", contactEmail: "info@vecinal.ar" });
    expect(m.subject).toContain("N° 14");
    expect(m.text).toContain("Comisión Directiva");
    expect(m.text).toContain("info@vecinal.ar");
    expect(m.text.toLowerCase()).not.toContain("vamos a resolver");
    expect(m.html).toContain("N° 14");
  });
  it("sin email de contacto cargado, manda a la sede", () => {
    const m = reportReceivedEmail({ number: 2, kind: "initiative", categoryLabel: "Social", contactEmail: null });
    expect(m.text).toContain("sede");
  });
  // Art. 6: la iniciativa la trata la Comisión y NUNCA se presenta ante un
  // organismo. Prometerle a un vecino un trámite ante la SCPL por una propuesta
  // es prometer algo que no va a pasar.
  it("iniciativa: la evalúa la Comisión (Art. 6), sin organismo ni SCPL", () => {
    const m = reportReceivedEmail({ number: 2, kind: "initiative", categoryLabel: "Social", contactEmail: "info@vecinal.ar" });
    expect(m.text).toContain("Art. 6");
    expect(m.text).not.toContain("organismo");
    expect(m.text).not.toContain("SCPL");
    expect(m.html).toContain("Art. 6");
    expect(m.html).not.toContain("organismo");
    expect(m.html).not.toContain("SCPL");
  });
  it("reclamo: sí menciona el organismo y la vía directa", () => {
    const m = reportReceivedEmail({ number: 14, kind: "claim", categoryLabel: "Agua potable", contactEmail: "info@vecinal.ar" });
    expect(m.text).toContain("organismo");
    expect(m.text).toContain("SCPL");
    expect(m.html).toContain("organismo");
  });
});

describe("reportFiledEmail", () => {
  it("reclamo: presentado ante el organismo, con expediente si lo hay", () => {
    const m = reportFiledEmail({ number: 14, kind: "claim", agencyLabel: "SCPL", filedAt: new Date("2026-09-12T15:00:00Z"), reference: "1234" });
    expect(m.text).toContain("Presentamos tu reporte N° 14 ante SCPL el 12/09/2026");
    expect(m.text).toContain("1234");
  });
  it("iniciativa: la trató la Comisión", () => {
    const m = reportFiledEmail({ number: 3, kind: "initiative", agencyLabel: null, filedAt: new Date("2026-09-12T15:00:00Z"), reference: null });
    expect(m.text).toContain("La Comisión Directiva trató tu iniciativa N° 3");
  });
  // La referencia de una iniciativa es INTERNA: no hay expediente ajeno que
  // seguir, y el seguimiento es en la sede.
  it("iniciativa: referencia interna y seguimiento en la sede, no en un organismo", () => {
    const m = reportFiledEmail({ number: 3, kind: "initiative", agencyLabel: null, filedAt: new Date("2026-09-12T15:00:00Z"), reference: "CD-9" });
    expect(m.text).toContain("(ref. CD-9)");
    expect(m.text).toContain("sede");
    expect(m.text).not.toContain("expediente");
    expect(m.text).not.toContain("organismo");
    expect(m.html).toContain("(ref. CD-9)");
    expect(m.html).toContain("sede");
    expect(m.html).not.toContain("expediente");
    expect(m.html).not.toContain("organismo");
  });
  it("reclamo: el seguimiento queda en manos del organismo", () => {
    const m = reportFiledEmail({ number: 14, kind: "claim", agencyLabel: "SCPL", filedAt: new Date("2026-09-12T15:00:00Z"), reference: "1234" });
    expect(m.text).toContain("(expediente 1234)");
    expect(m.text).toContain("organismo");
    expect(m.html).toContain("organismo");
  });
});

describe("reportBoardAlertEmail", () => {
  it("lleva identidad completa, marca 'reservado' y escapa el HTML del vecino", () => {
    const m = reportBoardAlertEmail({
      number: 14, kind: "claim", categoryLabel: "Agua potable", subtypeLabel: "Pérdida de agua en la red",
      street: "Cerro Catedral al 280", description: "Hay <b>agua</b> & barro",
      reporter: { name: "Ana López", dni: "30123456", phone: "2974", email: "ana@example.com", anonymous: true },
      panelUrl: "https://vecinalciudadela.ar/admin/solicitudes/reportes/14",
    });
    expect(m.subject).toContain("Reclamo N° 14");
    expect(m.text).toContain("Ana López");
    expect(m.text).toContain("30123456");
    expect(m.text).toContain("reservada");
    expect(m.html).toContain("&lt;b&gt;agua&lt;/b&gt; &amp; barro");
    expect(m.html).toContain("https://vecinalciudadela.ar/admin/solicitudes/reportes/14");
  });
});
