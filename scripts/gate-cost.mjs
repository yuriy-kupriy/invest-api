// HW #32 gate:cost — plan.json (pulumi preview --json) -> USD/month via
// src/mapping.ts -> compared with the budget. The verdict is computed: the same
// plan with COST_BUDGET_USD=0 fails and with 999999 passes.
//
//   PLAN_JSON=plan.json COST_BUDGET_USD=<usd> [COST_BYPASS=<label>] npm run gate:cost
// COST_BYPASS is set by CI only when the PR carries the bypass label (README ## CI/CD):
// the verdict is still printed, the exit code is 0.
import { readFileSync } from 'node:fs';
import { planUsd } from '../src/mapping.ts';

const { PLAN_JSON, COST_BUDGET_USD, COST_BYPASS } = process.env;
if (!PLAN_JSON || COST_BUDGET_USD === undefined || COST_BUDGET_USD === '' || Number.isNaN(Number(COST_BUDGET_USD))) {
  console.error('set PLAN_JSON=<pulumi preview --json output> and COST_BUDGET_USD=<number>');
  process.exit(2);
}
const budget = Number(COST_BUDGET_USD);
const plan = planUsd(JSON.parse(readFileSync(PLAN_JSON, 'utf8')));
const pass = plan <= budget;

console.log(`budget-usd=${budget}`);
console.log(`plan-usd=${plan}`);
console.log(`gate=${pass ? 'pass' : 'fail'}`);
if (!pass && COST_BYPASS) {
  console.log(`bypass=${COST_BYPASS}`);
  process.exit(0);
}
process.exit(pass ? 0 : 1);
