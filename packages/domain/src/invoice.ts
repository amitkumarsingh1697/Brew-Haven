/**
 * Indian financial year (April to March) for a business date, as four digits: "2627" for
 * 1 Apr 2026 to 31 Mar 2027.
 */
export function financialYear(businessDate: string): string {
  const [y, m] = businessDate.split("-").map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${String(start % 100).padStart(2, "0")}${String((start + 1) % 100).padStart(2, "0")}`;
}

/**
 * Receipt number: café letter(s), financial year, then a sequence that restarts each April,
 * e.g. "A2627-00042". GST rules allow up to 16 characters of letters, digits, "-" and "/",
 * unique within the financial year.
 */
export function formatInvoiceNo(outletPrefix: string, fy: string, seq: number): string {
  return `${outletPrefix}${fy}-${String(seq).padStart(5, "0")}`;
}

/** Splits GST for a supply within the state: half central (CGST), half state (SGST). */
export function splitGst(taxPaise: number): { cgstPaise: number; sgstPaise: number } {
  const cgstPaise = Math.floor(taxPaise / 2);
  return { cgstPaise, sgstPaise: taxPaise - cgstPaise };
}
