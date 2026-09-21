import { describe, expect, it } from 'vitest'
import { createIndexSelection, isNewerIndexView } from '../src/client/index-state'

describe('索引界面的会话与请求隔离', () => {
  it('不同会话选择不同书，不建立全局当前书状态', () => {
    const selection = createIndexSelection()
    selection.choose('session-a', 'book:a')
    selection.choose('session-b', 'book:b')
    expect(selection.get('session-a')).toBe('book:a')
    expect(selection.get('session-b')).toBe('book:b')
    selection.dispose()
    expect(selection.get('session-a')).toBeUndefined()
  })
  it('控制操作后的新代次不能被迟到轮询回退', () => {
    const newest = { generation: 5, updatedAt: 2000 }
    expect(isNewerIndexView(newest, { generation: 4, updatedAt: 3000 })).toBe(false)
    expect(isNewerIndexView(newest, { generation: 5, updatedAt: 1999 })).toBe(false)
    expect(isNewerIndexView(newest, { generation: 6, updatedAt: 2000 })).toBe(true)
  })
})
