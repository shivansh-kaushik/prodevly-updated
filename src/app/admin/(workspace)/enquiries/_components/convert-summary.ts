import { humanize } from '@/lib/admin/format';

/**
 * The plain-language preview in the convert drawer: what pressing the button will do, in the order
 * it happens. Pure, so the wording is tested and the drawer only renders it.
 */
export interface ConversionPreview {
  mode: 'new' | 'existing';
  leadRef: string;
  /** New mode: the name typed. Existing mode: the client picked, or '' before one is. */
  clientName: string;
  kind: string;
  contactName: string;
  /** Null when no project is asked for. */
  projectName: string | null;
}

const quoted = (name: string) => `"${name.trim()}"`;

export function summariseConversion(p: ConversionPreview): string[] {
  const lines: string[] = [];
  const name = p.clientName.trim();
  if (p.mode === 'new') {
    lines.push(
      `${name ? `Create the client ${quoted(name)}` : 'Create a new client'} (${humanize(p.kind).toLowerCase()}), with ${p.contactName} as the main contact.`,
    );
  } else {
    lines.push(name ? `Link this enquiry to ${name}. The client's own details are not changed.` : "Link this enquiry to the client you pick. The client's own details are not changed.");
  }
  if (p.projectName !== null) {
    const project = p.projectName.trim();
    lines.push(`Start ${project ? `a draft project ${quoted(project)}` : 'a draft project'} for that client, as a proposal, with this enquiry's message as its scope summary.`);
  }
  lines.push(`Mark ${p.leadRef} as won and link it to the ${p.projectName !== null ? 'client and project' : 'client'}.`);
  return lines;
}

/** The button says what it does, so the person is not pressing a vague "Convert". */
export function convertLabel(mode: 'new' | 'existing', withProject: boolean): string {
  if (mode === 'new') return withProject ? 'Create client and project' : 'Create client';
  return withProject ? 'Link client and create project' : 'Link to client';
}
