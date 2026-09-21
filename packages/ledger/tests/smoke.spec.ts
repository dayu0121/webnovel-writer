import { describe, expect, it } from 'vitest'
import { queryDueLedger as coreQueryDueLedger, reconcileBookLedger as coreReconcileBookLedger } from '@webnovel/core'
import { pkg, planSettlement, queryDueLedger, queryLedger, reconcileBookLedger, reconcileLedger } from '../src/index'

describe('包冒烟', () => {
  it('可导入', () => {
    expect(pkg).toBeTruthy()
    expect(planSettlement).toBeTypeOf('function')
    expect(queryLedger).toBeTypeOf('function')
    expect(reconcileLedger).toBeTypeOf('function')
    expect(queryDueLedger).toBeTypeOf('function')
    expect(reconcileBookLedger).toBeTypeOf('function')
    expect(queryDueLedger).toBe(coreQueryDueLedger)
    expect(reconcileBookLedger).toBe(coreReconcileBookLedger)
  })
})
