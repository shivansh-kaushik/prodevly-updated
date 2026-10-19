/**
 * Links built from visitor-supplied contact details. The email and phone on an enquiry came off
 * a public form, so they are never dropped into an href as they are: an address is only linked
 * when it has the plain shape of one, and every part is encoded; a phone number is reduced to
 * digits and an optional leading plus. Anything else is shown as text, with no link.
 *
 * What this rules out: `mailto:` header injection (`a@b.com?cc=x&body=y`), a `javascript:` or
 * `data:` scheme smuggled in through a value that merely looks like contact details, and
 * whitespace or control characters that change how a link is parsed.
 */

// One "@", and none of the characters that start mailto headers, end the address early or change parsing.
const BAD = String.raw`\s@<>"'\x60,;:()\[\]\\%?&#=`;
const SAFE_EMAIL = new RegExp(`^[^${BAD}]+@[^${BAD}/]+\\.[^${BAD}/]+$`);

export function mailtoHref(email: string | null | undefined): string | null {
  const value = email?.trim();
  if (!value || value.length > 160 || !SAFE_EMAIL.test(value)) return null;
  const [local = '', domain = ''] = value.split('@');
  return `mailto:${encodeURIComponent(local)}@${encodeURIComponent(domain)}`;
}

export function telHref(phone: string | null | undefined): string | null {
  const value = phone?.trim();
  if (!value || !/^[+()\d .\-/]{5,40}$/.test(value)) return null;
  const digits = value.replace(/\D/g, '');
  // E.164 allows at most 15 digits; fewer than 6 is not a number anyone can ring.
  if (digits.length < 6 || digits.length > 15) return null;
  return `tel:${value.startsWith('+') ? '+' : ''}${digits}`;
}
