import { Types } from 'mongoose';
import type { PROJECT_TYPES, TASK_STATUSES } from '@/config/statuses';
import { Client, Project, Task, ThirdParty, type ClientDoc, type ProjectDoc, type TaskDoc } from '@/models';
import { nextRef, nextTaskRef } from '@/services/refs';

/**
 * Direct-to-database fixtures for tests: they bypass services on purpose, so a service test can
 * set up exactly the state it needs. Each module adds its own factories in `<module>-factories.ts`
 * beside this file and imports these.
 */
const SYSTEM = { id: null, name: 'Test' };
let n = 0;
const next = () => ++n;

export async function makeClient(o: Partial<ClientDoc> = {}): Promise<ClientDoc> {
  const i = next();
  const doc = await Client.create({
    ref: await nextRef('client'),
    name: o.name ?? `Client ${i}`,
    kind: 'company',
    status: 'active',
    billingCurrency: 'INR',
    createdBy: SYSTEM,
    ...o,
  });
  return doc.toObject();
}

export async function makeProject(client: Pick<ClientDoc, '_id' | 'name'>, o: Partial<ProjectDoc> & { type?: (typeof PROJECT_TYPES)[number] } = {}): Promise<ProjectDoc> {
  const i = next();
  const doc = await Project.create({
    ref: await nextRef('project'),
    clientId: client._id,
    clientName: client.name,
    name: o.name ?? `Project ${i}`,
    type: 'web_app',
    status: 'active',
    contract: { pricingModel: 'fixed', amountMinor: 0, currency: 'INR' },
    createdBy: SYSTEM,
    ...o,
  });
  return doc.toObject();
}

export async function makeTask(project: Pick<ProjectDoc, '_id' | 'ref' | 'clientId'>, o: Partial<TaskDoc> & { status?: (typeof TASK_STATUSES)[number] } = {}): Promise<TaskDoc> {
  const i = next();
  const doc = await Task.create({
    ref: await nextTaskRef(project.ref),
    projectId: project._id,
    clientId: project.clientId,
    title: o.title ?? `Task ${i}`,
    status: 'todo',
    createdBy: SYSTEM,
    ...o,
  });
  return doc.toObject();
}

export async function makeThirdParty(o: { name?: string; status?: 'active' | 'inactive' } = {}) {
  const i = next();
  const doc = await ThirdParty.create({
    ref: await nextRef('thirdParty'),
    name: o.name ?? `Vendor ${i}`,
    type: 'freelancer',
    status: o.status ?? 'active',
    createdBy: SYSTEM,
  });
  return doc.toObject();
}

export const newId = () => new Types.ObjectId();
