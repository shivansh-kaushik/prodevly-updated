/** Small display helpers shared by the third-party screens. */

export const short = (text: string, max = 16): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Chart axis labels must be unique (they key the table view), so a second "Asha" becomes "Asha (2)". */
export function uniqueLabels(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const count = (seen.get(n) ?? 0) + 1;
    seen.set(n, count);
    return count === 1 ? n : `${n} (${count})`;
  });
}

export const PATHS = {
  directory: '/admin/third-parties',
  workOrders: '/admin/third-parties/work-orders',
  payouts: '/admin/third-parties/payouts',
} as const;
