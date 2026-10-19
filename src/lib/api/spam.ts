/**
 * Spam heuristics for the public contact form. Deliberately small and explainable: every signal
 * is a rule a person can read, carries points, and says what it found, so an admin looking at a
 * held enquiry can see WHY it was held. There is no model and no score that cannot be explained.
 *
 * A submission is spam at SPAM_THRESHOLD points or more. One soft signal alone (a shouted message,
 * two links) never trips it; two soft signals, or one hard signal, do. A held enquiry is stored with
 * status "spam" rather than thrown away, so a false positive can be rescued from the admin.
 */

export type SpamCode = 'links' | 'link_in_name' | 'repeated_characters' | 'shouting' | 'junk_phrase' | 'html_markup';

export interface SpamSignal {
  code: SpamCode;
  points: number;
  /** A short phrase for the audit trail and the admin: "3 links in the message". */
  detail: string;
}

export interface SpamVerdict {
  spam: boolean;
  score: number;
  signals: SpamSignal[];
}

export interface SpamInput {
  name: string;
  message: string;
  company?: string;
}

export const SPAM_THRESHOLD = 3;

/** Links and bare domains of the kinds spammers use. An email address is not a link. */
const SCHEME_URL = /(?:https?:\/\/|www\.)[^\s<>"')]+/gi;
const BARE_DOMAIN =
  /(?<![@\w.-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|io|co|in|info|biz|xyz|top|online|site|shop|click|link|ru|cn)\b(?![@\w-])/gi;

export function countLinks(text: string): number {
  const schemed = text.match(SCHEME_URL)?.length ?? 0;
  // Remove the scheme URLs first so "http://x.com" is one link, not two.
  const bare = text.replace(SCHEME_URL, ' ').match(BARE_DOMAIN)?.length ?? 0;
  return schemed + bare;
}

/** Phrases that belong to pharma, gambling, adult, SEO-for-hire and money-making spam. A web studio's real visitors do not write these. */
const JUNK_PHRASES: readonly RegExp[] = [
  /\b(?:viagra|cialis|levitra)\b/i,
  /\b(?:online\s+casino|casino\s+bonus|slot\s+gacor|betting\s+tips)\b/i,
  /\b(?:payday|instant)\s+loans?\b/i,
  /\b(?:buy|cheap)\s+(?:backlinks|followers|likes)\b/i,
  /\b(?:rank|ranking)\s+(?:#?1|first\s+page)\s+(?:on\s+)?google\b/i,
  /\bguaranteed\s+(?:first\s+page|top\s+ranking|traffic)\b/i,
  /\b(?:crypto|bitcoin)\s+(?:giveaway|doubler|investment\s+opportunity)\b/i,
  /\b(?:adult\s+dating|sex\s+chat|escort\s+service)\b/i,
  /\b(?:make|earn)\s+\$?\d[\d,]*\s*(?:per|a|\/)\s*(?:day|hour|week)\s+(?:from\s+home|online)\b/i,
  /\bwork\s+from\s+home\s+(?:opportunity|and\s+earn)\b/i,
  /\bclick\s+here\s+to\s+(?:claim|win|earn)\b/i,
];

/** Markup spam bots post into a plain-text field: anchor tags, BBCode links, scripts, frames. */
const HTML_MARKUP = /<\s*a\s[^>]*href\s*=|\[url(?:=|\])|<\s*script\b|<\s*iframe\b/i;

/** Ten or more of the same non-space character in a row: "aaaaaaaaaa", "!!!!!!!!!!". */
const REPEATED_RUN = /([^\s])\1{9,}/u;

/** Uppercase share of a message. Counts only letters that HAVE a case, so Devanagari or Chinese text never counts as shouting. */
export function uppercaseShare(text: string): { share: number; letters: number } {
  const upper = text.match(/\p{Lu}/gu)?.length ?? 0;
  const lower = text.match(/\p{Ll}/gu)?.length ?? 0;
  const letters = upper + lower;
  return { share: letters === 0 ? 0 : upper / letters, letters };
}

export function assessSpam(input: SpamInput): SpamVerdict {
  const signals: SpamSignal[] = [];
  const add = (code: SpamCode, points: number, detail: string) => signals.push({ code, points, detail });

  const everything = [input.name, input.company ?? '', input.message].join('\n');

  const nameLinks = countLinks(input.name);
  if (nameLinks > 0) add('link_in_name', 3, 'a link in the name field');

  const messageLinks = countLinks(`${input.message}\n${input.company ?? ''}`);
  if (messageLinks >= 3) add('links', 3, `${messageLinks} links in the message`);
  else if (messageLinks === 2) add('links', 1, '2 links in the message');

  if (REPEATED_RUN.test(everything)) add('repeated_characters', 2, 'the same character repeated ten or more times');

  const { share, letters } = uppercaseShare(input.message);
  if (letters >= 20 && share >= 0.7) add('shouting', 2, 'a message written mostly in capitals');

  if (JUNK_PHRASES.some((re) => re.test(everything))) add('junk_phrase', 3, 'a phrase common in junk mail');

  if (HTML_MARKUP.test(everything)) add('html_markup', 3, 'link or script markup in a plain-text field');

  const score = signals.reduce((sum, s) => sum + s.points, 0);
  return { spam: score >= SPAM_THRESHOLD, score, signals };
}

/** "3 links in the message; the same character repeated ten or more times", for history notes and the audit log. */
export function describeSpam(verdict: SpamVerdict): string {
  return verdict.signals.map((s) => s.detail).join('; ');
}
