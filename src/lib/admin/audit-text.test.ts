import { describe, expect, it } from 'vitest';
import { describeAction } from './audit-text';

describe('describeAction', () => {
  it('reads as a sentence fragment', () => {
    expect(describeAction('admin.deactivate', 'admin')).toBe('deactivated admin');
    expect(describeAction('payment.void', 'clientPayment')).toBe('voided payment');
    expect(describeAction('auth.login', 'admin')).toBe('signed in');
    expect(describeAction('auth.login_failed', 'admin')).toBe('failed to sign in');
    expect(describeAction('admin.reset_password', 'admin')).toBe('reset the password of admin');
    expect(describeAction('admin.revoke_sessions', 'admin')).toBe('signed out all sessions of admin');
  });
  it('falls back to a humanised verb for unknown actions', () => {
    expect(describeAction('client.some_new_thing', 'client')).toBe('some new thing client');
  });
  it('never reads a stored name as a property of the lookup tables', () => {
    expect(describeAction('constructor.__proto__', 'toString')).toBe('proto to string');
  });

  it('names money actions by what happened to the record', () => {
    expect(describeAction('payment.create', 'payment')).toBe('created payment');
    expect(describeAction('payment.update', 'payment')).toBe('updated payment');
    expect(describeAction('thirdPartyPayout.create', 'thirdPartyPayout')).toBe('created third-party payout');
    expect(describeAction('thirdPartyPayout.mark_paid', 'thirdPartyPayout')).toBe('paid third-party payout');
    expect(describeAction('thirdPartyPayout.void', 'thirdPartyPayout')).toBe('voided third-party payout');
    expect(describeAction('teamPayout.create', 'teamPayout')).toBe('created team payout');
    expect(describeAction('teamPayout.mark_paid', 'teamPayout')).toBe('paid team payout');
    expect(describeAction('teamPayout.void', 'teamPayout')).toBe('voided team payout');
    expect(describeAction('expense.approve', 'expense')).toBe('approved expense');
    expect(describeAction('expense.reject', 'expense')).toBe('rejected expense');
    expect(describeAction('expense.mark_paid', 'expense')).toBe('paid expense');
    expect(describeAction('expense.void', 'expense')).toBe('voided expense');
    expect(describeAction('fxRate.create', 'fxRate')).toBe('created FX rate');
    expect(describeAction('payProfile.update', 'payProfile')).toBe('updated pay profile');
  });

  it('reads the third-party and delivery records', () => {
    expect(describeAction('thirdParty.archive', 'thirdParty')).toBe('archived third party');
    expect(describeAction('workOrder.create', 'workOrder')).toBe('created work order');
    expect(describeAction('workOrder.status', 'workOrder')).toBe('changed the status of work order');
    expect(describeAction('task.assign', 'task')).toBe('assigned task');
    expect(describeAction('task.delete', 'task')).toBe('deleted task');
    expect(describeAction('workLog.create', 'workLog')).toBe('logged time on task');
    expect(describeAction('workLog.update', 'workLog')).toBe('edited a time entry on task');
    expect(describeAction('workLog.delete', 'workLog')).toBe('deleted a time entry on task');
    // The record behind a task reorder is the project.
    expect(describeAction('task.reorder', 'project')).toBe('reordered the tasks of project');
    expect(describeAction('task.reorder')).toBe('reordered the tasks of project');
  });

  it('reads enquiry actions, including the conversion', () => {
    expect(describeAction('lead.convert', 'lead')).toBe('converted enquiry');
    expect(describeAction('lead.mark_spam', 'lead')).toBe('flagged spam enquiry');
    expect(describeAction('lead.note', 'lead')).toBe('added a note to enquiry');
    expect(describeAction('lead.assign', 'lead')).toBe('assigned enquiry');
    expect(describeAction('lead.status', 'lead')).toBe('changed the status of enquiry');
  });

  it('reads content, file and settings actions', () => {
    expect(describeAction('pricing.publish', 'pricing_plan')).toBe('published pricing plan');
    expect(describeAction('developer.update', 'developer_profile')).toBe('updated developer profile');
    expect(describeAction('showcase.archive', 'showcase_item')).toBe('archived showcase item');
    expect(describeAction('media.create', 'media')).toBe('uploaded file');
    expect(describeAction('media.delete', 'media')).toBe('deleted file');
    expect(describeAction('seed.superadmin_created', 'admin')).toBe('seeded superadmin');
    expect(describeAction('auth.sign_out_everywhere', 'admin')).toBe('signed out everywhere');
  });

  it('does not repeat a record that the feed names after the phrase', () => {
    // The feed shows "Organisation settings" / "Job roles" / "3 showcase items" itself after the phrase.
    expect(describeAction('settings.update', 'settings')).toBe('updated');
    expect(describeAction('site_info.update', 'site_info')).toBe('updated');
    expect(describeAction('teamRole.reorder', 'teamRole')).toBe('reordered');
    expect(describeAction('showcase.reorder', 'showcase_item')).toBe('reordered');
    // The filter menu has no label, so it keeps the kind of record, and stays distinct per action.
    expect(describeAction('settings.update')).toBe('updated settings');
    expect(describeAction('site_info.update')).toBe('updated company info');
    expect(describeAction('teamRole.reorder')).toBe('reordered job roles');
    expect(describeAction('showcase.reorder')).toBe('reordered showcase items');
    expect(describeAction('pricing.reorder')).toBe('reordered pricing plans');
  });

  it('names an export by its section', () => {
    // The filter menu has no label, so the section is in the phrase.
    expect(describeAction('export.payments')).toBe('exported payments');
    expect(describeAction('export.team_payouts')).toBe('exported team payouts');
    expect(describeAction('export.third-party-payouts')).toBe('exported third party payouts');
    expect(describeAction('export.fx_rates')).toBe('exported FX rates');
    // The feed shows the entry's label ("client payments export") after the phrase, so it reads "exported the client payments export".
    expect(describeAction('export.payments', 'export')).toBe('exported the');
    expect(describeAction('export.team_payouts', 'export')).toBe('exported the');
  });
});
