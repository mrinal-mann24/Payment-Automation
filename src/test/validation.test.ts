import { describe, expect, it } from "vitest";
import { escapeHtml } from "../utils/escapeHtml.js";
import { amountSchema, hubspotIdSchema, isRealDateNotAfter } from "../utils/validation.js";

describe("hubspotIdSchema", () => {
  it("accepts only digits, so a request value can never change the HubSpot URL it is placed in", () => {
    expect(hubspotIdSchema.safeParse("337128679127").success).toBe(true);
    for (const bad of ["", "12 3", "abc", "1/../../contacts/2", "123?x=1", "123#", "-5", "12.5"]) {
      expect(hubspotIdSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("isRealDateNotAfter", () => {
  it("accepts a real calendar date up to and including today", () => {
    expect(isRealDateNotAfter("2026-09-28", "2026-09-28")).toBe(true);
    expect(isRealDateNotAfter("2026-02-28", "2026-09-28")).toBe(true);
    expect(isRealDateNotAfter("2028-02-29", "2028-03-01")).toBe(true);
  });

  it("rejects a future date, an impossible date and anything not shaped like a date", () => {
    expect(isRealDateNotAfter("2026-09-29", "2026-09-28")).toBe(false);
    expect(isRealDateNotAfter("9999-12-31", "2026-09-28")).toBe(false);
    expect(isRealDateNotAfter("2026-02-30", "2026-09-28")).toBe(false);
    expect(isRealDateNotAfter("2026-13-01", "2026-09-28")).toBe(false);
    expect(isRealDateNotAfter("2026-9-1", "2026-09-28")).toBe(false);
    expect(isRealDateNotAfter("yesterday", "2026-09-28")).toBe(false);
  });
});

describe("amountSchema", () => {
  it("accepts a positive amount up to one crore and nothing else", () => {
    expect(amountSchema.safeParse(10).success).toBe(true);
    expect(amountSchema.safeParse(10_000_000).success).toBe(true);
    for (const bad of [0, -1, 10_000_001, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(amountSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("escapeHtml", () => {
  it("turns markup into plain text for an HTML email body", () => {
    expect(escapeHtml(`Audit <b>2026</b> & "more" 'too'`)).toBe(
      "Audit &lt;b&gt;2026&lt;/b&gt; &amp; &quot;more&quot; &#39;too&#39;",
    );
    expect(escapeHtml("Site visit on 12 October")).toBe("Site visit on 12 October");
  });
});
