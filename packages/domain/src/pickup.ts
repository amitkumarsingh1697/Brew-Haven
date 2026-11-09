/** Pickup numbers restart daily per outlet, e.g. "A-042" (ADR-0005). */
export function formatPickupCode(outletPrefix: string, dailySequence: number): string {
  if (!/^[A-Z]{1,3}$/.test(outletPrefix)) throw new RangeError("outlet prefix must be 1-3 capital letters");
  if (!Number.isInteger(dailySequence) || dailySequence < 1) throw new RangeError("sequence must be a positive integer");
  return `${outletPrefix}-${String(dailySequence).padStart(3, "0")}`;
}
