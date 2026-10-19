/**
 * Detects invented marketing claims in the strings of a source file.
 *
 * The public site must never show a number or claim that no record backs
 * (client counts, ratings, years in business, awards, testimonials). Real numbers
 * only appear when the team typed them into a database record or they are
 * computed from records at render time, so none belong in static copy.
 *
 * Only string literals are scanned, so geometry maths in code never trips it.
 * A line carrying `// copy-ok: <reason>` is exempt, and every exemption is listed.
 */

const NUMBER_PATTERNS = [
  { name: 'number followed by +', re: /\d\s*\+/ },
  { name: 'rating out of 5 or 10', re: /\d+(?:\.\d+)?\s*\/\s*(?:5|10)\b/ },
  { name: 'percentage', re: /\d\s*%/ },
  {
    name: 'count of clients, projects, years or similar',
    re: /\b\d+[kKmM]?\s+(?:clients?|projects?|years?|countries|reviews?|users?|apps?|developers?|customers?|companies|teams?)\b/i,
  },
];

// Word boundaries matter: "rated" must not flag "integrated", nor "award" flag "forward".
const PHRASE_PATTERNS = [
  { name: 'trusted by', re: /\btrusted by\b/i },
  { name: 'award', re: /\baward(?:s|ed|-winning)?\b/i },
  { name: 'rated', re: /\b(?:top|highly|five-star|5-star)[- ]rated\b|\brated\b/i },
  { name: 'testimonial', re: /\btestimonials?\b/i },
  { name: 'satisfaction', re: /\bsatisfaction\b/i },
  { name: 'happy clients', re: /\bhappy (?:clients|customers)\b/i },
  { name: 'years of experience', re: /\byears (?:of experience|in business)\b/i },
];

/**
 * Shader source and CSS values are full of numbers and operators ("1.0 + x", "50%") that
 * are not marketing claims. A string is skipped when it is GLSL, and the number rules only
 * run on strings that contain real words once CSS units and functions are removed.
 */
const GLSL_RE = /\bvoid\s+main\b|\b(?:uniform|varying|attribute)\s+(?:lowp|mediump|highp\s+)?\w|\bgl_(?:Position|FragColor|FragCoord)\b|\bprecision\s+(?:low|medium|high)p\b|\b(?:vec|mat)[234]\b/;
const CSS_NOISE_RE = /\b(?:calc|translate[XYZ3d]*|scale[XYZ3d]*|rotate[XYZ3d]*|rgba?|hsla?|var|clamp|min|max)\b|(?<=[\d.])(?:px|rem|em|vh|vw|vmin|vmax|deg|rad|ms|fr|ch|s)\b/gi;
const hasRealWord = (text) => /[A-Za-z]{3,}/.test(text.replace(CSS_NOISE_RE, ' '));

const STRING_RE = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

/** Returns the text of every string literal with its 1-based line number. */
export function extractStrings(source) {
  const out = [];
  for (const m of source.matchAll(STRING_RE)) {
    const line = source.slice(0, m.index).split('\n').length;
    out.push({ text: m[0].slice(1, -1), line });
  }
  return out;
}

/**
 * Scans a file's source. Returns `{ violations, exemptions }`, each an array of
 * `{ line, reason, text }`.
 */
export function scanSource(source) {
  const lines = source.split('\n');
  const violations = [];
  const exemptions = [];

  for (const { text, line } of extractStrings(source)) {
    if (GLSL_RE.test(text)) continue;
    const hits = [];
    if (hasRealWord(text)) for (const { name, re } of NUMBER_PATTERNS) if (re.test(text)) hits.push(name);
    for (const { name, re } of PHRASE_PATTERNS) if (re.test(text)) hits.push(`phrase "${name}"`);
    if (hits.length === 0) continue;

    const raw = lines[line - 1] ?? '';
    const ok = raw.match(/\/\/\s*copy-ok:\s*(.+)$/);
    const entry = { line, reason: hits.join(', '), text: text.slice(0, 80) };
    if (ok) exemptions.push({ ...entry, reason: `${entry.reason} (copy-ok: ${ok[1].trim()})` });
    else violations.push(entry);
  }
  return { violations, exemptions };
}
