import React, { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, Check, CircleCheck, ExternalLink, FileText, Network, RefreshCw, Search, X, ZoomIn, ZoomOut } from 'lucide-react'
import type { ChapterView, StudyShelf } from '../study/types'
import { projectStoryGraph, type StoryGraph, type StoryGraphRecord } from '../study/graph-types'
import type { StudyUI } from './browser'
import type { EditorStore } from './store'
import { useEditor, useSession, useStudy } from './hooks'

type ViewProps = { sessionId: string; space: string; store: EditorStore; refresh: number }
// Older hosts expose the canonical phase '完成'; newer hosts return the actual finalized fact.
const finalized = (item: ChapterView['chapters'][number]) => item.finalized ?? item.status === '完成'
const short = (value: string, length: number) => Array.from(value).length > length ? Array.from(value).slice(0, length).join('') + '…' : value

function ChapterProgress({ sessionId, space, store, refresh }: ViewProps) {
  const data = useStudy<ChapterView>(sessionId, 'chapters', { space }, refresh)
  const [volume, setVolume] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(0)
  const chapters = data.value?.chapters ?? []
  const volumes = [...new Set(chapters.map(item => item.volume))].sort((a, b) => a - b)
  const latestVolume = volumes.at(-1) ?? 0
  const selectedVolume = volume ?? latestVolume
  const done = chapters.filter(item => finalized(item)).length
  const needle = query.trim().toLocaleLowerCase()
  const selected = chapters.filter(item => (selectedVolume === 0 || item.volume === selectedVolume)
    && (status === 'all' || (status === 'done' ? finalized(item) : !finalized(item)))
    && (!needle || (String(item.chapter).padStart(4, '0') + ' ' + item.title + ' ' + item.status).toLocaleLowerCase().includes(needle)))
  const pages = Math.max(1, Math.ceil(selected.length / 40))
  const current = Math.min(page, pages - 1)
  useEffect(() => setPage(0), [volume, query, status])
  if (data.error) return <p className="nw-error" role="alert">{data.error}</p>
  if (!data.value) return <p className="nw-empty">正在读取章节进度…</p>
  return <>
    <div className="nw-viz-overview">
      <div><span>全书章节</span><strong>{chapters.length}</strong></div><div><span>已定稿</span><strong>{done}</strong></div>
      <div><span>推进中</span><strong>{chapters.length - done}</strong></div><div><span>卷数</span><strong>{volumes.length}</strong></div>
      <progress aria-label="全书定稿进度" max={Math.max(1, chapters.length)} value={done} />
    </div>
    <div className="nw-viz-toolbar">
      <label className="nw-viz-search"><Search size={15} /><input aria-label="搜索章节" placeholder="全书搜索章号、标题或状态" value={query} onChange={event => { setQuery(event.target.value); if (event.target.value.trim()) setVolume(0) }} /></label>
      <select aria-label="筛选章节状态" value={status} onChange={event => setStatus(event.target.value)}><option value="all">全部状态</option><option value="active">推进中</option><option value="done">已定稿</option></select>
    </div>
    <nav className="nw-volume-tabs" aria-label="按卷筛选">
      <button type="button" aria-pressed={selectedVolume === 0} onClick={() => setVolume(0)}>全书</button>
      {volumes.map(number => <button type="button" key={number} aria-pressed={selectedVolume === number} onClick={() => setVolume(number)}>卷 {String(number).padStart(2, '0')}<small>{chapters.filter(item => item.volume === number).length}</small></button>)}
    </nav>
    <div className="nw-chapter-list" role="list" aria-label="章节进度列表">
      {selected.slice(current * 40, (current + 1) * 40).map(item => <button type="button" role="listitem" className="nw-chapter-line" key={JSON.stringify([item.volume, item.chapter, item.title])}
        disabled={!item.source} title={item.source ? '打开章节来源' : '暂无可打开的来源'} onClick={() => { if (item.source) void store.open(sessionId, item.source) }}>
        <span className="nw-chapter-order">{item.chapter > 0 ? String(item.chapter).padStart(4, '0') : '待编号'}</span>
        <span className="nw-chapter-title"><strong>{item.title}</strong>{selectedVolume === 0 ? <small>卷 {item.volume}</small> : null}</span>
        <span className={'nw-chapter-state ' + (finalized(item) ? 'is-done' : '')}>{finalized(item) ? '已定稿' : item.status}</span><ExternalLink size={13} />
      </button>)}
      {!selected.length ? <p className="nw-empty">没有符合筛选条件的章节。</p> : null}
    </div>
    <footer className="nw-viz-pagination"><span>{selected.length} 章 · 第 {current + 1} / {pages} 页</span>
      <button type="button" aria-label="上一页章节" disabled={current === 0} onClick={() => setPage(current - 1)}><ArrowLeft size={15} /></button>
      <button type="button" aria-label="下一页章节" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}><ArrowRight size={15} /></button>
    </footer>
  </>
}

