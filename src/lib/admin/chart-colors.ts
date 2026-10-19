/** Series colours: the same hues as the tokens in admin.css (SVG needs real values, not var()). Ordered so neighbours differ in lightness too. */
export const CHART_COLORS = {
  blue: '#2d4b8e',
  credit: '#1d6b49',
  amber: '#a3680b',
  rubric: '#b3301d',
  violet: '#6a4a98',
  slate: '#5d6679',
} as const;

export const SERIES_PALETTE = [CHART_COLORS.blue, CHART_COLORS.credit, CHART_COLORS.amber, CHART_COLORS.rubric, CHART_COLORS.violet, CHART_COLORS.slate];
