/**
 * Import-boundary rules, checked over the real import GRAPH, not one file at a time.
 *
 * 1. Client components (`'use client'`) must not reach the database, models, services,
 *    secrets-handling code or server-only packages, directly OR through any chain of
 *    imports. A client file ships to the browser along with everything it pulls in.
 * 2. Admin code must not reach three.js, GSAP, Lenis or the 3D/site folders, so the admin
 *    bundles carry zero 3D or scroll code.
 * 3. The 3D code must not reach the database, models, auth or services, so the scene stays
 *    a pure view of the data it is handed.
 *
 * Type-only imports (`import type`, `export type`, `import { type X }`) are erased at build
 * time and are NOT edges. Specifiers are resolved to repo paths (`@/x`, `./x`, `../x`) and
 * matched on the path, so a relative import cannot dodge a rule written for `@/`.
 */
import ts from 'typescript';
import { posix } from 'node:path';

/** Server-only FILES (paths). Pure helpers in the same folders (password-policy, safe-next-path, errors) stay importable. */
const SERVER_ONLY_PATHS = [
  /^src\/(?:models|services)\//,
  /^src\/lib\/db\//,
  /^src\/lib\/auth\/(?:guard|authenticate|token|password|page-guard|common-passwords)\.tsx?$/,
  /^src\/lib\/api\/(?:admin-route|rate-limit|handler|client-ip|response|request)\.tsx?$/,
  /^src\/proxy\.tsx?$/,
];
const SERVER_ONLY_PACKAGES = /^(?:mongoose|mongodb|bcryptjs|bcrypt|jose|server-only)(?:\/|$)/;

const SCENE_PATHS = [/^src\/(?:three|components\/site)\//];
const SCENE_PACKAGES = /^(?:three|gsap|lenis|maath|postprocessing)(?:\/|$)|^@(?:react-three|gsap|pmndrs)\//;

const matchesAny = (list, path) => list.some((re) => re.test(path));

export const RULES = [
  {
    name: 'client components must not import server-only modules',
    appliesTo: ({ isClient }) => isClient,
    forbiddenPath: (p) => matchesAny(SERVER_ONLY_PATHS, p),
    forbiddenPackage: (s) => SERVER_ONLY_PACKAGES.test(s),
  },
  {
    name: 'admin code must not import 3D, scroll or site modules',
    appliesTo: ({ path }) => /^src\/(?:app\/admin|components\/admin)\//.test(path),
    forbiddenPath: (p) => matchesAny(SCENE_PATHS, p),
    forbiddenPackage: (s) => SCENE_PACKAGES.test(s),
  },
  {
    name: '3D code must not import server-only modules',
    appliesTo: ({ path }) => /^src\/three\//.test(path),
    forbiddenPath: (p) => matchesAny(SERVER_ONLY_PATHS, p),
    forbiddenPackage: (s) => SERVER_ONLY_PACKAGES.test(s),
  },
];

const kindOf = (name) => (/\.tsx$/.test(name) ? ts.ScriptKind.TSX : /\.m?js$/.test(name) ? ts.ScriptKind.JS : ts.ScriptKind.TS);

/**
 * Every module specifier a file imports, with whether the import is type-only (erased).
 * @returns {{ specifier: string, typeOnly: boolean }[]}
 */
export function importsOf(source, fileName = 'file.ts') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kindOf(fileName));
  const out = [];
  const add = (specifier, typeOnly) => out.push({ specifier, typeOnly });

  (function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      let typeOnly = false;
      if (clause) {
        const named = clause.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : null;
        typeOnly =
          clause.isTypeOnly ||
          (!clause.name && named !== null && named.length > 0 && named.every((e) => e.isTypeOnly));
      }
      add(node.moduleSpecifier.text, typeOnly);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const typeOnly =
        node.isTypeOnly ||
        (node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every((e) => e.isTypeOnly));
      add(node.moduleSpecifier.text, Boolean(typeOnly));
    } else if (ts.isCallExpression(node)) {
      const arg = node.arguments[0];
      const callee = node.expression;
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      if ((isDynamicImport || isRequire) && arg && ts.isStringLiteralLike(arg)) add(arg.text, false);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) {
      add(node.moduleReference.expression.text, node.isTypeOnly);
    }
    ts.forEachChild(node, visit);
  })(sf);
  return out;
}

/** True when the file's first statement is a 'use client' directive. */
export function isClientFile(source) {
  const stripped = source.replace(/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, '');
  return /^(['"])use client\1/.test(stripped);
}

const EXTENSIONS = ['', '.ts', '.tsx', '.mts', '.mjs', '.js', '/index.ts', '/index.tsx', '/index.mjs', '/index.js'];

/** Resolves a specifier to a repo path present in `files`, or null when it is a package or unknown. */
export function resolveImport(from, specifier, files) {
  let base;
  if (specifier.startsWith('@/')) base = `src/${specifier.slice(2)}`;
  else if (specifier.startsWith('.')) base = posix.normalize(posix.join(posix.dirname(from), specifier));
  else return null;
  for (const ext of EXTENSIONS) if (files.has(base + ext)) return base + ext;
  return null;
}

const norm = (p) => p.replaceAll('\\', '/');

/**
 * Checks a whole project. `files` maps repo-relative paths (forward slashes) to source.
 * Returns `[{ file, rule, specifier, chain }]`: `chain` is the import path from the
 * rule's start file to the offending module.
 */
export function checkProject(filesIn) {
  const files = new Map([...filesIn].map(([p, s]) => [norm(p), s]));
  const graph = new Map(); // path -> { resolved: string[], packages: string[] }
  for (const [path, source] of files) {
    const resolved = [];
    const packages = [];
    for (const { specifier, typeOnly } of importsOf(source, path)) {
      if (typeOnly) continue;
      const target = resolveImport(path, specifier, files);
      if (target) resolved.push({ target, specifier });
      else if (!specifier.startsWith('.') && !specifier.startsWith('@/')) packages.push(specifier);
    }
    graph.set(path, { resolved, packages });
  }

  const violations = [];
  for (const [start, source] of files) {
    const ctx = { path: start, isClient: isClientFile(source) };
    for (const rule of RULES) {
      if (!rule.appliesTo(ctx)) continue;
      // Breadth-first, so the reported chain is the shortest one.
      const seen = new Set([start]);
      const queue = [[start]];
      while (queue.length > 0) {
        const chain = queue.shift();
        const node = chain[chain.length - 1];
        const edges = graph.get(node);
        if (!edges) continue;
        for (const pkg of edges.packages) {
          if (rule.forbiddenPackage(pkg)) violations.push({ file: start, rule: rule.name, specifier: pkg, chain: [...chain, pkg] });
        }
        for (const { target } of edges.resolved) {
          if (rule.forbiddenPath(target)) {
            violations.push({ file: start, rule: rule.name, specifier: target, chain: [...chain, target] });
            continue; // do not walk beyond an offender: one report per route into it
          }
          if (!seen.has(target)) {
            seen.add(target);
            queue.push([...chain, target]);
          }
        }
      }
    }
  }
  return violations;
}

/** One file against the rules, direct imports only (resolution needs a file set; none given). */
export function checkFile(path, source) {
  return checkProject(new Map([[path, source]])).map(({ rule, specifier }) => ({ rule, specifier }));
}