function ShortStoryProgress({ sessionId, space, story, store }: { sessionId: string; space: string; story: StudyShelf['books'][number]; store: EditorStore }) {
  const [position, next = ''] = story.progress.split(' · 下一步：', 2)
  const steps = ['故事卡准备', '蓝图待确认', '可写', '起草中', '待审', '修订中', '定稿候选', '可交付', '已定稿'] as const
  const active = Math.max(0, steps.indexOf(position as (typeof steps)[number]))
  const open = (file: string) => store.open(sessionId, { space, path: file })
  return <section className="nw-story-board" aria-label={`短故事 ${story.name} 进度`}>
    <div className="nw-story-ledger"><small>SHORT STORY / {space.replace('story:', '')} · 番茄规则包 v{story.rulePack?.version ?? '—'}</small><h3>{story.name}</h3><p>{next}</p></div>
    <ol className="nw-story-steps">{steps.map((step, index) => <li key={step} className={index < active ? 'is-done' : index === active ? 'is-current' : ''}>
      <span>{index < active ? <Check size={13} /> : index === active ? <CircleCheck size={13} /> : index + 1}</span><strong>{step}</strong>
    </li>)}</ol>
    <div className="nw-story-actions">
      <button type="button" onClick={() => void open('作品卡.md')}><FileText size={14} />打开作品卡</button>
      <button type="button" onClick={() => void open('蓝图/故事蓝图.md')}><FileText size={14} />打开故事蓝图</button>
    </div>
    <p className="nw-story-note">短故事以整篇为生产单元，固定遵循 fanqie-short-story@1。审读、修订、交付检查与导出的精确结果由故事工具绑定规则包和文件 hash。</p>
  </section>
}
function layout(nodes: readonly StoryGraphRecord[], edges: readonly { from: string; to: string }[]) {
  const positions = new Map(nodes.map((node, index) => [node.id, {
    x: 440 + Math.cos(index * 2.39996) * (60 + 24 * Math.sqrt(index)),
    y: 260 + Math.sin(index * 2.39996) * (60 + 24 * Math.sqrt(index)),
  }]))
  for (let step = 0; step < 55; step++) {
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = positions.get(nodes[i]!.id)!, b = positions.get(nodes[j]!.id)!
      const dx = a.x - b.x, dy = a.y - b.y, distance = Math.max(12, Math.hypot(dx, dy))
      const force = Math.min(3, 1200 / (distance * distance))
      a.x += dx / distance * force; a.y += dy / distance * force; b.x -= dx / distance * force; b.y -= dy / distance * force
    }
    for (const edge of edges) {
      const a = positions.get(edge.from), b = positions.get(edge.to)
      if (!a || !b) continue
      const dx = b.x - a.x, dy = b.y - a.y, distance = Math.max(1, Math.hypot(dx, dy))
      const force = (distance - 125) * .012
      a.x += dx / distance * force; a.y += dy / distance * force; b.x -= dx / distance * force; b.y -= dy / distance * force
    }
    for (const p of positions.values()) { p.x += (440 - p.x) * .002; p.y += (260 - p.y) * .002 }
  }
  return positions
}

