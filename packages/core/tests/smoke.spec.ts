import { describe, expect, it } from 'vitest';
import { paths } from '../src/index';

describe('包冒烟', () => {
  it('可导入', () => {
    expect(paths.契约()).toBe('作品契约/契约.md');
  });
});
