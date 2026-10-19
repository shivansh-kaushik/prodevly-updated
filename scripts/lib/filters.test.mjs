import { describe, expect, it } from 'vitest';
import { findUntrustedOperators } from './filters.mjs';

const ops = (src) => findUntrustedOperators(src).map((f) => f.operator);

describe('filters: what is flagged', () => {
  it('flags a bare operator inside the filter of each query method', () => {
    for (const call of [
      `Admin.find({ status: { $ne: 'x' } })`,
      `Admin.findOne({ status: { $ne: 'x' } })`,
      `Admin.updateOne({ status: { $ne: 'x' } }, { $set: { a: 1 } })`,
      `Admin.updateMany({ status: { $ne: 'x' } }, { $set: { a: 1 } })`,
      `Admin.deleteMany({ status: { $ne: 'x' } })`,
      `Admin.deleteOne({ status: { $ne: 'x' } })`,
      `Admin.countDocuments({ status: { $ne: 'x' } })`,
      `Admin.exists({ status: { $ne: 'x' } })`,
      `Admin.findOneAndUpdate({ status: { $ne: 'x' } }, { $inc: { n: 1 } })`,
      `Admin.distinct('email', { status: { $ne: 'x' } })`,
      `Admin.find({}).where({ status: { $ne: 'x' } })`,
      `Admin.find({}).or([{ status: { $ne: 'x' } }])`,
    ]) {
      expect(ops(call), call).toEqual(['$ne']);
    }
  });

  it('flags the operators the old grep missed', () => {
    expect(ops(`A.find({ n: { $gte: 1, $lt: 5 } })`)).toEqual(['$gte', '$lt']);
    expect(ops(`A.find({ t: { $regex: 'x' }, u: { $exists: true } })`)).toEqual(['$regex', '$exists']);
    expect(ops(`A.find({ $text: { $search: 'x' } })`)).toEqual(['$text']);
    expect(ops(`A.find({ $where: 'this.a > 1' })`)).toEqual(['$where']);
    expect(ops(`A.find({ $expr: { $gt: ['$a', 1] } })`)).toEqual(['$expr']);
  });

  it('flags an operator inside an $or/$and/$nor member', () => {
    expect(ops(`A.find({ $or: [{ a: 1 }, { b: { $in: [1, 2] } }] })`)).toEqual(['$in']);
    expect(ops(`A.find({ $and: [{ $nor: [{ c: { $nin: [3] } }] }] })`)).toEqual(['$nin']);
  });

  it('follows a filter held in a const', () => {
    expect(ops(`const filter = { status: { $ne: 'x' } };\nA.find(filter);`)).toEqual(['$ne']);
  });

  it('flags only the untrusted part of a line that also contains trusted()', () => {
    // the old grep exempted the WHOLE line because it contained "trusted("
    expect(ops(`A.find({ a: mongoose.trusted({ $ne: 1 }), b: { $gt: 2 } })`)).toEqual(['$gt']);
  });

  it('reports the line number and text', () => {
    const [f] = findUntrustedOperators(`const x = 1;\n\nA.find({\n  status: { $ne: 'x' },\n});`);
    expect(f).toMatchObject({ line: 4, operator: '$ne' });
    expect(f.text).toContain('$ne');
  });

  it('flags a filter after a LONG pipeline (the old tool went blind for 60 lines after any aggregate)', () => {
    const pad = Array.from({ length: 80 }, () => '  { $project: { a: 1 } },').join('\n');
    const src = `A.aggregate([\n${pad}\n]);\nA.find({ s: { $ne: 'x' } });`;
    expect(ops(src)).toEqual(['$ne']);
  });
});

describe('filters: indirect construction', () => {
  it('follows later assignments to a filter object', () => {
    expect(ops(`const q = {};\nq.at = { $lt: d };\nA.find(q);`)).toEqual(['$lt']);
    expect(ops(`const q = {};\nq['x'] = { $in: ids };\nA.find(q);`)).toEqual(['$in']);
    expect(ops(`const q = {};\nq.at = mongoose.trusted({ $lt: d });\nA.find(q);`)).toEqual([]);
    expect(ops(`const q = {};\nq.name = 'x';\nA.find(q);`)).toEqual([]);
  });
  it('follows spreads, conditionals and &&', () => {
    expect(ops(`A.find({ a: 1, ...(x ? { b: { $ne: 2 } } : {}) })`)).toEqual(['$ne']);
    expect(ops(`A.find({ a: 1, ...(x && { b: { $gt: 2 } }) })`)).toEqual(['$gt']);
    expect(ops(`A.find({ a: 1, ...(x ? { b: mongoose.trusted({ $gt: 2 }) } : {}) })`)).toEqual([]);
    expect(ops(`A.find(x ? { b: { $lt: 2 } } : {})`)).toEqual(['$lt']);
  });
});

describe('filters: what is NOT flagged', () => {
  it('accepts mongoose.trusted() in any layout, including across lines', () => {
    expect(ops(`A.find({ s: mongoose.trusted({ $ne: 'x' }) })`)).toEqual([]);
    expect(ops(`A.find({\n  s: mongoose.trusted({\n    $ne: 'x',\n    $exists: true,\n  }),\n})`)).toEqual([]);
    expect(ops(`A.find({ s: trusted({ $in: [1] }) })`)).toEqual([]);
    expect(ops(`A.find({ $text: mongoose.trusted({ $search: 'x' }) })`)).toEqual([]);
  });

  it('ignores update documents, pipelines and index definitions', () => {
    expect(ops(`A.updateOne({ _id: id }, { $set: { a: 1 }, $inc: { n: 1 }, $unset: { b: 1 } })`)).toEqual([]);
    expect(ops(`A.aggregate([{ $match: { s: { $ne: 'x' } } }, { $group: { _id: '$a' } }])`)).toEqual([]);
    expect(ops(`schema.index({ a: 1 }, { partialFilterExpression: { a: { $exists: true } } })`)).toEqual([]);
  });

  it('allows plain top-level $or/$and/$nor of plain fields', () => {
    expect(ops(`A.find({ $or: [{ a: 1 }, { b: 'x' }], $and: [{ c: 2 }] })`)).toEqual([]);
  });

  it('ignores comments, strings and non-query calls', () => {
    expect(ops(`// A.find({ s: { $ne: 'x' } })\nconst s = "A.find({ s: { $ne: 1 } })";`)).toEqual([]);
    expect(ops(`items.find((i) => i.id === 1); list.where({ a: 1 })`)).toEqual([]);
    expect(ops(`A.find({ email: 'a@b.c', status: 'active' })`)).toEqual([]);
  });
});
