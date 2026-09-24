import { randomUUID } from 'node:crypto';

export type BusinessStatus = 'IDEA'|'VALIDATING'|'ACTIVE'|'OPTIMIZING'|'SHUTDOWN'|'PAUSED';
export type Decision = 'TEST'|'SCALE'|'CHANGE'|'PAUSE'|'SHUTDOWN';

export interface StrategyMetric {
  revenue: number;
  direct_cost: number;
  operating_cost: number;
  acquisition_cost: number;
  conversions: number;
  customers: number;
  period_days: number;
}

export interface BusinessIdea {
  id: string;
  name: string;
  hypothesis: string;
  status: BusinessStatus;
  created_at: string;
  strategy_version: number;
  max_test_budget: number;
  max_loss: number;
  consecutive_loss_periods: number;
  metrics: StrategyMetric[];
  last_decision?: Decision;
}

export interface StrategyDecision {
  id: string;
  business_id: string;
  decision: Decision;
  reason: string;
  next_action: string;
  created_at: string;
}

export interface StrategyPolicy {
  min_profit_margin: number;
  max_loss_periods: number;
  min_validation_days: number;
  max_test_budget: number;
}

const defaults: StrategyPolicy = {
  min_profit_margin: 0.10,
  max_loss_periods: 2,
  min_validation_days: 7,
  max_test_budget: 10000
};

export function evaluateBusiness(
  business: BusinessIdea,
  policy: Partial<StrategyPolicy> = {}
): StrategyDecision {
  const p = { ...defaults, ...policy };
  const latest = business.metrics.at(-1);

  if (!latest) {
    return decision(business, 'TEST', 'No performance data exists yet.', 'Run a bounded validation experiment and collect revenue/cost/conversion data.');
  }

  const totalCost = latest.direct_cost + latest.operating_cost + latest.acquisition_cost;
  const profit = latest.revenue - totalCost;
  const margin = latest.revenue > 0 ? profit / latest.revenue : -1;

  if (profit > 0 && margin >= p.min_profit_margin) {
    return decision(business, 'SCALE', `Positive profit of ${profit.toFixed(2)} with ${(margin * 100).toFixed(1)}% margin.`, 'Scale only within the approved risk/budget envelope and continue measuring unit economics.');
  }

  if (profit > 0) {
    return decision(business, 'CHANGE', `Profitable but margin is below the ${(p.min_profit_margin * 100).toFixed(0)}% target.`, 'Optimize pricing, acquisition cost, delivery cost, or product mix before scaling.');
  }

  if (latest.period_days < p.min_validation_days) {
    return decision(business, 'TEST', 'Insufficient validation period to make a shutdown decision.', 'Continue a bounded experiment without increasing the approved loss limit.');
  }

  const nextLossPeriods = business.consecutive_loss_periods + 1;

  if (nextLossPeriods >= p.max_loss_periods || Math.abs(profit) >= business.max_loss) {
    return decision(business, 'SHUTDOWN', `Loss remains unacceptable after strategy iteration or exceeded the maximum loss limit.`, 'Stop new spending, preserve the experiment data, record the shutdown reason, and redirect resources to other opportunities.');
  }

  return decision(business, 'CHANGE', `Current period is loss-making by ${Math.abs(profit).toFixed(2)}.`, 'Change one or more controllable variables, start a bounded experiment, and re-measure before committing additional resources.');
}

export function recordMetric(business: BusinessIdea, metric: StrategyMetric): BusinessIdea {
  const profit = metric.revenue - metric.direct_cost - metric.operating_cost - metric.acquisition_cost;
  const next = {
    ...business,
    metrics: [...business.metrics, metric],
    status: profit > 0 ? 'ACTIVE' as BusinessStatus : 'OPTIMIZING' as BusinessStatus,
    consecutive_loss_periods: profit <= 0 ? business.consecutive_loss_periods + 1 : 0
  };
  return next;
}

function decision(business: BusinessIdea, d: Decision, reason: string, next_action: string): StrategyDecision {
  return {
    id: randomUUID(),
    business_id: business.id,
    decision: d,
    reason,
    next_action,
    created_at: new Date().toISOString()
  };
}
