export const DOC_KINDS = ['sales', 'operations'] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export interface AssetDocument {
  name: string;
  type: 'pdf';
  ipfs: string;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "2026-04" + "sales" -> "April 2026 Sales Report". */
export function docDisplayName(month: string, kind: DocKind): string {
  const [yearStr, monthStr] = month.split('-');
  const monthName = MONTH_NAMES[parseInt(monthStr, 10) - 1];
  const kindLabel = kind === 'sales' ? 'Sales' : 'Operations';
  return `${monthName} ${yearStr} ${kindLabel} Report`;
}

/**
 * Merge incoming entries into existing, keyed by `name`. Incoming overrides a
 * same-named existing entry in place; genuinely new entries are appended.
 * Pure — does not mutate inputs.
 */
export function mergeDocuments(
  existing: AssetDocument[],
  incoming: AssetDocument[]
): AssetDocument[] {
  const result = existing.map((doc) => ({ ...doc }));
  for (const entry of incoming) {
    const idx = result.findIndex((d) => d.name === entry.name);
    if (idx >= 0) result[idx] = { ...entry };
    else result.push({ ...entry });
  }
  return result;
}
