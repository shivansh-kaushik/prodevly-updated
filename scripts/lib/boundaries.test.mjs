import { describe, expect, it } from 'vitest';
import { checkFile, checkProject, importsOf, isClientFile, resolveImport } from './boundaries.mjs';

const specs = (src, name) => importsOf(src, name).map((i) => i.specifier);
const project = (files) => checkProject(new Map(Object.entries(files)));
const offenders = (files) => project(files).map((v) => v.specifier);

describe('importsOf', () => {
  it('finds static, side-effect, dynamic, require, re-export and export-star imports, on one line or many', () => {
    const src = `
      import a from 'one';
      import { b } from "two";
      import 'side-effect';
      export { d } from 'three';
      export * from 'star';
      const lazy = () => import('lenis');
      const r = require('cjs');
      import {
        multi,
        line,
      } from 'multi';
    `;
    expect(specs(src)).toEqual(['one', 'two', 'side-effect', 'three', 'star', 'lenis', 'cjs', 'multi']);
  });

  it('marks type-only imports and exports so they are not edges', () => {
    const src = `
      import type { A } from 'a';
      import { type B, type C } from 'b';
      import { D, type E } from 'd';
      export type { F } from 'f';
      import type G from 'g';
    `;
    const found = Object.fromEntries(importsOf(src).map((i) => [i.specifier, i.typeOnly]));
    expect(found).toEqual({ a: true, b: true, d: false, f: true, g: true });
  });

  it('ignores imports that only appear in comments and strings', () => {
    expect(specs(`// import x from 'commented'\nconst s = "import y from 'string'";`)).toEqual([]);
  });
});

describe('isClientFile', () => {
  it('sees the directive after comments and blank lines', () => {
    expect(isClientFile(`'use client';\nimport x from 'y';`)).toBe(true);
    expect(isClientFile(`// note\n/* block */\n"use client"\n`)).toBe(true);
  });
  it('does not see it anywhere else', () => {
    expect(isClientFile(`import x from 'y';\n'use client';`)).toBe(false);
    expect(isClientFile(`export const a = 'use client';`)).toBe(false);
  });
});

describe('resolveImport', () => {
  const files = new Set(['src/lib/a.ts', 'src/lib/b/index.ts', 'src/components/x.tsx']);
  it('resolves alias, relative and index imports, and leaves packages alone', () => {
    expect(resolveImport('src/components/x.tsx', '@/lib/a', files)).toBe('src/lib/a.ts');
    expect(resolveImport('src/components/x.tsx', '../lib/a', files)).toBe('src/lib/a.ts');
    expect(resolveImport('src/lib/a.ts', './b', files)).toBe('src/lib/b/index.ts');
    expect(resolveImport('src/lib/a.ts', 'react', files)).toBeNull();
    expect(resolveImport('src/lib/a.ts', './missing', files)).toBeNull();
  });
});

