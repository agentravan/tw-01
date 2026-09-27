import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateBusiness, recordMetric, type BusinessIdea } from '../strategy/engine.js';
import { JsonStore } from '../memory/store.js';
import { BusinessOS } from '../strategy/business-os.js';

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'tw01-')), 'state.json');
const base: BusinessIdea = { id:'b1', name:'T', hypothesis:'H', status:'VALIDATING', created_at:new Date().toISOString(), strategy_version:1, max_test_budget:10000, max_loss:10000, consecutive_loss_periods:0, metrics:[] };
const loss = { revenue:1000, direct_cost:800, operating_cost:500, acquisition_cost:300, conversions:2, customers:2, period_days:14 };

describe('regression: strategy loss periods are counted once', () => {
  it('one loss period → CHANGE, not SHUTDOWN', () => {
    expect(evaluateBusiness(recordMetric(base, loss)).decision).toBe('CHANGE');
  });
  it('two consecutive loss periods → SHUTDOWN', () => {
    expect(evaluateBusiness(recordMetric(recordMetric(base, loss), loss)).decision).toBe('SHUTDOWN');
  });
  it('a profitable period resets the loss streak', () => {
    const win = { ...loss, revenue: 5000 };
    expect(evaluateBusiness(recordMetric(recordMetric(recordMetric(base, loss), win), loss)).decision).toBe('CHANGE');
  });
  it('a caller that forgot to bump the counter still gets the latest loss counted', () => {
    expect(evaluateBusiness({ ...base, metrics: [loss], consecutive_loss_periods: 0 }).decision).toBe('CHANGE');
  });
});

describe('regression: JSON store does not lose concurrent writes', () => {
  it('50 concurrent updates all persist', async () => {
    const store = new JsonStore(tmpFile());
    await Promise.all(Array.from({ length: 50 }, (_, i) => store.update(s => { s.memory.push({ id: String(i), kind: 'fact', text: 't' + i, tags: [], created_at: '' }); })));
    expect((await store.load()).memory.length).toBe(50);
  });
});

describe('regression: BusinessOS returns only its own result, never the whole store', () => {
  it('review() and addMetric() do not leak leads/audit', async () => {
    const store = new JsonStore(tmpFile());
    await store.update(s => { s.leads.push({ id:'secret-lead', company_name:'X', industry:'', location:'', source:'', lead_score:0, status:'NEW', created_at:'' }); });
    const os = new BusinessOS(store);
    const idea = await os.createIdea({ name: 'A', hypothesis: 'B' });
    const m: any = await os.addMetric(idea.id, loss);
    const r: any = await os.review();
    expect(JSON.stringify(m).includes('secret-lead')).toBe(false);
    expect(JSON.stringify(r).includes('secret-lead')).toBe(false);
    expect(r.decisions.length).toBe(1);
    expect(r.decisions[0].decision).toBe('CHANGE');
  });
});
