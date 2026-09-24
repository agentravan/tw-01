import { JsonStore } from '../memory/store.js';
import { generateBoundedExperiments, runPortfolioReview } from './portfolio.js';
import { recordMetric } from './engine.js';

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
      if (b.status === 'SHUTDOWN') throw new Error('business is shut down; create a new bounded experiment to retry');
      if ([metric.revenue,metric.direct_cost,metric.operating_cost,metric.acquisition_cost,metric.conversions,metric.customers,metric.period_days].some(x => !Number.isFinite(x) || x < 0) || metric.period_days <= 0) throw new Error('invalid metric values');
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
