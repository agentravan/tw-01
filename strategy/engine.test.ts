import { describe, expect, it } from 'vitest';
import { evaluateBusiness, recordMetric, type BusinessIdea } from './engine.js';

const base: BusinessIdea = {
  id: 'b1',
  name: 'Test Business',
  hypothesis: 'Customers will pay for the service.',
  status: 'VALIDATING',
  created_at: new Date().toISOString(),
  strategy_version: 1,
  max_test_budget: 10000,
  max_loss: 10000,
  consecutive_loss_periods: 0,
  metrics: []
};

describe('adaptive business strategy engine', () => {
  it('tests ideas with no data instead of pretending success', () => {
    expect(evaluateBusiness(base).decision).toBe('TEST');
  });

  it('scales a profitable business inside the target margin', () => {
    const b = recordMetric(base, { revenue: 10000, direct_cost: 3000, operating_cost: 1000, acquisition_cost: 1000, conversions: 20, customers: 20, period_days: 14 });
    expect(evaluateBusiness(b).decision).toBe('SCALE');
  });

  it('changes strategy before shutdown when the first bounded test loses money', () => {
    const b = recordMetric(base, { revenue: 1000, direct_cost: 800, operating_cost: 500, acquisition_cost: 300, conversions: 2, customers: 2, period_days: 14 });
    expect(evaluateBusiness(b).decision).toBe('CHANGE');
  });

  it('shuts down after repeated losses', () => {
    const b1 = recordMetric(base, { revenue: 1000, direct_cost: 800, operating_cost: 500, acquisition_cost: 300, conversions: 2, customers: 2, period_days: 14 });
    const b2 = recordMetric(b1, { revenue: 900, direct_cost: 700, operating_cost: 500, acquisition_cost: 300, conversions: 1, customers: 1, period_days: 14 });
    expect(evaluateBusiness(b2).decision).toBe('SHUTDOWN');
  });
});
