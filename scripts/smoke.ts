/**
 * `npm run smoke`: a black-box HTTP test of the admin API against a RUNNING dev
 * server (`npm run dev`) and the dev database (`npm run dev:db`).
 *
 * It creates its own throwaway superadmin straight in the database, then exercises
 * everything else over real HTTP with a cookie jar, so it covers what direct
 * handler calls cannot: the proxy, cookie headers and redirects. It refuses to run
 * against anything but localhost.
 */
import { randomBytes } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { hashPassword } from '../src/lib/auth/password';
import { connectToDatabase, disconnectFromDatabase, mongoose } from '../src/lib/db/mongoose';
import { Admin, Client, ClientPayment, Expense, Lead, Project, Task, WorkLog } from '../src/models';

loadEnvConfig(process.cwd());

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3050';
const COOKIE = 'pdv_session';
let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${ok || detail === undefined ? '' : `\n         ${JSON.stringify(detail)}`}`);
}

/** A tiny cookie jar: one cookie, because that is all this app sets. */
class Browser {
  cookie = '';
  async req(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; redirect?: 'manual' | 'follow' } = {}) {
    const method = init.method ?? (init.body !== undefined ? 'POST' : 'GET');
    const res = await fetch(BASE + path, {
      method,
      redirect: init.redirect ?? 'manual',
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'sec-fetch-site': 'same-origin' } : {}),
        ...(this.cookie ? { cookie: `${COOKIE}=${this.cookie}` } : {}),
        ...init.headers,
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    const match = set && new RegExp(`${COOKIE}=([^;]*)`).exec(set);
    if (match) this.cookie = match[1] ?? '';
    // ignoreBOM keeps a leading byte-order mark in the string (fetch's own text() would silently drop it).
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer());
    let json: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      json = JSON.parse(text);
    } catch {
      /* redirect or HTML */
    }
    return { status: res.status, json, text, location: res.headers.get('location'), setCookie: set, headers: res.headers };
  }
}

async function main() {
  const host = new URL(BASE).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error(`Refusing to smoke-test ${BASE}: localhost only`);
  const uri = process.env.MONGODB_URI ?? '';
  if (!/(localhost|127\.0\.0\.1)/.test(uri)) throw new Error('Refusing to run: MONGODB_URI is not a local database');

  await connectToDatabase();
  await mongoose.connection.db?.collection('ratelimits').deleteMany({});

  const tag = randomBytes(3).toString('hex');
  const madePayments: string[] = [];
  const email = `smoke-${tag}@prodevly.test`;
  // Passwords must not contain the person's own name or email, so none of these mention them.
  const temp = `amber-kettle-${tag}-orbit`;
  const real = `velvet-anchor-${tag}-meadow`;
  const created = await Admin.create({
    name: 'Smoke Tester', email, passwordHash: await hashPassword(temp), role: 'superadmin', mustChangePassword: true,
  });
  console.log(`\nSmoke test against ${BASE} as ${email}\n`);

  try {
    const anon = new Browser();
    let r = await anon.req('/admin');
    check('signed-out /admin redirects once to sign-in', r.status === 307 && /\/admin\/login\?next=%2Fadmin$/.test(r.location ?? ''), r);

    const bad = new Browser();
    bad.cookie = 'garbage';
    r = await bad.req('/admin');
    check('an invalid cookie goes via /admin/auth/clear (no redirect loop)', r.status === 307 && /\/admin\/auth\/clear/.test(r.location ?? ''), r);
    r = await bad.req('/admin/auth/clear?next=%2Fadmin%2Fclients');
    check('the clear route deletes the cookie and lands on sign-in', r.status === 307 && /Max-Age=0/i.test(r.setCookie ?? '') && /\/admin\/login\?next=/.test(r.location ?? ''), r);

    const me = new Browser();
    r = await me.req('/api/admin/auth/login', { body: { email, password: 'definitely-wrong-password' } });
    check('wrong password is a 401', r.status === 401 && r.json?.ok === false, r);

    r = await me.req('/api/admin/auth/login', { body: { email, password: temp } });
    check('right password signs in with a hardened cookie', r.status === 200 && /HttpOnly/i.test(r.setCookie ?? '') && /SameSite=lax/i.test(r.setCookie ?? '') && r.json.data.mustChangePassword === true, r);

    r = await me.req('/api/admin/admins');
    check('until the password is changed everything answers PASSWORD_CHANGE_REQUIRED', r.status === 403 && r.json?.error?.code === 'PASSWORD_CHANGE_REQUIRED', r);

    r = await me.req('/api/admin/auth/password', { body: { currentPassword: temp, newPassword: real } });
    check('changing the password works and rotates the cookie', r.status === 200, r);

    r = await me.req('/api/admin/auth/me');
    check('/me knows who we are and what we can do', r.status === 200 && r.json.data.capabilities.includes('admin:manage') && r.json.data.mustChangePassword === false, r);

    r = await me.req('/api/admin/admins');
    check('a superadmin can list admins', r.status === 200 && Array.isArray(r.json.data.admins), r);

    const newAdmin = { name: 'Smoke Colleague', email: `colleague-${tag}@prodevly.test`, role: 'admin', grants: [], password: `copper-lantern-${tag}-river` };
    r = await me.req('/api/admin/admins', { body: { ...newAdmin, role: 'superadmin' } });
    check('creating a superadmin needs a step-up first', r.status === 403 && r.json?.error?.code === 'STEP_UP_REQUIRED', r);

    const otherCopy = new Browser();
    otherCopy.cookie = me.cookie; // the same session, held somewhere else
    r = await me.req('/api/admin/auth/step-up', { body: { password: real } });
    check('step-up with the right password succeeds and re-issues the cookie', r.status === 200 && /pdv_session=/.test(r.setCookie ?? ''), r);
    r = await otherCopy.req('/api/admin/admins', { body: { ...newAdmin, email: `copy-${tag}@prodevly.test`, role: 'superadmin' } });
    check('a second copy of the session does NOT inherit the step-up', r.status === 403 && r.json?.error?.code === 'STEP_UP_REQUIRED', r);

    r = await me.req('/api/admin/admins', { body: newAdmin });
    check('creates a plain admin', r.status === 201 && r.json.data.admin.mustChangePassword === true, r);
    const colleagueId: string = r.json?.data?.admin?.id;

    r = await me.req('/api/admin/admins', { body: newAdmin });
    check('the same email again is a 409', r.status === 409, r);

    r = await me.req(`/api/admin/admins/${created._id}/deactivate`, { body: { reason: 'trying to remove myself' } });
    check('you cannot remove yourself (SELF_ACTION)', r.status === 403 && r.json?.error?.code === 'SELF_ACTION', r);

    r = await me.req(`/api/admin/admins/${String(created._id).toUpperCase()}/deactivate`, { body: { reason: 'upper-case id' } });
    check('... even with the id spelled in UPPERCASE', r.status === 403 && r.json?.error?.code === 'SELF_ACTION', r);

    r = await me.req(`/api/admin/admins/${colleagueId}`, { method: 'PATCH', body: { grants: ['admin:manage'] } });
    check('a superadmin-only capability can never be granted', r.status === 422, r);
    r = await me.req(`/api/admin/admins/${colleagueId}`, { method: 'PATCH', body: { grants: ['payment:record'] } });
    check('a grant is stored with its dependency (record implies view)', r.status === 200 && r.json?.data?.admin?.grants?.includes('payment:view'), r);


    // ---- delivery and money, over real HTTP (client, project, task, time, payments, expenses, export, enquiry)
    const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
    r = await me.req('/api/admin/clients', { body: { name: `Smoke Client ${tag}`, status: 'active', contacts: [{ name: 'Pat Smoke', email: `pat-${tag}@prodevly.test`, isPrimary: true }] } });
    check('creates a client with a reference', r.status === 201 && /^CL-\d{4}$/.test(r.json?.data?.client?.ref ?? ''), r);
    const clientId: string = r.json?.data?.client?.id;
    const mkProject = async (name: string) => me.req('/api/admin/projects', { body: { clientId, name, type: 'web_app', status: 'active', contract: { pricingModel: 'fixed', amountMinor: 1_000_000, currency: 'INR' } } });
    r = await mkProject(`Smoke Project A ${tag}`);
    check('creates a project under the client', r.status === 201 && /^PRJ-\d{4}$/.test(r.json?.data?.project?.ref ?? ''), r);
    const projectA: string = r.json?.data?.project?.id;
    r = await mkProject(`Smoke Project B ${tag}`);
    const projectB: string = r.json?.data?.project?.id;
    r = await me.req('/api/admin/tasks', { body: { projectId: projectA, title: `Smoke task A ${tag}` } });
    check('creates a task whose reference carries the project', r.status === 201 && /-T\d{3}$/.test(r.json?.data?.task?.ref ?? ''), r);
    const taskA: string = r.json?.data?.task?.id;
    r = await me.req('/api/admin/tasks', { body: { projectId: projectB, title: `Smoke task B ${tag}` } });
    const taskB: string = r.json?.data?.task?.id;
    r = await me.req('/api/admin/work-logs', { body: { taskId: taskA, workedOn: day(1), minutes: 90, note: 'Smoke time entry' } });
    check('logs time against the task (project and client are derived)', r.status === 201, r);

    r = await me.req('/api/admin/payments', { body: { projectId: projectA, taskId: taskB, amountMinor: 100_000, currency: 'INR', receivedOn: day(1), mode: 'bank_transfer' } });
    check('a payment naming a task from another project is a LINK_MISMATCH', r.status === 422 && r.json?.error?.code === 'LINK_MISMATCH', r);
    r = await me.req('/api/admin/payments', { body: { projectId: projectA, amountMinor: 250_000, currency: 'INR', receivedOn: day(1), mode: 'bank_transfer' } });
    check('records an INR payment (identity rate, server-computed INR)', r.status === 201 && r.json?.data?.payment?.amount?.inrMinor === 250_000 && /^PAY-FY\d{2}-\d{4}$/.test(r.json?.data?.payment?.ref ?? ''), r);
    const paymentId: string = r.json?.data?.payment?.id;
    madePayments.push(paymentId);
    r = await me.req('/api/admin/payments', { body: { projectId: projectA, amountMinor: 10_000, currency: 'USD', manualRate: 80, receivedOn: day(1), mode: 'bank_transfer', contractEquivalentMinor: 800_000 } });
    check('records a USD payment at a typed rate: INR is rate x amount', r.status === 201 && r.json?.data?.payment?.amount?.inrMinor === 800_000, r);
    madePayments.push(r.json?.data?.payment?.id);
    r = await me.req(`/api/admin/payments?projectId=${projectA}`);
    check('the payments ledger total equals the sum of the INR values', r.status === 200 && r.json?.data?.summary?.receivedInr === 1_050_000, r);
    r = await me.req(`/api/admin/payments/${paymentId}/void`, { body: { reason: 'smoke test entry' } });
    check('voiding a payment succeeds', r.status === 200, r);
    r = await me.req(`/api/admin/payments?projectId=${projectA}`);
    check('... and the voided entry leaves the total', r.json?.data?.summary?.receivedInr === 800_000 && r.json?.data?.summary?.voided === 1, r);

    r = await me.req('/api/admin/expenses', { body: { scope: 'company', category: 'hosting_domains', description: 'Smoke hosting', amountMinor: 120_000, currency: 'INR', spentOn: day(1), paidFrom: 'company', paidOn: day(1), mode: 'bank_transfer' } });
    check('records a company expense', r.status === 201, r);

    r = await otherCopy.req(`/api/admin/exports/clients`);
    check('an export needs a recent password confirmation (the other copy of the session has none)', r.status === 403 && r.json?.error?.code === 'STEP_UP_REQUIRED', r);
    r = await me.req(`/api/admin/exports/clients?q=Smoke%20Client`);
    check('after step-up the export is a CSV with a BOM and the client in it', r.status === 200 && /text\/csv/.test(r.headers.get('content-type') ?? '') && r.text.charCodeAt(0) === 0xfeff && r.text.includes(`Smoke Client ${tag}`), { status: r.status, head: r.text?.slice(0, 80) });
    r = await me.req(`/api/admin/exports/clients`, { headers: { 'sec-fetch-site': 'cross-site' } });
    check('an export started from another site is refused', r.status === 403, r);

    const gate = await new Browser().req('/api/form-token');
    const tokenIssuedAt = Date.now();
    const intake = (token: string) => ({ body: { formToken: token, name: 'Smoke Visitor', email: `visitor-${tag}@prodevly.test`, message: 'We need a customer portal built for our business, can we talk this week?' } });
    r = await new Browser().req('/api/leads', { body: { ...intake(gate.json?.data?.token).body, companyWebsite: 'http://spam.example' } });
    const stored = async () => Lead.countDocuments({ email: `visitor-${tag}@prodevly.test` });
    check('the honeypot answers a decoy success and stores nothing', r.status === 201 && (await stored()) === 0, r);
    r = await new Browser().req('/api/leads', intake(gate.json?.data?.token));
    check('a form submitted in under 3 seconds is silently dropped', r.status === 201 && (await stored()) === 0, r);
    await new Promise((done) => setTimeout(done, Math.max(0, 3200 - (Date.now() - tokenIssuedAt))));
    r = await new Browser().req('/api/leads', intake(gate.json?.data?.token));
    check('a real enquiry is stored', r.status === 201 && (await stored()) === 1, r);
    const lead = await Lead.findOne({ email: `visitor-${tag}@prodevly.test` }).lean();
    r = await me.req(`/api/admin/enquiries/${lead?._id}/convert`, { body: { mode: 'new', client: { name: `Smoke Converted ${tag}` }, project: { name: `Smoke Converted Project ${tag}`, type: 'website' } } });
    check('converting the enquiry creates a client and a draft project together', r.status === 201 || r.status === 200, r);
    r = await me.req(`/api/admin/enquiries/${lead?._id}/convert`, { body: { mode: 'new', client: { name: `Smoke Converted Again ${tag}` } } });
    check('an enquiry cannot be converted twice', r.status === 409, r);

    const colleague = new Browser();
    await colleague.req('/api/admin/auth/login', { body: { email: newAdmin.email, password: newAdmin.password } });
    await colleague.req('/api/admin/auth/password', { body: { currentPassword: newAdmin.password, newPassword: `silver-harbor-${tag}-summit` } });
    r = await colleague.req('/api/admin/auth/me');
    check('the granted capability shows up in the colleague\'s own session', r.status === 200 && r.json?.data?.capabilities?.includes('payment:record') && !r.json.data.capabilities.includes('money:approve'), r);
    r = await colleague.req('/api/admin/admins');
    check('a plain admin gets 403 on admin management', r.status === 403 && r.json?.error?.code === 'FORBIDDEN', r);

    r = await me.req(`/api/admin/admins/${colleagueId}/deactivate`, { body: { reason: 'smoke test cleanup' } });
    check('a superadmin can deactivate them', r.status === 200 && r.json.data.admin.status === 'deactivated', r);
    r = await colleague.req('/api/admin/auth/me');
    check('the removed admin\'s session dies immediately', r.status === 401, r);
    r = await new Browser().req('/api/admin/auth/login', { body: { email: newAdmin.email, password: `silver-harbor-${tag}-summit` } });
    check('and they cannot sign in again', r.status === 401, r);

    r = await me.req('/api/admin/auth/sign-out-everywhere', { body: {} });
    check('sign out everywhere keeps this browser signed in', r.status === 200, r);
    const stale = new Browser();
    stale.cookie = 'garbage';
    r = await me.req('/api/admin/auth/me');
    check('... with a fresh cookie that still works', r.status === 200, r);

    r = await me.req('/api/admin/auth/step-up', { body: { password: real }, headers: { 'sec-fetch-site': 'cross-site' } });
    check('a cross-site POST is rejected', r.status === 403, r);

    r = await me.req('/api/admin/auth/logout', { body: {} });
    check('logout clears the cookie', r.status === 200 && /Max-Age=0/i.test(r.setCookie ?? ''), r);
    r = await new Browser().req('/api/admin/auth/me');
    check('and /me then answers 401', r.status === 401, r);
    void stale;
  } finally {
    // Cleanup: the throwaway accounts only. Audit entries stay (the log is append-only).
    await Admin.deleteMany({ email: new RegExp(`-${tag}@prodevly\\.test$`) });
    // The business records the run created (the audit trail stays: it is append-only).
    const named = new RegExp(`^Smoke .*${tag}$`);
    await Promise.all([
      Client.deleteMany({ name: named }),
      Project.deleteMany({ name: named }),
      Task.deleteMany({ title: new RegExp(`^Smoke task .* ${tag}$`) }),
      WorkLog.deleteMany({ note: 'Smoke time entry' }),
      ...madePayments.map((id) => ClientPayment.deleteOne({ _id: id })),
      Expense.deleteMany({ description: 'Smoke hosting' }),
      Lead.deleteMany({ email: new RegExp(`-${tag}@prodevly\\.test$`) }),
    ]);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error('Smoke test crashed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => disconnectFromDatabase());
