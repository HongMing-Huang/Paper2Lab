import { useRef, useState } from 'react'
import { Panel, useReactFlow } from '@xyflow/react'
import { useCell } from '../runtime/react'
import { kakeya, voxelCell } from '../paper/kakeyaGraph'
import { deskBus, requestAddNode } from '../paper/forks'
import { validateSkillInput } from '../skills/registry'
import { KAKEYA_SEED } from '../skills/executor'

const SAVE_KEY = 'paper2lab-kakeya-demo-v1'

/** Presentation controls operate the existing world; they never own its math. */
export function DemoGuide() {
  const exact = useCell(voxelCell)
  const { fitView, getNode } = useReactFlow()
  const [notice, setNotice] = useState('从论文出发：保持管数和粗细，改变排列，观察占据空间如何变化。')
  const file = useRef<HTMLInputElement>(null)
  const run = exact.status === 'resolved' ? exact.value : null
  const settled = run?.status === 'resolved' && run.spec.kind === 'kakeya.voxel' &&
    ['deltaExp', 'nTubes', 'packing'].every((key) => run.spec.params[key] === kakeya.get(`kakeya.${key}`).value) &&
    run.spec.res === kakeya.get('kakeya.voxelRes').value

  const focus = async (id: string) => {
    // Wait for the requested existing ReactFlow node to mount before focusing.
    for (let i = 0; i < 20; i++) {
      if (getNode(id)) {
        const fitted = await fitView({ nodes: [{ id }], padding: 0.22, maxZoom: 1.1, duration: 500 })
        if (fitted) return
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    setNotice('画面尚未准备好，请再选择一次。')
  }
  const save = () => {
    if (!settled || !run) { setNotice('等待当前参数的正式计算完成，预览不能保存为正式结果。'); return }
    const content = JSON.stringify({ format: SAVE_KEY, run }, null, 2)
    try { localStorage.setItem(SAVE_KEY, content) } catch { /* file export still works */ }
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = 'paper2lab-kakeya-session.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setNotice('已下载正式结果和参数；恢复时通过同一内核重新计算，不直接显示导入文件里的数值。')
  }
  const restore = (content: string) => {
    try {
      const saved = JSON.parse(content)
      if (saved?.format !== SAVE_KEY || saved.run?.spec?.kind !== 'kakeya.voxel') throw new Error('请选择本演示导出的实验文件')
      const spec = saved.run.spec
      // This demo replays the current seeded kernel, not arbitrary archived engines.
      if (spec.seed !== KAKEYA_SEED) throw new Error('该文件的随机种子不属于当前模型')
      const input = { deltaExp: spec.params?.deltaExp, nTubes: spec.params?.nTubes, packing: spec.params?.packing, res: spec.res }
      const check = validateSkillInput('kakeya.measure', input)
      if (!check.ok) throw new Error(check.error)
      if (input.deltaExp < 3 || input.deltaExp > 5.5 || input.nTubes < 16 || input.nTubes > 256 || input.packing < 0 || input.packing > 1 || !Number.isInteger(input.res) || input.res < 16 || input.res > 96) throw new Error('参数超出演示交互预算：N 16–256，δ指数 3–5.5，packing 0–1，分辨率 16–96')
      kakeya.setParam('kakeya.deltaExp', input.deltaExp)
      kakeya.setParam('kakeya.nTubes', input.nTubes)
      kakeya.setParam('kakeya.packing', input.packing)
      kakeya.setParam('kakeya.voxelRes', input.res)
      deskBus.emit({ type: 'expand-lab' }); void focus('exp-3d')
      setNotice('已恢复合法参数；正式指标以重算后的 Run 为准。文件中的历史指标不参与计算或计分。')
    } catch (error) { setNotice(`恢复未完成：${error instanceof Error ? error.message : String(error)}`) }
  }
  return <Panel position="bottom-center" className="demo-guide" aria-label="论文实验演示导航">
    <div className="demo-guide-heading"><strong>从论文到亲手验证</strong><span>有限尺度计算 · 固定管束模型 · 不代表定理证明</span></div>
    <div className="demo-guide-actions">
      <button onClick={() => { void focus('paper-mode'); setNotice('先读问题与论文条件，再提出关于排列的猜测。') }}>① 论文问题</button>
      <button onClick={() => { deskBus.emit({ type: 'expand-lab' }); void focus('exp-3d'); setNotice('直接拖动三维管束或公式中的 packing。松手后读取正式 Run；双击三维区域可沉浸探索。') }}>② 操作三维实验</button>
      <button onClick={() => {
        deskBus.emit({ type: 'expand-lab' })
        requestAddNode({ id: 'challenge-1', type: 'challenge', position: { x: 820, y: 1120 }, data: {} })
        void focus('challenge-1'); setNotice('开局冻结 N、δ 和计算分辨率，再操作三维管束并提交。自动搜索是确定性基线，不是 Qwen。')
      }}>③ 尝试挑战</button>
      <a href="/papers/wang-zahl-kakeya3d.pdf" target="_blank" rel="noreferrer">论文原文 ↗</a>
      <button onClick={save} disabled={!settled}>保存正式结果</button>
      <button onClick={() => { try { const saved = localStorage.getItem(SAVE_KEY); if (saved) restore(saved); else file.current?.click() } catch { file.current?.click() } }}>继续上次实验</button>
      <button onClick={() => file.current?.click()}>读取实验文件</button>
    </div>
    <div className="demo-guide-status" role="status">{notice}</div>
    <div className="demo-guide-evidence">{settled && run ? `正式计算就绪 · ${run.engine}@${run.engineVersion} · ${run.runId}` : '计算更新中：请等待正式结果；预览不计分。'} · 参数恢复/文件保存仅限本机，未同步云端。</div>
    <input ref={file} hidden type="file" accept="application/json,.json" onChange={async (event) => {
      const selected = event.target.files?.[0]; event.target.value = ''
      if (!selected) return
      if (selected.size > 256 * 1024) { setNotice('实验文件超过 256 KB，未读取'); return }
      try { restore(await selected.text()) } catch { setNotice('无法读取实验文件') }
    }} />
  </Panel>
}
