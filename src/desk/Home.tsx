// The home: one question box, one upload. CLI-151b 按用户指令重做——首页只
// 保留主要入口：「上传论文，你想理解或尝试什么？」；拖入即进论文研究空间
// （原文立即可读、按需精读、候选→真实计算）。实验室入口收进折叠区，
// 不再以链接墙形式堆在第一屏。
import { useEffect, useRef, useState } from 'react'
import type { IngestMode } from '../ingest/upload'
import type { StudyPayload } from '../study/types'

export function Home({
  onStudy,
  onKakeya,
  onPhysics,
  onChallenges,
  onResearch,
}: {
  onStudy: (payload: StudyPayload) => void
  onKakeya: () => void
  onPhysics: () => void
  onChallenges: () => void
  onResearch: () => void
}) {
  const [question, setQuestion] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // parse engine for on-demand reads; switchable inside the study space too
  const mode = useRef<IngestMode>('vlm').current

  const handleFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('请拖入 PDF 论文（0.1 支持 .pdf）')
      return
    }
    onStudy({ file, pdfUrl: URL.createObjectURL(file), mode, droppedAt: performance.now(), initialQuestion: question.trim() || undefined })
  }

  // 粘贴上传：部分宿主（如 ZCode 内置预览浏览器）的 webview 弹不出系统文件
  // 选择框，点击"选择文件"表现为无反应。在电脑上复制 PDF 后 ⌘V/Ctrl+V 即可
  // 进入。只拦截带文件的粘贴；纯文本粘贴（问题输入框）不受影响。
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = e.clipboardData?.files?.[0]
      if (!file) return // 普通文本粘贴走默认行为
      e.preventDefault()
      handleFile(file)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
    // question 变化时重订阅，保证粘贴进入研究空间时携带最新提问
  }, [question, onStudy])

  return (
    <div
      className={`home-root${dragOver ? ' drag-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const file = e.dataTransfer.files?.[0]
        if (file) handleFile(file)
      }}
    >
      <div className="home-card">
        <div className="home-title">Paper2Lab</div>
        <div className="home-sub">
          上传一篇数学论文，围绕你自己的问题研究它——原文立即可读，
          选中公式即可形成带来源的数学请求并真实计算，还能进入可操作世界。
        </div>
        <textarea
          className="home-question"
          data-testid="home-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="上传论文，你想理解或尝试什么？（例：阻尼什么时候让振动停止？把 β 减半会怎样？）"
          rows={2}
          onKeyDown={(e) => {
            // Esc releases focus; the textarea never swallows it silently
            if (e.key === 'Escape') e.currentTarget.blur()
          }}
        />
        <button
          type="button"
          className="home-drop"
          data-testid="home-upload"
          onClick={() => inputRef.current?.click()}
        >
          拖入论文 PDF，或点击选择
        </button>
        <div
          style={{ fontSize: 11, color: '#6b6154', marginTop: 4, lineHeight: 1.5 }}
          data-testid="home-upload-hint"
        >
          预览面板里点选弹不出系统文件框？把 PDF 直接拖进本页，或在电脑上复制文件后 ⌘V / Ctrl+V 粘贴。
        </div>
        <div className="home-foot">
          原文 PDF.js 立即渲染 · 精读按页进行 · 计算经真实任务落 PostgreSQL Run · 每个数字可回溯源句
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleFile(file)
          }}
        />
        {error && (
          <div className="home-error">
            {error}
            <button type="button" className="desk-btn" onClick={() => setError(null)}>知道了</button>
          </div>
        )}
        <details className="home-more">
          <summary>更多入口（内置案例与工具间）</summary>
          <div className="home-more-links">
            <a href="/?demo=kakeya">论文三维实验演示（可保存继续）</a>
            <a href="/mathworld.html?world=kakeya-room-basic">方向之室 · Wang–Zahl δ-管族</a>
            <button type="button" onClick={onResearch}>研究控制台（Qwen 经 DSH 调真实科学工具）</button>
            <button type="button" onClick={onKakeya}>Kakeya Lab（内置论文 · 3D 专用 Adapter）</button>
            <button type="button" onClick={onPhysics}>Physics Lab（MuJoCo · 真物理）</button>
            <button type="button" onClick={onChallenges}>Challenges（投射 · 摆周期 · 管束压缩）</button>
          </div>
          <div className="home-more-note">
            解析引擎（快速理解 AI 读图 / 精读定位 Docling）在论文研究空间内按页选择；默认快速理解。
          </div>
        </details>
      </div>
    </div>
  )
}
