import { describe, expect, it } from "vitest";
import { buildSelfAddressPatch, selfAddressSchema } from "@/lib/members/self-edit";

describe("buildSelfAddressPatch", () => {
  it("catalog street wins and clears the free text (single source of truth)", () => {
    const patch = buildSelfAddressPatch({ streetId: 3, streetText: "otra", streetNumber: "123" });
    expect(patch).toEqual({
      streetId: 3, streetText: null, streetNumber: "123", neighborhood: null,
      addressPendingReview: true,
    });
  });

  it("free text without catalog id is kept", () => {
    const patch = buildSelfAddressPatch({ streetText: "Ruta 3 km 5", neighborhood: "Otro" });
    expect(patch).toMatchObject({ streetId: null, streetText: "Ruta 3 km 5", neighborhood: "Otro" });
  });

  it("always flags the address as pending review", () => {
    expect(buildSelfAddressPatch({}).addressPendingReview).toBe(true);
  });

  it("empty strings become null, never empty text", () => {
    const patch = buildSelfAddressPatch({ streetText: "  ", streetNumber: "", neighborhood: " " });
    expect(patch).toMatchObject({ streetText: null, streetNumber: null, neighborhood: null });
  });
});

describe("selfAddressSchema", () => {
  it("caps lengths like the card editor", () => {
    expect(selfAddressSchema.safeParse({ streetText: "x".repeat(121) }).success).toBe(false);
    expect(selfAddressSchema.safeParse({ streetNumber: "12345678901" }).success).toBe(false);
  });
});
