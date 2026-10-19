import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A guard on the guards: the rules that must hold for EVERY file in this module, checked by reading
 * the source, so a page or route added later cannot quietly skip them. (Behaviour is tested in the
 * *.int.test.ts files; this catches the file that nobody wrote a test for.)
 */
const root = process.cwd();
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
const files = (dir: string, name: string) => walk(join(root, dir)).filter((f) => f.endsWith(`/${name}`));
const read = (f: string) => readFileSync(f, 'utf8');
const rel = (f: string) => relative(root, f);

describe('every content page is guarded', () => {
  const pages = files('src/app/admin/(workspace)/content', 'page.tsx');

  it('finds the pages', () => {
    expect(pages.map(rel).sort()).toEqual([
      'src/app/admin/(workspace)/content/[type]/[id]/page.tsx',
      'src/app/admin/(workspace)/content/[type]/new/page.tsx',
      'src/app/admin/(workspace)/content/[type]/page.tsx',
      'src/app/admin/(workspace)/content/page.tsx',
      'src/app/admin/(workspace)/content/site/page.tsx',
    ]);
  });

  it.each(pages.map((p) => [rel(p), p]))('%s calls requireAdminPage with the content:edit capability (layouts do not re-run)', (_name, path) => {
    expect(read(path as string)).toMatch(/requireAdminPage\([^;]*?\{\s*capability:\s*'content:edit'\s*\}\)/);
  });

  it.each(pages.filter((p) => p.includes('[type]')).map((p) => [rel(p), p]))('%s signs the person in BEFORE it answers "not found" for a bad address', (_name, path) => {
    const source = read(path as string);
    expect(source.indexOf('requireAdminPage(')).toBeGreaterThan(-1);
    expect(source.indexOf('requireAdminPage(')).toBeLessThan(source.indexOf('notFound()'));
  });

  it('has a loading state and an error boundary for the segment (Next 16 error boundaries receive `retry`)', () => {
    const base = 'src/app/admin/(workspace)/content';
    expect(read(join(root, base, 'loading.tsx'))).toContain('aria-busy');
    const error = read(join(root, base, 'error.tsx'));
    expect(error).toContain("'use client'");
    expect(error).toContain('retry');
    expect(error).not.toMatch(/\{[^}]*\breset\b[^}]*\}\s*:/); // the props are `{ error, retry }`, never `{ error, reset }`
  });
});

describe('every content and media route goes through adminRoute with a capability or an in-service rule', () => {
  const routes = [...files('src/app/api/admin/content', 'route.ts'), ...files('src/app/api/admin/media', 'route.ts')];

  it('finds the routes', () => {
    expect(routes.length).toBe(10); // 8 content (list/create, one, 4 status moves, reorder, site) + 2 media
  });

  it.each(routes.map((r) => [rel(r), r]))('%s uses adminRoute for every handler', (_name, path) => {
    const source = read(path as string);
    const handlers = source.match(/export const (GET|POST|PUT|PATCH|DELETE)\b/g) ?? [];
    expect(handlers.length).toBeGreaterThan(0);
    expect(source.match(/adminRoute\b/g)?.length ?? 0).toBeGreaterThanOrEqual(handlers.length + 1); // import + one use each
    expect(source).not.toMatch(/export (async )?function (GET|POST|PUT|PATCH|DELETE)/); // no handler that bypasses it
  });

  it('puts publish-level actions behind content:publish at the route', () => {
    for (const verb of ['publish', 'unpublish', 'archive', 'restore']) {
      const source = read(join(root, `src/app/api/admin/content/[type]/[id]/${verb}/route.ts`));
      expect(source).toContain("capability: 'content:publish'");
    }
    expect(read(join(root, 'src/app/api/admin/content/site/route.ts'))).toMatch(/PUT = adminRoute<[^>]*>\(\{ capability: 'content:publish'/);
  });

  it('puts editing behind content:edit at the route, and leaves the two purpose-dependent media routes to the service', () => {
    expect(read(join(root, 'src/app/api/admin/content/[type]/route.ts'))).toMatch(/GET = adminRoute<[^>]*>\(\{ capability: 'content:edit' \}/);
    expect(read(join(root, 'src/app/api/admin/content/[type]/[id]/route.ts'))).toContain("capability: 'content:edit'");
    expect(read(join(root, 'src/app/api/admin/content/[type]/reorder/route.ts'))).toContain("capability: 'content:edit'");
    // upload and delete depend on what the file is for, so the SERVICE decides (and the upload route turns away anyone who could never upload)
    expect(read(join(root, 'src/app/api/admin/media/route.ts'))).toContain('UPLOAD_CAPABILITIES');
  });
});

describe('boundaries inside this module', () => {
  it('client components import no service, model, database or auth module (only types)', () => {
    // Everything marked 'use client' here, plus the upload helper they call (it ships to the browser with them).
    const clientFiles = [
      ...walk(join(root, 'src/app/admin/(workspace)/content/_components')).filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts') && read(f).startsWith("'use client'")),
      join(root, 'src/components/admin/media-picker.tsx'),
      join(root, 'src/components/admin/media-upload.ts'),
    ];
    expect(clientFiles.length).toBeGreaterThan(8);
    for (const file of clientFiles) {
      const imports = (read(file).match(/^import (?!type)[^;]*from '([^']+)'/gm) ?? []).join('\n');
      expect(imports, rel(file)).not.toMatch(/@\/(services|models|lib\/db|lib\/auth|lib\/api\/(admin-route|handler|request|response|rate-limit))/);
    }
  });
});
