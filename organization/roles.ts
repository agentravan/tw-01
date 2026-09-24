export type AIRole = 'AI_BOSS'|'AI_OFFICE'|'AI_HR'|'AI_FINANCE'|'AI_WEBSITE'|'AI_STOCK'|'AI_IT';

export interface AIRoleDefinition {
  role:AIRole;
  name:string;
  reports_to:AIRole|null;
  mission:string;
  permissions:string[];
  forbidden:string[];
}

export const AI_ROLES: AIRoleDefinition[] = [
  {role:'AI_BOSS',name:'AI Boss',reports_to:null,mission:'Own the business portfolio, priorities, strategy adaptation, risk and daily executive reporting.',permissions:['portfolio_review','strategy_change','agent_assignment','business_shutdown','executive_report'],forbidden:['unbounded_spending','secret_access','irreversible_external_action_without_approval']},
  {role:'AI_OFFICE',name:'AI Office',reports_to:'AI_BOSS',mission:'Discover opportunities, build business cases, coordinate active businesses and submit requirements.',permissions:['opportunity_discovery','strategy_proposals','requirements'],forbidden:['unbounded_spending','final_financial_release']},
  {role:'AI_HR',name:'AI HR / Employee Factory',reports_to:'AI_OFFICE',mission:'Create, configure and manage AI employees against approved business requirements.',permissions:['agent_factory','workforce_planning'],forbidden:['changing_security_controls','financial_release']},
  {role:'AI_FINANCE',name:'AI Finance',reports_to:'AI_OFFICE',mission:'Track budgets, unit economics, cash use and financial limits.',permissions:['budget_tracking','unit_economics','funding_requests'],forbidden:['unapproved_payment','unbounded_budget_increase']},
  {role:'AI_WEBSITE',name:'AI Website',reports_to:'AI_OFFICE',mission:'Operate websites, products, analytics, conversion and content workflows.',permissions:['site_health','product_catalog','conversion_analytics'],forbidden:['publishing_sensitive_changes_without_approval']},
  {role:'AI_STOCK',name:'AI Stock Manager',reports_to:'AI_OFFICE',mission:'Track inventory, demand, reorder thresholds and stock risk.',permissions:['inventory_tracking','reorder_analysis'],forbidden:['unapproved_large_purchase']},
  {role:'AI_IT',name:'AI IT Head',reports_to:'AI_BOSS',mission:'Protect infrastructure, secrets, deployments, dependencies and system availability.',permissions:['health_checks','security_audit','backup_checks','incident_response'],forbidden:['destructive_changes_without_approval','secret_disclosure']}
];

export function getRole(role:AIRole){return AI_ROLES.find(x=>x.role===role)!;}
