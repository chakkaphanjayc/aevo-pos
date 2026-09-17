export interface CashSessionReport {
  sessionId: string;
  openingAmountMinor: number;
  closingAmountMinor: number | null;
  expectedAmountMinor: number;
  cashDifferenceMinor: number | null;
  status: "OPEN" | "CLOSED";
  cashSalesTotalMinor: number;
}

export function generateCashSessionReport(
  session: {
    id: string;
    opening_amount_minor: number;
    closing_amount_minor?: number | null;
    status: "OPEN" | "CLOSED";
  },
  cashPayments: Array<{ amountMinor: number }>
): CashSessionReport {
  const cashSalesTotalMinor = cashPayments.reduce((sum, p) => sum + p.amountMinor, 0);
  const expectedAmountMinor = session.opening_amount_minor + cashSalesTotalMinor;
  const closingAmountMinor = session.closing_amount_minor ?? null;
  const cashDifferenceMinor = closingAmountMinor !== null ? closingAmountMinor - expectedAmountMinor : null;

  return {
    sessionId: session.id,
    openingAmountMinor: session.opening_amount_minor,
    closingAmountMinor,
    expectedAmountMinor,
    cashDifferenceMinor,
    status: session.status,
    cashSalesTotalMinor
  };
}
