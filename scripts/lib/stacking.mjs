/**
 * Finds CSS that makes a `<main>` or `<section>` create a stacking context.
 *
 * The public page layers, back to front, are the section fields (z 0), the one fixed
 * canvas (z 10), the copy (z 20) and the nav (z 40) (docs/plan/engineering.html section
 * 3). That only works while no section traps its children's z-index in a context of
 * its own, so a section must not carry a transform, filter, opacity below 1, isolation,
 * contain, will-change, perspective, mix-blend-mode or a z-index.
 *
 * It reads the real syntax tree: every string that can reach a section's `className`
 * (literals, template parts, both sides of a ternary) and every key of its `style`.
 */
import ts from 'typescript';

const TAGS = new Set(['main', 'section']);

/** A Tailwind class, with variants (`pd-split:`, `hover:`) and `!` stripped. */
const base = (token) => token.replace(/^.*:/, '').replace(/^!/, '');

const FORBIDDEN_CLASS = [
  /^(transform|transform-gpu|transform-cpu|isolate|filter|will-change-.+|contain-.+|contain|perspective(-.+)?|mix-blend-.+)$/,
  /^-?(translate|scale|rotate|skew)(-.+)?$/,
  /^(blur|backdrop-.+|brightness|contrast|grayscale|saturate|sepia|hue-rotate|invert|drop-shadow)(-.+)?$/,
  /^opacity-(?!100$).+$/,
  /^-?z-.+$/,
];

const FORBIDDEN_STYLE = new Set(['transform', 'filter', 'backdropFilter', 'opacity', 'isolation', 'contain', 'willChange', 'zIndex', 'perspective', 'mixBlendMode', 'translate', 'scale', 'rotate']);

function collect(node, out) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
  else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) out.push(node.text);
  node.forEachChild((child) => collect(child, out));
}

export function findStackingContexts(source, file = 'file.tsx') {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  const line = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  const visit = (node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && TAGS.has(node.tagName.getText(sf))) {
      const tag = node.tagName.getText(sf);
      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr) || !attr.initializer) continue;
        const name = attr.name.getText(sf);
        if (name === 'className') {
          const parts = [];
          collect(attr.initializer, parts);
          for (const token of parts.join(' ').split(/\s+/).filter(Boolean)) {
            if (FORBIDDEN_CLASS.some((re) => re.test(base(token)))) found.push({ line: line(attr), element: tag, what: `class "${token}"` });
          }
        } else if (name === 'style') {
          const walk = (n) => {
            if (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) {
              const key = n.name.getText(sf).replace(/['"]/g, '');
              if (FORBIDDEN_STYLE.has(key)) found.push({ line: line(n), element: tag, what: `style "${key}"` });
            }
            n.forEachChild(walk);
          };
          walk(attr.initializer);
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(sf);
  return found;
}

