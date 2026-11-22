// HW #32 cost gate: Pulumi plan -> USD per month. Kubernetes objects in kind cost
// nothing by themselves, so what is priced is what a pod would reserve on a real
// node: resources.requests (cpu, memory) x replicas, at AWS Fargate on-demand rates,
// Linux/x86, us-east-1 (https://aws.amazon.com/fargate/pricing/, README ## CI/CD).
// Type-strippable on purpose (no enums/decorators): scripts/gate-cost.mjs runs it
// with node --experimental-strip-types, no build step.

export const RATES = { vcpuHourUsd: 0.04048, gbHourUsd: 0.004445, hoursPerMonth: 730 };

type Container = { resources?: { requests?: { cpu?: string; memory?: string } } };
type PodSpec = { containers?: Container[] };
type Workload = { spec?: { replicas?: number; template?: { spec?: PodSpec } } };
type Step = { op?: string; newState?: { type?: string; inputs?: Workload } };

// "100m" -> 0.1, "2" -> 2
export function cpuCores(q: string | undefined): number {
  if (!q) return 0;
  return q.endsWith('m') ? Number(q.slice(0, -1)) / 1000 : Number(q);
}

// "160Mi" -> GiB; binary and decimal suffixes, bare bytes
const MEM_UNITS: Record<string, number> = { Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, k: 1e3, M: 1e6, G: 1e9, T: 1e12 };
export function memoryGb(q: string | undefined): number {
  if (!q) return 0;
  const m = /^([0-9.]+)([A-Za-z]*)$/.exec(q);
  if (!m) throw new Error(`unparsed memory quantity: ${q}`);
  const unit = m[2] ? MEM_UNITS[m[2]] : 1;
  if (unit === undefined) throw new Error(`unknown memory unit: ${q}`);
  return (Number(m[1]) * unit) / 2 ** 30;
}

function podUsd(pod: PodSpec | undefined): number {
  return (pod?.containers ?? []).reduce((sum, c) => {
    const r = c.resources?.requests ?? {};
    return sum + (cpuCores(r.cpu) * RATES.vcpuHourUsd + memoryGb(r.memory) * RATES.gbHourUsd) * RATES.hoursPerMonth;
  }, 0);
}

// Long-running workloads only: a migration Job runs for seconds, not a month.
const workloadUsd = (i: Workload) => (i.spec?.replicas ?? 1) * podUsd(i.spec?.template?.spec);
const PRICED: Record<string, (inputs: Workload) => number> = {
  'kubernetes:apps/v1:Deployment': workloadUsd,
  'kubernetes:apps/v1:StatefulSet': workloadUsd,
};

/** Monthly USD of everything the plan leaves running (deleted resources are not counted). */
export function planUsd(plan: { steps?: Step[] }): number {
  const total = (plan.steps ?? []).reduce((sum, s) => {
    if (s.op === 'delete') return sum;
    const price = s.newState?.type ? PRICED[s.newState.type] : undefined;
    return price && s.newState?.inputs ? sum + price(s.newState.inputs) : sum;
  }, 0);
  return Math.round(total * 100) / 100;
}
