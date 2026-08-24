import { afterEach, describe, expect, it } from "vitest";
import { checkCronAuth, CRON_JOBS, CRON_JOB_LIST } from "@/lib/cron/auth";

const req = (auth?: string) =>
  new Request("http://x/api/cron/x", { method: "POST", headers: auth ? { authorization: auth } : {} });

afterEach(() => { delete process.env.CRON_SECRET; });

describe("checkCronAuth", () => {
  it("sin CRON_SECRET → 503 not_configured (el endpoint no existe a efectos prácticos)", async () => {
    const r = checkCronAuth(req("Bearer x"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.response.status).toBe(503);
    expect(await r.response.json()).toEqual({ error: "not_configured" });
  });
  it("bearer que no coincide → 401 unauthorized", async () => {
    process.env.CRON_SECRET = "s3cret";
    const r = checkCronAuth(req("Bearer nope"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.response.status).toBe(401);
  });
  it("sin header → 401 y no revienta (timingSafeEqual tira si los largos difieren)", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(checkCronAuth(req()).ok).toBe(false);
  });
  it("bearer correcto → ok", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(checkCronAuth(req("Bearer s3cret")).ok).toBe(true);
  });
  it("el catálogo de jobs tiene los cinco y sus claves coinciden con su valor", () => {
    expect(CRON_JOB_LIST).toEqual(["reconcile", "applications", "accrual", "reminder", "digest"]);
    for (const [k, v] of Object.entries(CRON_JOBS)) expect(k).toBe(v);
    // `CronRun.job` es VarChar(32): un nombre más largo se truncaría en silencio.
    for (const j of CRON_JOB_LIST) expect(j.length).toBeLessThanOrEqual(32);
  });
});
