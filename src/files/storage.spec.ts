import { MAX_PARTS, MIN_PART, partPlan } from './storage';

const MiB = 1024 * 1024;

describe('partPlan', () => {
  it('cuts the 11 MiB demo file into 5 + 5 + 1 MiB', () => {
    expect(partPlan(11 * MiB)).toEqual({ partSize: 5 * MiB, partCount: 3 });
  });

  it.each([11 * MiB, 50 * 1024 * MiB, 50 * 1024 * MiB + 1, 49_999 * MiB])(
    'keeps %d bytes within S3 limits',
    (size) => {
      const { partSize, partCount } = partPlan(size);
      expect(partCount).toBeLessThanOrEqual(MAX_PARTS);
      expect(partSize).toBeGreaterThanOrEqual(MIN_PART); // every part but the last is partSize
      expect(partSize * partCount).toBeGreaterThanOrEqual(size);
      expect(partSize * (partCount - 1)).toBeLessThan(size); // no empty last part
    },
  );
});