function RelationshipGraph({ sessionId, space, store, refresh }: ViewProps) {
  const data = useStudy<StoryGraph>(sessionId, 'graph', { space }, refresh)
  const [at, setAt] = useState<number>()
  const [reader, setReader] = useState(false)
  const [unknown, setUnknown] = useState(true)
  const [plans, setPlans] = useState(false)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string>()
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [drag, setDrag] = useState<{ x: number; y: number; originX: number; originY: number }>()
  const model = data.value
  const chapter = Math.min(at ?? model?.maxChapter ?? 1, model?.maxChapter ?? 1)
  const projected = useMemo(() => model ? projectStoryGraph(model, { chapter, reader, unknown, plans }) : undefined, [model, chapter, reader, unknown, plans])
  const needle = query.trim().toLocaleLowerCase()
  const matches = projected?.nodes.filter(node => !needle || (node.label + ' ' + node.kind + ' ' + node.status).toLocaleLowerCase().includes(needle)) ?? []
  const matchIds = new Set(matches.map(node => node.id))
  if (needle) for (const edge of projected?.edges ?? []) {
    if (matchIds.has(edge.from) || matchIds.has(edge.to)) { matchIds.add(edge.from); matchIds.add(edge.to) }
  }
  const visibleNodes = (projected?.nodes ?? []).filter(node => !needle || matchIds.has(node.id)).slice(0, 180)
  const ids = new Set(visibleNodes.map(node => node.id))
  const visibleEdges = (projected?.edges ?? []).filter(edge => ids.has(edge.from) && ids.has(edge.to))
  const positionKey = visibleNodes.map(node => node.id).join('\0') + visibleEdges.map(edge => edge.id).join('\0')
  const positions = useMemo(() => layout(visibleNodes, visibleEdges), [positionKey])
  const selected = projected?.nodes.find(node => node.id === picked) ?? projected?.edges.find(edge => edge.id === picked)
  const related = new Set(visibleEdges.filter(edge => edge.id === picked || edge.from === picked || edge.to === picked).flatMap(edge => [edge.from, edge.to]))
  if (data.error) return <p className="nw-error" role="alert">{data.error}</p>
  if (!model || !projected) return <p className="nw-empty">正在读取世界书与账本…</p>
  const focus = (node: StoryGraphRecord) => setPicked(previous => previous === node.id ? undefined : node.id)
  return <>
    <div className="nw-graph-time">
      <div><span>章节时间线</span><strong>第 {chapter} 章</strong><button type="button" onClick={() => setAt(model.maxChapter)}>回到最新</button></div>
      <input type="range" aria-label="图谱章节时间线" min={1} max={model.maxChapter} step={1} value={chapter} onChange={event => { setAt(Number(event.target.value)); setPicked(undefined) }} />
      <div className="nw-time-range"><span>第 1 章</span><span>第 {model.maxChapter} 章</span></div>
    </div>
    <div className="nw-viz-toolbar">
      <label className="nw-viz-search"><Search size={15} /><input aria-label="搜索图谱" placeholder="寻找人物、关系或线索" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <select aria-label="图谱信息视图" value={reader ? 'reader' : 'author'} onChange={event => setReader(event.target.value === 'reader')}><option value="author">作者记录</option><option value="reader">仅明确已披露</option></select>
    </div>
    <div className="nw-graph-options">
      <label><input type="checkbox" checked={unknown} disabled={reader} onChange={event => setUnknown(event.target.checked)} />显示时间未标注记录</label>
      <label><input type="checkbox" checked={plans} onChange={event => setPlans(event.target.checked)} />显示计划</label>
      <span>{visibleNodes.length} 个节点 · {visibleEdges.length} 条关联</span>
    </div>
    <div className="nw-graph-stage">
      {!model.records.length ? <div className="nw-graph-empty"><Network size={42} /><h3>暂无关系与事件记录</h3><p>人物关系与事件会随章节沉淀逐步呈现。</p></div>
        : !visibleNodes.length ? <div className="nw-graph-empty"><Network size={38} /><h3>当前范围没有匹配记录</h3><p>可调整章节、搜索词或信息视图；未注明披露章的记录不会进入“仅明确已披露”。</p></div>
          : <svg viewBox="0 0 880 520" aria-label="时间线关系图谱" onPointerDown={event => {
            if ((event.target as Element).closest('[data-graph-node]')) return
            event.currentTarget.setPointerCapture(event.pointerId); setDrag({ x: event.clientX, y: event.clientY, originX: pan.x, originY: pan.y })
          }} onPointerMove={event => { if (drag) { const rect = event.currentTarget.getBoundingClientRect(); setPan({ x: drag.originX + (event.clientX - drag.x) * 880 / rect.width, y: drag.originY + (event.clientY - drag.y) * 520 / rect.height }) } }}
            onPointerUp={() => setDrag(undefined)} onPointerCancel={() => setDrag(undefined)}>
            <g transform={'translate(' + pan.x + ',' + pan.y + ') translate(440,260) scale(' + zoom + ') translate(-440,-260)'}>
              {visibleEdges.map(edge => {
                const a = positions.get(edge.from)!, b = positions.get(edge.to)!
                return <g key={edge.id} data-graph-node="" role="button" tabIndex={0} aria-label={'关系：' + edge.label} onClick={() => focus(edge)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); focus(edge) } }} className={'nw-graph-edge ' + (edge.relation ? 'is-relation' : '')} opacity={picked && !related.has(edge.from) && !related.has(edge.to) ? .18 : 1}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} /><text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 6}>{short(edge.label, 12)}</text>
                </g>
              })}
              {visibleNodes.map(node => {
                const p = positions.get(node.id)!
                return <g key={node.id} data-graph-node="" role="button" tabIndex={0} aria-label={node.kind + '：' + node.label} aria-pressed={picked === node.id}
                  className={'nw-graph-node ' + (node.kind === '人物' ? 'is-person' : node.kind === '事件' ? 'is-event' : '') + (node.chapter === undefined ? ' is-undated' : '')}
                  transform={'translate(' + p.x + ',' + p.y + ')'} opacity={picked && picked !== node.id && !related.has(node.id) ? .3 : 1}
                  onClick={() => focus(node)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); focus(node) } }}>
                  <title>{node.label + ' · ' + node.kind + (node.status ? ' · ' + node.status : '')}</title>
                  <circle r={picked === node.id ? 26 : 22} /><text className="nw-node-kind" y={4}>{node.kind.slice(0, 1)}</text>
                  <text className="nw-node-label" y={40}>{short(node.label, 13)}</text>
                </g>
              })}
            </g>
          </svg>}
      <div className="nw-graph-zoom"><button type="button" aria-label="缩小图谱" onClick={() => setZoom(value => Math.max(.4, value - .2))}><ZoomOut size={16} /></button>
        <button type="button" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}>{Math.round(zoom * 100)}%</button>
        <button type="button" aria-label="放大图谱" onClick={() => setZoom(value => Math.min(3, value + .2))}><ZoomIn size={16} /></button></div>
      {selected ? <aside className="nw-graph-detail"><button type="button" className="nw-icon" aria-label="关闭图谱详情" onClick={() => setPicked(undefined)}><X size={14} /></button>
        <small>{selected.kind}{selected.plan ? ' · 计划' : ''}</small><h3>{selected.label}</h3><p>{selected.status || '未标注状态'} · {selected.chapter ? '第 ' + selected.chapter + ' 章记录' : '时间未标注'}</p>
        <p className="nw-graph-preview">{selected.preview || '无正文摘要'}</p><small>{selected.source.path} · 第 {selected.line} 行</small>
        <button type="button" className="nw-source-button" onClick={() => { void store.open(sessionId, selected.source) }}><ExternalLink size={13} />打开来源</button></aside> : null}
    </div>
    {projected.nodes.length > 180 ? <p className="nw-viz-note">当前显示前 180 个节点，可用搜索缩小范围。</p> : null}
    {projected.unknown || reader && projected.unrevealed ? <p className="nw-viz-note">{projected.unknown} 条记录未注明起始章；{reader ? projected.unrevealed + ' 条未注明披露章的记录已隐藏。' : '虚线节点表示时间未标注，不能据此认定关系在该章生效。'}</p> : null}
    {projected.events.length ? <section className="nw-graph-events"><h3>已记录事件 <small>{projected.events.length}</small></h3><div>
      {projected.events.slice(-40).map(event => <button type="button" key={event.id} onClick={() => { if (event.chapter) setAt(event.chapter); setPicked(event.id) }}>
        <small>{event.chapter ? '第 ' + event.chapter + ' 章' : '时间未标注'}</small><strong>{event.label}</strong></button>)}
    </div>{projected.events.length > 40 ? <p className="nw-viz-note">此处展示最近 40 条事件，可沿时间线回看更早记录。</p> : null}</section> : null}
    {model.warnings.length ? <details className="nw-viz-notes"><summary>资料提示 · {model.warnings.length}</summary><ul>{model.warnings.map((warning, index) => <li key={index}>{warning.path}：{warning.message}</li>)}</ul></details> : null}
  </>
}

