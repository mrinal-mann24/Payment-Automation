import { describe, expect, it } from "vitest";
import {
  billingMonthKey,
  istToday,
  currentBillingCycle,
  daysBetween,
  servicePeriod,
  servicePeriodFrom,
  termBillingCycle,
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

describe("servicePeriodFrom (term cycles)", () => {
  it("runs from the day the last term ended for the given number of months, ending the day before", () => {
    expect(servicePeriodFrom("2026-10-09", 3)).toEqual({
      start: "2026-10-09",
      end: "2027-01-08",
      narration: "Service period: 9 October 2026 to 8 January 2027",
    });
    expect(servicePeriodFrom("2026-10-01", 6).end).toBe("2027-03-31");
  });

  it("is the calendar month when started on the 1st for one month", () => {
    expect(servicePeriodFrom("2026-10-01", 1)).toEqual(servicePeriod("2026-10"));
  });

  it("clamps to the last day when the target month is shorter", () => {
    expect(servicePeriodFrom("2026-11-30", 3).end).toBe("2027-02-27");
  });
});

describe("billing cycles", () => {
  it("the current monthly cycle is one month priced from client_pricing", () => {
    expect(currentBillingCycle(new Date("2026-10-15T05:30:00Z"))).toMatchObject({ key: "2026-10", months: 1, amount: null });
  });

  it("a term cycle is keyed by its start date and carries the amount to bill", () => {
    expect(termBillingCycle("2026-10-09", 3, 39000)).toEqual({
      key: "2026-10-09",
      months: 3,
      amount: 39000,
      period: servicePeriodFrom("2026-10-09", 3),
    });
  });
});

describe("daysBetween", () => {
  it("counts calendar days between two ISO dates", () => {
    expect(daysBetween("2026-10-09", "2026-10-12")).toBe(3);
    expect(daysBetween("2026-10-01", "2026-10-01")).toBe(0);
    expect(daysBetween("2026-09-30", "2026-10-01")).toBe(1);
  });
});
