import { describe, expect, it } from "vitest";
import {
  billingCycleFrom,
  billingMonthKey,
  daysBetween,
  istToday,
  nextRenewalDateAfter,
  servicePeriodFrom,
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

describe("servicePeriodFrom", () => {
  it("runs from the start date for the given number of months, ending the day before", () => {
    expect(servicePeriodFrom("2026-10-09", 3)).toEqual({
      start: "2026-10-09",
      end: "2027-01-08",
      narration: "Service period: 9 October 2026 to 8 January 2027",
    });
    expect(servicePeriodFrom("2026-10-01", 6).end).toBe("2027-03-31");
  });

  it("is the calendar month when started on the 1st for one month", () => {
    expect(servicePeriodFrom("2026-10-01", 1)).toEqual({
      start: "2026-10-01",
      end: "2026-10-31",
      narration: "Service period: 1 October 2026 to 31 October 2026",
    });
    expect(servicePeriodFrom("2028-02-01", 1).end).toBe("2028-02-29");
    expect(servicePeriodFrom("2026-12-01", 1).end).toBe("2026-12-31");
  });

  it("clamps to the last day when the target month is shorter", () => {
    expect(servicePeriodFrom("2026-11-30", 3).end).toBe("2027-02-27");
  });
});

describe("billingCycleFrom", () => {
  it("keys the cycle by its start date and carries months and the amount (null = client_pricing base price)", () => {
    expect(billingCycleFrom("2026-10-01", 1, null)).toEqual({
      key: "2026-10-01",
      months: 1,
      amount: null,
      period: servicePeriodFrom("2026-10-01", 1),
    });
    expect(billingCycleFrom("2026-10-09", 3, 39000)).toMatchObject({ key: "2026-10-09", months: 3, amount: 39000 });
  });
});

describe("nextRenewalDateAfter", () => {
  it("is the day after the paid period ends — what HubSpot's Next Renewal Date becomes on payment", () => {
    expect(nextRenewalDateAfter("2026-10-01", 1)).toBe("2026-11-01");
    expect(nextRenewalDateAfter("2026-10-09", 3)).toBe("2027-01-09");
    expect(nextRenewalDateAfter("2026-11-30", 3)).toBe("2027-02-28");
  });
});

describe("daysBetween", () => {
  it("counts calendar days between two ISO dates", () => {
    expect(daysBetween("2026-10-09", "2026-10-12")).toBe(3);
    expect(daysBetween("2026-10-01", "2026-10-01")).toBe(0);
    expect(daysBetween("2026-09-30", "2026-10-01")).toBe(1);
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
