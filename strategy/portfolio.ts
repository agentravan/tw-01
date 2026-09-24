import { randomUUID } from 'node:crypto';
import type { BusinessIdea, BusinessStatus, StrategyPolicy, StrategyDecision } from './engine.js';
import { evaluateBusiness } from './engine.js';

export interface PortfolioState {
  businesses: BusinessIdea[];
  decisions: StrategyDecision[];
}

export interface Opportunity {
  name: string;
  hypothesis: string;
  estimated_market: string;
  validation_method: string;
}

export function generateBoundedExperiments(
  opportunities: Opportunity[],
  policy: Partial<StrategyPolicy> = {}
): BusinessIdea[] {
  const maxBudget = policy.max_test_budget ?? 10000;
  return opportunities.map(o => ({
    id: randomUUID(),
    name: o.name,
    hypothesis: o.hypothesis,
    status: 'IDEA' as BusinessStatus,
    created_at: new Date().toISOString(),
    strategy_version: 1,
    max_test_budget: maxBudget,
    max_loss: maxBudget,
    consecutive_loss_periods: 0,
    metrics: []
  }));
}

export function runPortfolioReview(
  portfolio: PortfolioState,
  policy: Partial<StrategyPolicy> = {}
): { portfolio: PortfolioState; decisions: StrategyDecision[] } {
  const decisions = portfolio.businesses.map(b => evaluateBusiness(b, policy));
  const updated = portfolio.businesses.map(b => {
    const d = decisions.find(x => x.business_id === b.id)!;
    const status: BusinessStatus = d.decision === 'SHUTDOWN' ? 'SHUTDOWN' :
      d.decision === 'SCALE' ? 'ACTIVE' :
      d.decision === 'PAUSE' ? 'PAUSED' :
      d.decision === 'CHANGE' ? 'OPTIMIZING' : 'VALIDATING';
    return { ...b, status, last_decision: d.decision, strategy_version: d.decision === 'CHANGE' ? b.strategy_version + 1 : b.strategy_version };
  });
  return { portfolio: { businesses: updated, decisions: [...portfolio.decisions, ...decisions] }, decisions };
}
