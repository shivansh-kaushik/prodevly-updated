import { describe, expect, it } from 'vitest';
import { convertLabel, summariseConversion, type ConversionPreview } from './convert-summary';

const base: ConversionPreview = { mode: 'new', leadRef: 'ENQ-0007', clientName: 'Acme Logistics', kind: 'company', contactName: 'Neha Verma', projectName: null };

describe('what will happen', () => {
  it('a new client alone: create it, then mark the enquiry won', () => {
    expect(summariseConversion(base)).toEqual([
      'Create the client "Acme Logistics" (company), with Neha Verma as the main contact.',
      'Mark ENQ-0007 as won and link it to the client.',
    ]);
  });

  it('a new client with a draft project names the project and says it is a proposal', () => {
    const lines = summariseConversion({ ...base, projectName: ' Logistics portal ' });
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('Start a draft project "Logistics portal" for that client, as a proposal, with this enquiry\'s message as its scope summary.');
    expect(lines[2]).toBe('Mark ENQ-0007 as won and link it to the client and project.');
  });

  it('an existing client is linked, and the first line says its details are not changed', () => {
    const lines = summariseConversion({ ...base, mode: 'existing', clientName: 'Brightpath Learning' });
    expect(lines[0]).toBe("Link this enquiry to Brightpath Learning. The client's own details are not changed.");
    expect(summariseConversion({ ...base, mode: 'existing', clientName: '' })[0]).toMatch(/the client you pick/);
  });

  it('reads sensibly before the person has typed a name', () => {
    expect(summariseConversion({ ...base, clientName: '  ', projectName: '' })).toEqual([
      'Create a new client (company), with Neha Verma as the main contact.',
      "Start a draft project for that client, as a proposal, with this enquiry's message as its scope summary.",
      'Mark ENQ-0007 as won and link it to the client and project.',
    ]);
  });

  it('labels the button with what it does', () => {
    expect(convertLabel('new', false)).toBe('Create client');
    expect(convertLabel('new', true)).toBe('Create client and project');
    expect(convertLabel('existing', false)).toBe('Link to client');
    expect(convertLabel('existing', true)).toBe('Link client and create project');
  });
});
