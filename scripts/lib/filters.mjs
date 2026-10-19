/**
 * Finds Mongoose query operators that are not wrapped in `mongoose.trusted()`.
 *
 * `sanitizeFilter` is on globally (src/lib/db/mongoose.ts). It rewrites any
 * un-trusted operator object inside a FILTER into `{ $eq: ... }`, so
 * `find({ status: { $ne: 'x' } })` becomes a CastError or silently wrong results.
 * That is easy to miss in review and impossible to miss here.
 *
 * This reads the real syntax tree (TypeScript's parser) instead of grepping lines, so it
 * is exact about WHAT is inspected and what is not:
 *
 * - Inspected: the FILTER argument of Mongoose query methods (`find`, `findOne`,
 *   `updateOne`/`updateMany` first argument, `deleteOne`, `countDocuments`, `exists`,
 *   `distinct` second argument, `.where({})`, `.or([])` ...).
 * - Skipped: update documents (`$set`, `$inc`...), aggregation pipelines, index
 *   definitions, comments and strings.
 * - A `mongoose.trusted(...)` call exempts exactly its own span, across lines.
 * - Top-level `$or` / `$and` / `$nor` are logical groups of filters: Mongoose recurses
 *   into them, so their members are checked, not the group itself.
 * - Top-level `$text`, `$where`, `$expr` have no field to hang a wrapper on, so they
 *   must be wrapped as a whole (`$text: mongoose.trusted({ $search })`).
 * - A filter held in a same-file `const` is followed one step, including later assignments such
 *   as `query.at = { $lt: d }` and `query['x'] = { $in: ids }`.
 * - Spreads are followed: `...(cond ? { a: { $ne: 1 } } : {})` and `...(cond && { a: ... })`.
 */
import ts from 'typescript';

/** Mongoose methods whose FIRST argument is a filter. */
const FILTER_FIRST = new Set([
  'find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace', 'findOneAndRemove',
  'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany', 'countDocuments', 'count', 'exists', 'where',
]);
/** `distinct(field, filter)`: the filter is the SECOND argument. */
const FILTER_SECOND = new Set(['distinct']);
/** Chained builders that take an ARRAY of filters. */
const FILTER_ARRAY = new Set(['or', 'and', 'nor']);

const LOGICAL = new Set(['$or', '$and', '$nor']);

const propName = (prop) => {
  const n = prop.name;
  if (!n) return null;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  return null;
};

const isTrustedCall = (node) =>
  ts.isCallExpression(node) &&
  ((ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'trusted') ||
    (ts.isIdentifier(node.expression) && node.expression.text === 'trusted'));

const unwrap = (node) => {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression?.(node) || ts.isNonNullExpression(node))) {
    node = node.expression;
  }
  return node;
};

/**
 * @param {string} source
 * @param {string} [fileName]
 * @returns {{ line: number, operator: string, text: string }[]}
 */
export function findUntrustedOperators(source, fileName = 'file.ts') {
  const kind = /\.tsx$/.test(fileName) ? ts.ScriptKind.TSX : /\.m?js$/.test(fileName) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const lines = source.split('\n');
  const findings = [];
  const seen = new Set();

  // Same-file `const x = { ... }` lookups, so `find(filter)` can be followed one step.
  const consts = new Map();
  /** `name.prop = value` and `name['prop'] = value`, by variable name. */
  const assigned = new Map();
  (function collect(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) consts.set(node.name.text, node.initializer);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = node.left;
      const target = ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left) ? left.expression : null;
      if (target && ts.isIdentifier(target)) {
        const list = assigned.get(target.text) ?? [];
        list.push({ name: ts.isPropertyAccessExpression(left) ? left.name.text : ts.isElementAccessExpression(left) && ts.isStringLiteralLike(left.argumentExpression) ? left.argumentExpression.text : null, value: node.right });
        assigned.set(target.text, list);
      }
    }
    ts.forEachChild(node, collect);
  })(sf);

  const report = (node, operator) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    const key = `${line}:${operator}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ line: line + 1, operator, text: (lines[line] ?? '').trim().slice(0, 110) });
  };

  /** Checks one value sitting under a field name: `{ field: <value> }`. */
  const checkFieldValue = (value) => {
    const v = unwrap(value);
    if (!v || isTrustedCall(v)) return;
    if (ts.isObjectLiteralExpression(v)) {
      for (const p of v.properties) {
        const name = ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isMethodDeclaration(p) ? propName(p) : null;
        if (name?.startsWith('$')) report(p, name);
      }
    }
  };

  const checkFilter = (node, depth = 0) => {
    const n = unwrap(node);
    if (!n || depth > 4) return;
    if (ts.isIdentifier(n)) {
      const target = consts.get(n.text);
      if (target) checkFilter(target, depth + 1);
      for (const a of assigned.get(n.text) ?? []) {
        if (a.name === null) continue;
        if (LOGICAL.has(a.name)) {
          const arr = unwrap(a.value);
          if (arr && ts.isArrayLiteralExpression(arr)) for (const el of arr.elements) checkFilter(el, depth + 1);
        } else if (a.name.startsWith('$')) {
          if (!isTrustedCall(unwrap(a.value))) report(a.value, a.name);
        } else checkFieldValue(a.value);
      }
      return;
    }
    // `cond ? {..} : {..}` and `cond && {..}`: both arms are part of the filter.
    if (ts.isConditionalExpression(n)) {
      checkFilter(n.whenTrue, depth + 1);
      checkFilter(n.whenFalse, depth + 1);
      return;
    }
    if (ts.isBinaryExpression(n) && (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || n.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
      checkFilter(n.right, depth + 1);
      return;
    }
    if (!ts.isObjectLiteralExpression(n)) return;
    for (const p of n.properties) {
      if (ts.isSpreadAssignment(p)) {
        checkFilter(p.expression, depth + 1);
        continue;
      }
      if (!ts.isPropertyAssignment(p)) continue;
      const name = propName(p);
      if (name === null) continue;
      if (LOGICAL.has(name)) {
        const arr = unwrap(p.initializer);
        if (arr && ts.isArrayLiteralExpression(arr)) for (const el of arr.elements) checkFilter(el, depth + 1);
      } else if (name.startsWith('$')) {
        if (!isTrustedCall(unwrap(p.initializer))) report(p, name);
      } else {
        checkFieldValue(p.initializer);
      }
    }
  };

  (function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (FILTER_FIRST.has(method) && node.arguments[0]) checkFilter(node.arguments[0]);
      else if (FILTER_SECOND.has(method) && node.arguments[1]) checkFilter(node.arguments[1]);
      else if (FILTER_ARRAY.has(method) && node.arguments[0]) {
        const arr = unwrap(node.arguments[0]);
        if (arr && ts.isArrayLiteralExpression(arr)) for (const el of arr.elements) checkFilter(el);
      }
    }
    ts.forEachChild(node, visit);
  })(sf);

  return findings.sort((a, b) => a.line - b.line);
}
