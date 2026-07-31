// Pay negotiation.
//
// The assistant is allowed to raise the rate to close a shift, but only within
// a budget the backend sets. The model proposes; this module decides. Anything
// the assistant says on the phone is a claim, so the agreed rate is re-parsed
// and clamped here before it reaches the schedule or the confirmation SMS.

/** How much above the posted rate the assistant may go, per hour. */
export function maxPayIncrease(): number {
  const value = Number(process.env.SHIFT_MAX_PAY_INCREASE);
  return Number.isFinite(value) && value >= 0 ? value : 5;
}

export interface ParsedPay {
  /** Numeric amount, e.g. 24 for "$24 per hour". */
  amount: number;
  /** Currency symbol as written, defaulting to "$". */
  symbol: string;
  /** Whatever followed the number, e.g. "per hour". Preserved when reformatting. */
  suffix: string;
}

/**
 * Pulls the number out of a free-text pay string. Pay is stored as prose
 * ("$24 per hour") because that is what gets spoken and texted, so negotiating
 * on it means parsing it back out.
 */
export function parsePay(pay: string | undefined): ParsedPay | null {
  if (typeof pay !== "string") return null;

  const match = pay.match(/([€£$])?\s*(\d+(?:\.\d{1,2})?)/);
  if (!match) return null;

  const amount = Number(match[2]);
  if (!Number.isFinite(amount)) return null;

  return {
    amount,
    symbol: match[1] ?? "$",
    suffix: pay.slice(match.index! + match[0].length).trim(),
  };
}

/** Renders an amount back into the same shape the original string had. */
export function formatPay(amount: number, like: ParsedPay): string {
  const rounded = Math.round(amount * 100) / 100;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
  return `${like.symbol}${text}${like.suffix ? ` ${like.suffix}` : ""}`;
}

/**
 * The ceiling the assistant may offer. Returns the base pay unchanged when the
 * rate is not a parseable number, so an unusual pay string ("negotiable",
 * "London weighting") disables negotiation rather than inventing a figure.
 */
export function maxPayFor(pay: string, increase = maxPayIncrease()): string {
  const parsed = parsePay(pay);
  if (!parsed) return pay;
  return formatPay(parsed.amount + increase, parsed);
}

export interface AgreedPayOutcome {
  /** The rate to store, speak and text. Never above base + the budget. */
  pay: string;
  /** How much above the posted rate this ended up, in currency units. */
  raise: number;
  /** True when the assistant asked for more than it was allowed and was cut back. */
  clamped: boolean;
}

/**
 * Settles what the worker actually gets.
 *
 * The assistant supplies `agreed` as free text from the conversation. It is
 * trusted to report the number it said out loud and nothing more: below the
 * posted rate is ignored (a worker never negotiates downwards, so that is a
 * mis-transcription), and above the budget is clamped to the budget.
 */
export function settleAgreedPay(
  basePay: string,
  agreed: string | undefined,
  increase = maxPayIncrease(),
): AgreedPayOutcome {
  const base = parsePay(basePay);
  const proposed = parsePay(agreed);

  if (!base || !proposed) return { pay: basePay, raise: 0, clamped: false };

  const ceiling = base.amount + increase;
  if (proposed.amount <= base.amount) return { pay: basePay, raise: 0, clamped: false };

  const settled = Math.min(proposed.amount, ceiling);
  return {
    pay: formatPay(settled, base),
    raise: Math.round((settled - base.amount) * 100) / 100,
    clamped: proposed.amount > ceiling,
  };
}
