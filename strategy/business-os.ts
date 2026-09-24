import { JsonStore } from '../memory/store.js';
import { generateBoundedExperiments, runPortfolioReview, type Opportunity } from './portfolio.js';

export class BusinessOS {
  constructor(private store = new JsonStore()) {}

  async createIdea(input: { name: string; hypothesis: string; budget?: number; maxLoss?: number }) {
    const [idea] = generateBoundedExperiments([{
      name: input.name,
      hypothesis: input.hypothesis,
      estimated_market: 'unknown',
      validation_method: 'bounded experiment'
    }], { max_test_budget: input.budget ?? 10000 });
    if (input.maxLoss != null) idea.max_loss = input.maxLoss;
    await this.store.update(s => { s.businesses.push(idea); });
    return idea;
  }

  async addMetric(businessId: string, metric: {
    revenue: number; direct_cost: number; operating_cost: number;
    acquisition_cost: number; conversions: number; customers: number; period_days: number;
  }) {
    return this.store.update(s => {
      const b = s.businesses.find(x => x.id === businessId);
      if (!b) throw new Error('business not found');
      const { recordMetric } = requireEngine();
      const updated = recordMetric(b, metric);
      Object.assign(b, updated);
    });
  }

  async review(policy: Parameters<typeof runPortfolioReview>[1] = {}) {
    return this.store.update(s => {
      const result = runPortfolioReview({ businesses: s.businesses, decisions: s.strategyDecisions }, policy);
      s.businesses = result.portfolio.businesses;
      s.strategyDecisions.push(...result.decisions);
      for (const d of result.decisions) {
        s.audit.push({
          id: this.store.id(),
          timestamp: d.created_at,
          agent: 'AI_BOSS',
          task: 'business_strategy_review',
          tool: 'adaptive_strategy_engine',
          result: d,
          retry: 0,
          status: d.decision === 'SHUTDOWN' ? 'DISABLED' : 'WORKING'
        });
      }
      return { businesses: s.businesses, decisions: result.decisions };
    });
  }

  async portfolio() {
    const s = await this.store.load();
    return { businesses: s.businesses, decisions: s.strategyDecisions.slice(-100) };
  }
}

function requireEngine() {
  return {
    recordMetric: (b: any, m: any) => {
      const profit = m.revenue - m.direct_cost - m.operating_cost - m.acquisition_cost;
      return {
        ...b,
        metrics: [...b.metrics, m],
        status: profit > 0 ? 'ACTIVE' : 'OPTIMIZING',
        consecutive_loss_periods: profit <= 0 ? b.consecutive_loss_periods + 1 : 0
      };
    }
  };
}