function WorkspaceVisual({ sessionId, store }: { sessionId: string; store: EditorStore }) {
  const state = useEditor(store, sessionId)
  const shelf = useStudy<StudyShelf>(sessionId, 'shelf', {}, state.refresh)
  const books = shelf.value?.books.filter(book => !book.error) ?? []
  const [choice, setChoice] = useState('')
  const [mode, setMode] = useState<'graph' | 'chapters'>('graph')
  const defaultBook = books.find(book => book.kind === 'book') ?? books[0]
  const space = books.some(book => book.id === choice) ? choice : defaultBook?.id
  const selected = books.find(book => book.id === space)
  const isStory = selected?.kind === 'story'
  const title = isStory ? '短故事工作台' : mode === 'graph' ? '时间线关系图谱' : '章节进度'
  return <div className="nw-viz">
    <header className="nw-viz-header"><div><p>作品视图</p><h2>{title}</h2></div>
      <div className="nw-viz-header-actions"><select aria-label="选择可视化作品" value={space ?? ''} onChange={event => setChoice(event.target.value)}>{books.map(book => <option key={book.id} value={book.id}>{book.kind === 'story' ? '番茄短故事 · ' : '长篇 · '}{book.name}</option>)}</select>
        <button type="button" className="nw-icon" aria-label="刷新作品视图" onClick={() => store.update(sessionId, { refresh: state.refresh + 1 })}><RefreshCw size={16} /></button></div></header>
    {!isStory ? <div className="nw-viz-switch" role="group" aria-label="可视化视图"><button type="button" aria-pressed={mode === 'graph'} onClick={() => setMode('graph')}><Network size={15} />关系图谱</button>
      <button type="button" aria-pressed={mode === 'chapters'} onClick={() => setMode('chapters')}><BookOpen size={15} />章节进度</button></div> : null}
    {shelf.error ? <p className="nw-error">{shelf.error}</p> : null}
    {space && selected ? <div key={space}>{isStory
      ? <ShortStoryProgress sessionId={sessionId} space={space} story={selected} store={store} />
      : mode === 'graph' ? <RelationshipGraph {...{ sessionId, space, store, refresh: state.refresh }} /> : <ChapterProgress {...{ sessionId, space, store, refresh: state.refresh }} />}</div>
      : <p className="nw-empty">{shelf.loading ? '正在读取作品…' : '当前工作范围暂无作品。'}</p>}
  </div>
}

export function VisualView({ host, store }: StudyUI) {
  const sessionId = useSession(host)
  return <div className="webnovel nw-visual-root" data-conversation-composer-overlay="">{sessionId ? <WorkspaceVisual key={sessionId} {...{ sessionId, store }} /> : <p className="nw-empty">请先打开一个工作区会话</p>}</div>
}
