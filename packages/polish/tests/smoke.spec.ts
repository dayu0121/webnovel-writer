import { describe, expect, it } from 'vitest';
import { pkg } from '../src/index';

describe('包冒烟', () => {
  it('可导入', () => {
    expect(pkg).toBeTruthy();
  });
});