describe('client components', () => {
  const server = { 'src/models/admin.ts': `export const Admin = 1;`, 'src/models/index.ts': `export * from './admin';` };

  it('may not import models, db, auth or bcrypt directly', () => {
    const v = offenders({
      ...server,
      'src/components/x.tsx': `'use client';\nimport { Admin } from '@/models/admin';\nimport bcrypt from 'bcryptjs';`,
    });
    expect(v.sort()).toEqual(['bcryptjs', 'src/models/admin.ts']);
  });

  it('may not dodge the rule with a RELATIVE import', () => {
    expect(offenders({ ...server, 'src/components/x.tsx': `'use client';\nimport { Admin } from '../models/admin';` })).toEqual(['src/models/admin.ts']);
  });

  it('may not reach server code through a chain of imports, and the chain is reported', () => {
    const v = project({
      ...server,
      'src/lib/helper.ts': `import { Admin } from '@/models';\nexport const h = Admin;`,
      'src/components/x.tsx': `'use client';\nimport { h } from '@/lib/helper';`,
    });
    expect(v).toHaveLength(1);
    expect(v[0].chain).toEqual(['src/components/x.tsx', 'src/lib/helper.ts', 'src/models/index.ts']);
  });

  it('may not reach a server PACKAGE through a chain', () => {
    const v = project({
      'src/lib/jwt.ts': `import { SignJWT } from 'jose';`,
      'src/components/x.tsx': `'use client';\nimport '@/lib/jwt';`,
    });
    expect(v.map((x) => x.specifier)).toEqual(['jose']);
  });

  it('may not import the server-only files of lib/auth and lib/api', () => {
    for (const path of ['src/lib/auth/guard.ts', 'src/lib/auth/token.ts', 'src/lib/auth/password.ts', 'src/lib/api/admin-route.ts', 'src/lib/api/rate-limit.ts', 'src/lib/api/handler.ts', 'src/lib/api/client-ip.ts']) {
      const spec = `@/${path.replace(/^src\//, '').replace(/\.ts$/, '')}`;
      expect(offenders({ [path]: `export const x = 1;`, 'src/components/x.tsx': `'use client';\nimport { x } from '${spec}';` }), path).toEqual([path]);
    }
  });

  it('MAY import the pure helpers that live beside them', () => {
    expect(
      offenders({
        'src/lib/auth/password-policy.ts': `export const p = 1;`,
        'src/lib/auth/safe-next-path.ts': `export const s = 1;`,
        'src/lib/api/errors.ts': `export const e = 1;`,
        'src/config/capabilities.ts': `export const c = 1;`,
        'src/components/x.tsx': `'use client';\nimport { p } from '@/lib/auth/password-policy';\nimport { s } from '@/lib/auth/safe-next-path';\nimport { e } from '@/lib/api/errors';\nimport { c } from '@/config/capabilities';`,
      }),
    ).toEqual([]);
  });

  it('may import server code as a TYPE: types are erased', () => {
    expect(
      offenders({
        ...server,
        'src/components/x.tsx': `'use client';\nimport type { Admin } from '@/models/admin';\nimport { type A } from '@/models';\nexport type { Admin } from '@/models/admin';`,
      }),
    ).toEqual([]);
  });

  it('sees require() and export * too', () => {
    expect(offenders({ ...server, 'src/components/x.tsx': `'use client';\nexport * from '@/models/admin';` })).toEqual(['src/models/admin.ts']);
    expect(offenders({ 'src/components/x.tsx': `'use client';\nconst b = require('bcryptjs');` })).toEqual(['bcryptjs']);
  });

  it('a server component may import them freely', () => {
    expect(offenders({ ...server, 'src/app/admin/page.tsx': `import { Admin } from '@/models/admin';` })).toEqual([]);
  });
});

describe('admin code', () => {
  it('may not import three, gsap, lenis or the 3D and site folders, directly or through a chain', () => {
    const v = offenders({
      'src/three/stage.tsx': `export const Stage = 1;`,
      'src/components/site/hero.tsx': `export const Hero = 1;`,
      'src/lib/shared.ts': `import { Stage } from '@/three/stage';\nexport const S = Stage;`,
      'src/app/admin/(workspace)/page.tsx': `import { Canvas } from '@react-three/fiber';\nimport gsap from 'gsap';\nimport { Hero } from '@/components/site/hero';\nimport { S } from '@/lib/shared';`,
      'src/components/admin/chart.tsx': `import 'lenis';`,
    });
    expect(v.sort()).toEqual(['@react-three/fiber', 'gsap', 'lenis', 'src/components/site/hero.tsx', 'src/three/stage.tsx']);
  });

  it('the public site may import 3D modules', () => {
    expect(offenders({ 'src/components/site/stage-mount.tsx': `import { Canvas } from '@react-three/fiber';` })).toEqual([]);
  });
});

describe('3D code', () => {
  it('may not reach the database, directly or relatively', () => {
    expect(offenders({ 'src/lib/db/mongoose.ts': `export const m = 1;`, 'src/three/stage.tsx': `import { m } from '../lib/db/mongoose';` })).toEqual(['src/lib/db/mongoose.ts']);
  });
});

describe('plumbing', () => {
  it('handles Windows-style paths', () => {
    expect(checkFile('src\\app\\admin\\page.tsx', `import 'three';`)).toHaveLength(1);
  });
  it('reports nothing for a clean project, and survives import cycles', () => {
    expect(project({ 'src/a.ts': `import './b';`, 'src/b.ts': `import './a';` })).toEqual([]);
  });
});
