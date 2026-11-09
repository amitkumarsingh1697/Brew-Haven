import { describe, expect, it } from "vitest";
import { financialYear, formatInvoiceNo, splitGst } from "../src/invoice.js";

describe("receipt numbering", () => {
  it("uses the April to March financial year", () => {
    expect(financialYear("2026-04-01")).toBe("2627");
    expect(financialYear("2027-03-31")).toBe("2627");
    expect(financialYear("2026-03-31")).toBe("2526");
    expect(financialYear("2099-12-01")).toBe("9900");
  });
  it("formats within the 16-character GST limit", () => {
    const n = formatInvoiceNo("ABC", "2627", 99999);
    expect(n).toBe("ABC2627-99999");
    expect(n.length).toBeLessThanOrEqual(16);
    expect(formatInvoiceNo("A", "2627", 42)).toBe("A2627-00042");
  });
  it("splits GST into equal halves, odd paise to SGST", () => {
    expect(splitGst(1000)).toEqual({ cgstPaise: 500, sgstPaise: 500 });
    expect(splitGst(1001)).toEqual({ cgstPaise: 500, sgstPaise: 501 });
  });
});
