import { describe, expect, it } from "vitest";
import {
  billingMonthKey,
  istToday,
  servicePeriod,
  toIsoDate,
  unixSecondsToIstDate,
} from "../utils/billingCycle.js";

describe("istToday", () => {
  it("uses the IST calendar date, not UTC (the container runs in UTC)", () => {
    expect(istToday(new Date("2026-09-30T18:29:59Z"))).toBe("2026-09-30");
    expect(istToday(new Date("2026-09-30T18:30:00Z"))).toBe("2026-10-01");
  });
});

describe("billingMonthKey", () => {
  it("is the IST year-month", () => {
    expect(billingMonthKey(new Date("2026-09-30T18:30:00Z"))).toBe("2026-10");
    expect(billingMonthKey(new Date("2026-10-15T05:30:00Z"))).toBe("2026-10");
  });
});

describe("servicePeriod", () => {
  it("spans the first to the last day of the month with a narration", () => {
    expect(servicePeriod("2026-10")).toEqual({
      start: "2026-10-01",
      end: "2026-10-31",
      narration: "Service period: 1 October 2026 to 31 October 2026",
    });
  });

  it("handles 30-day months, leap February and December", () => {
    expect(servicePeriod("2026-09").end).toBe("2026-09-30");
    expect(servicePeriod("2028-02").end).toBe("2028-02-29");
    expect(servicePeriod("2027-02").end).toBe("2027-02-28");
    expect(servicePeriod("2026-12")).toMatchObject({
      end: "2026-12-31",
      narration: "Service period: 1 December 2026 to 31 December 2026",
    });
  });

  it("rejects anything that is not a YYYY-MM key", () => {
    expect(() => servicePeriod("Monthly-2026-07-10")).toThrow(/YYYY-MM/);
  });
});

describe("toIsoDate", () => {
  it("normalises HubSpot's epoch-ms and ISO date shapes to YYYY-MM-DD without shifting timezone", () => {
    expect(toIsoDate("1790812800000")).toBe("2026-10-01");
    expect(toIsoDate("2026-09-01")).toBe("2026-09-01");
    expect(toIsoDate("2026-09-01T00:00:00.000Z")).toBe("2026-09-01");
  });

  it("returns null for blank or unparseable values", () => {
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoDate("")).toBeNull();
    expect(toIsoDate("garbage")).toBeNull();
  });
});

describe("unixSecondsToIstDate", () => {
  it("converts Razorpay's created_at (epoch seconds) to the IST calendar date", () => {
    expect(unixSecondsToIstDate(1790793000)).toBe("2026-10-01"); // 2026-09-30T18:30:00Z
    expect(unixSecondsToIstDate(1790792999)).toBe("2026-09-30");
  });
});
