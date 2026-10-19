/** Countries offered as suggestions on the client form (any 2-letter ISO code is accepted). */
export const COMMON_COUNTRIES: ReadonlyArray<readonly [string, string]> = [
  ['IN', 'India'], ['US', 'United States'], ['GB', 'United Kingdom'], ['AE', 'United Arab Emirates'], ['SG', 'Singapore'],
  ['AU', 'Australia'], ['CA', 'Canada'], ['DE', 'Germany'], ['FR', 'France'], ['NL', 'Netherlands'], ['IE', 'Ireland'],
  ['SE', 'Sweden'], ['CH', 'Switzerland'], ['ES', 'Spain'], ['IT', 'Italy'], ['NZ', 'New Zealand'], ['SA', 'Saudi Arabia'],
  ['QA', 'Qatar'], ['KW', 'Kuwait'], ['BH', 'Bahrain'], ['OM', 'Oman'], ['MY', 'Malaysia'], ['ID', 'Indonesia'],
  ['TH', 'Thailand'], ['PH', 'Philippines'], ['JP', 'Japan'], ['KR', 'South Korea'], ['HK', 'Hong Kong'],
  ['ZA', 'South Africa'], ['NG', 'Nigeria'], ['KE', 'Kenya'], ['EG', 'Egypt'], ['BR', 'Brazil'], ['MX', 'Mexico'],
  ['BD', 'Bangladesh'], ['LK', 'Sri Lanka'], ['NP', 'Nepal'], ['PK', 'Pakistan'],
];

const names = new Intl.DisplayNames(['en'], { type: 'region' });

/** "IN" to "India"; an unknown code is shown as typed. */
export function countryName(code: string | null | undefined): string {
  if (!code) return '';
  try {
    return names.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}
