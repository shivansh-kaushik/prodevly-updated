import type { Capability } from '@/config/capabilities';
import { AuditLog, Client, Lead, Project } from '@/models';
import type { SessionUser } from '@/types/session';
import { makeLead, type LeadOverrides } from './lead-factories';

/** Fixtures for enquiry conversion. Direct-to-database, like the other factories. */

/** An enquiry with everything the conversion can map: a company, a phone, a country as free text, a message. */
export const makeConvertibleLead = (o: LeadOverrides = {}) =>
  makeLead({
    name: 'Neha Verma',
    email: 'neha@acme-logistics.example',
    company: 'Acme Logistics',
    phone: '+91 98765 43210',
    country: 'India',
    message: 'We need a customer portal for our logistics business. Can we talk this week?',
    ...o,
  });

/** The same signed-in person, with exactly these capabilities: the service must check them itself. */
export const withCaps = (viewer: SessionUser, caps: Capability[]): SessionUser => ({ ...viewer, capabilities: new Set(caps) });

/** Everything a conversion could write, so a test can say "nothing changed" in one comparison. */
export async function conversionFootprint(leadId: unknown) {
  const lead = await Lead.findById(leadId).lean();
  return {
    clients: await Client.countDocuments({}),
    projects: await Project.countDocuments({}),
    audit: await AuditLog.countDocuments({}),
    lead: lead && {
      status: lead.status,
      history: lead.statusHistory.length,
      convertedClientId: lead.convertedClientId ?? null,
      convertedProjectId: lead.convertedProjectId ?? null,
      firstResponseAt: lead.firstResponseAt ?? null,
    },
  };
}
