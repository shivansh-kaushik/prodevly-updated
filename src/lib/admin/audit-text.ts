import { humanize } from './format';

/**
 * Turns an audit action ("admin.deactivate") into a sentence fragment a person can read. The activity feed puts the actor
 * before it and the record's label and reference after it ("Asha created project Checkout PRJ-0001"), so a phrase ends on
 * the kind of record, not on a full stop. Tables are Maps so a stored value like "constructor" can never hit a prototype key.
 */
const VERB = new Map(
  Object.entries({
    create: 'created', update: 'updated', delete: 'deleted', archive: 'archived', restore: 'restored',
    deactivate: 'deactivated', reactivate: 'reactivated', void: 'voided', approve: 'approved', reject: 'rejected',
    publish: 'published', unpublish: 'unpublished', convert: 'converted', assign: 'assigned', unassign: 'unassigned',
    // "marked as paid expense" does not read; the record is the object of the verb, so say what happened to it.
    mark_paid: 'paid', mark_spam: 'flagged spam', status: 'changed the status of', reorder: 'reordered',
    reset_password: 'reset the password of', revoke_sessions: 'signed out all sessions of', password_changed: 'changed their password',
    login: 'signed in', login_failed: 'failed to sign in', step_up: 'confirmed their password',
    sign_out_everywhere: 'signed out everywhere', note: 'added a note to', superadmin_created: 'seeded superadmin',
    internal_client_created: 'created the internal client',
  }),
);

/** The kind of record, as written after the verb. Keyed by the entity type and, for the filter menu, by the action's prefix. */
const ENTITY = new Map(
  Object.entries({
    thirdParty: 'third party', thirdPartyPayout: 'third-party payout', workOrder: 'work order', workLog: 'work log',
    teamPayout: 'team payout', clientPayment: 'payment', fxRate: 'FX rate', teamRole: 'job role', payProfile: 'pay profile',
    lead: 'enquiry', teamProfile: 'team profile', site_info: 'company info', showcase: 'showcase item', media: 'file',
    settings: 'settings', expense: 'expense', payment: 'payment', partner: 'partner',
    // Content: the entity type is `pricing_plan`, but the action prefix the filter menu sees is `pricing`.
    pricing: 'pricing plan', developer: 'developer profile', service: 'service',
  }),
);

/**
 * Actions where a verb plus the record's kind is the wrong sentence. The whole phrase is written out; the record's label
 * still follows it ("logged time on task Fix login TSK-12").
 */
const PHRASE = new Map(
  Object.entries({
    'workLog.create': 'logged time on task',
    'workLog.update': 'edited a time entry on task',
    'workLog.delete': 'deleted a time entry on task',
    // The feed's record here is the project (the order is about its tasks), so the verb alone would read "reordered project".
    'task.reorder': 'reordered the tasks of project',
    'media.create': 'uploaded file',
  }),
);

/**
 * Actions whose record label already names what they touched ("Organisation settings", "Job roles", "3 showcase items"). In the
 * feed, where the label is shown, the kind of record would only repeat it; in the filter menu, which has no label, it is kept.
 */
const SELF_NAMED = new Set(['settings.update', 'site_info.update', 'teamRole.reorder']);

/** Verbs that carry their own object ("signed in", "changed their password") and take no record kind. */
const STANDALONE = new Set(['login', 'login_failed', 'step_up', 'sign_out_everywhere', 'password_changed', 'superadmin_created', 'internal_client_created']);

/** `describeAction(action, entityType)` from the feed; `describeAction(action)` alone from the filter menu. */
export function describeAction(action: string, entityType?: string): string {
  const [rawEntity = '', ...rest] = action.split('.');
  const verb = rest.join('.');

  // `export.<section>`: a download of one section's records ("export.payments", "export.team_payouts"). The export service labels
  // the entry with the section's own name ("client payments export"), which the feed shows after the phrase; the filter menu has no label.
  if (rawEntity === 'export' && verb) return entityType ? 'exported the' : `exported ${humanize(verb.replaceAll('-', '_'), false)}`;

  const whole = PHRASE.get(action);
  if (whole) return whole;

  const phrase = VERB.get(verb) ?? humanize(verb || rawEntity, false);
  if (STANDALONE.has(verb)) return phrase;

  const kind = ENTITY.get(entityType ?? rawEntity) ?? humanize(entityType ?? rawEntity, false);
  const noun = kind === 'auth' ? '' : kind;
  const named = SELF_NAMED.has(action) || verb === 'reorder';
  // A reorder's label is the plural already ("3 showcase items"); the menu has no label, so it needs the noun, pluralised.
  if (named && entityType) return phrase;
  return `${phrase} ${verb === 'reorder' && noun ? `${noun}s` : noun}`.trim();
}
