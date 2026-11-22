import { cpuCores, memoryGb, planUsd } from './mapping';

describe('mapping (cost gate)', () => {
  it('parses quantities', () => {
    expect(cpuCores('100m')).toBeCloseTo(0.1);
    expect(cpuCores('2')).toBe(2);
    expect(memoryGb('1Gi')).toBe(1);
    expect(memoryGb('512Mi')).toBe(0.5);
    expect(() => memoryGb('1Zi')).toThrow();
  });

  it('prices replicas x requests of Deployments and ignores the rest', () => {
    const pod = { containers: [{ resources: { requests: { cpu: '1', memory: '1Gi' } } }] };
    const plan = {
      steps: [
        { op: 'create', newState: { type: 'kubernetes:apps/v1:Deployment', inputs: { spec: { replicas: 2, template: { spec: pod } } } } },
        { op: 'delete', newState: { type: 'kubernetes:apps/v1:Deployment', inputs: { spec: { replicas: 9, template: { spec: pod } } } } },
        { op: 'create', newState: { type: 'kubernetes:core/v1:Secret', inputs: {} } },
      ],
    };
    // 2 x (0.04048 + 0.004445) x 730
    expect(planUsd(plan)).toBe(65.59);
  });
});
