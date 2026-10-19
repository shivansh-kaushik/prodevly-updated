import { Types, type ClientSession } from 'mongoose';
import { formatDateOnly } from '@/lib/dates/date-only';
import { mongoose } from '@/lib/db/mongoose';
import { Project, Task, type ClientPaymentDoc } from '@/models';

/**
 * The shape a client payment leaves the server in: plain objects, string ids, ISO dates, names joined in
 * so a list renders without a second trip. Nothing here is a Mongoose document, and nothing is read from
 * the client's request: the client and the contract currency come from the project record.
 */
export interface PaymentMoneyDTO {
  amountMinor: number;
  currency: string;
  /** INR per 1 unit of the currency; exactly 1 for INR. */
  fxRate: number;
  /** "YYYY-MM-DD": the day the rate applies to. */
  fxDate: string;
  fxSource: 'identity' | 'table' | 'bank' | 'manual';
  /** Integer paise, computed on the server. */
  inrMinor: number;
}

export interface PaymentDTO {
  id: string;
  ref: string;
  type: 'receipt' | 'refund';
  status: 'received' | 'void';
  /** The ids again, flat, for code that only needs to link or compare. */
  clientId: string;
  projectId: string;
  taskId: string | null;
  milestoneId: string | null;
  client: { id: string; name: string };
  project: { id: string; ref: string; name: string };
  task: { id: string; ref: string; title: string } | null;
  milestone: { id: string; title: string } | null;
  amount: PaymentMoneyDTO;
  /** The same amount in the project's contract currency. */
  contractEquivalentMinor: number;
  contractCurrency: string;
  tdsMinor: number | null;
  chargesMinor: number | null;
  /** "YYYY-MM-DD", a calendar date. */
  receivedOn: string;
  mode: string;
  transactionRef: string | null;
  invoiceRef: string | null;
  note: string | null;
  attachmentMediaIds: string[];
  /** Recorded knowing it takes the total received above what is billable. */
  recordedAsAdvance: boolean;
  voidReason: string | null;
  voidedBy: string | null;
  voidedAt: string | null;
  recordedBy: string;
  createdAt: string;
  updatedAt: string;
  /** Things worth a second look, returned when the entry is recorded or changed. Empty on reads. */
  warnings: string[];
}

export interface ProjectBrief {
  id: string;
  ref: string;
  name: string;
  clientId: string;
  clientName: string;
  contractCurrency: string;
  milestones: Map<string, string>;
}

export interface TaskBrief {
  id: string;
  ref: string;
  title: string;
}

export interface Briefs {
  projects: Map<string, ProjectBrief>;
  tasks: Map<string, TaskBrief>;
}

const oid = (id: string) => new Types.ObjectId(id);

/** Names for the links of these payments, in two queries however many payments there are. */
export async function loadBriefs(
  payments: ReadonlyArray<Pick<ClientPaymentDoc, 'projectId' | 'taskId'>>,
  session?: ClientSession,
): Promise<Briefs> {
  const projectIds = [...new Set(payments.map((p) => String(p.projectId)))].map(oid);
  const taskIds = [...new Set(payments.flatMap((p) => (p.taskId ? [String(p.taskId)] : [])))].map(oid);
  const projects = new Map<string, ProjectBrief>();
  const tasks = new Map<string, TaskBrief>();

  if (projectIds.length > 0) {
    const rows = await Project.find({ _id: mongoose.trusted({ $in: projectIds }) })
      .select('ref name clientId clientName contract.currency milestones._id milestones.title')
      .session(session ?? null)
      .lean();
    for (const p of rows) {
      projects.set(String(p._id), {
        id: String(p._id),
        ref: p.ref,
        name: p.name,
        clientId: String(p.clientId),
        clientName: p.clientName,
        contractCurrency: p.contract.currency,
        milestones: new Map((p.milestones ?? []).map((m) => [String(m._id), m.title])),
      });
    }
  }
  if (taskIds.length > 0) {
    const rows = await Task.find({ _id: mongoose.trusted({ $in: taskIds }) })
      .select('ref title')
      .session(session ?? null)
      .lean();
    for (const t of rows) tasks.set(String(t._id), { id: String(t._id), ref: t.ref, title: t.title });
  }
  return { projects, tasks };
}

export function toPaymentDTO(p: ClientPaymentDoc, briefs: Briefs, warnings: string[] = []): PaymentDTO {
  const project = briefs.projects.get(String(p.projectId));
  const task = p.taskId ? briefs.tasks.get(String(p.taskId)) : undefined;
  const milestoneTitle = p.milestoneId ? project?.milestones.get(String(p.milestoneId)) : undefined;
  return {
    id: String(p._id),
    ref: p.ref,
    type: p.type,
    status: p.status,
    clientId: String(p.clientId),
    projectId: String(p.projectId),
    taskId: p.taskId ? String(p.taskId) : null,
    milestoneId: p.milestoneId ? String(p.milestoneId) : null,
    client: { id: String(p.clientId), name: project?.clientName ?? 'Unknown client' },
    project: { id: String(p.projectId), ref: project?.ref ?? '', name: project?.name ?? 'Unknown project' },
    task: p.taskId ? { id: String(p.taskId), ref: task?.ref ?? '', title: task?.title ?? 'Unknown task' } : null,
    milestone: p.milestoneId ? { id: String(p.milestoneId), title: milestoneTitle ?? 'Unknown milestone' } : null,
    amount: {
      amountMinor: p.amount.amountMinor,
      currency: p.amount.currency,
      fxRate: p.amount.fxRate,
      fxDate: formatDateOnly(p.amount.fxDate),
      fxSource: p.amount.fxSource,
      inrMinor: p.amount.inrMinor,
    },
    contractEquivalentMinor: p.contractEquivalentMinor,
    contractCurrency: project?.contractCurrency ?? p.amount.currency,
    tdsMinor: p.tdsMinor ?? null,
    chargesMinor: p.chargesMinor ?? null,
    receivedOn: formatDateOnly(p.receivedOn),
    mode: p.mode,
    transactionRef: p.transactionRef ?? null,
    invoiceRef: p.invoiceRef ?? null,
    note: p.note ?? null,
    attachmentMediaIds: (p.attachmentMediaIds ?? []).map(String),
    recordedAsAdvance: Boolean(p.recordedAsAdvance),
    voidReason: p.voidReason ?? null,
    voidedBy: p.voidedBy?.name ?? null,
    voidedAt: p.voidedAt ? p.voidedAt.toISOString() : null,
    recordedBy: p.recordedBy?.name ?? 'Unknown',
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    warnings,
  };
}
