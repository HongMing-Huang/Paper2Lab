// Technology spike: a minimal React Flow desk embedding the three riskiest
// pieces (R3F instanced tubes inside a draggable node, Observable Plot with
// runtime-driven data, pdf.js page + text anchor highlight) plus a param
// slider wired through the Reactive Runtime. Verified in-browser before the
// full product canvas is built on top of the same view components.
import { useMemo } from 'react'
import { ReactFlow, Background, BackgroundVariant, type Node } from '@xyflow/react'
import { RuntimeProvider, useCell } from '../runtime/react'
import {
  kakeya,
  deltaCell,
  tubesCell,
  voxelCell,
} from '../paper/kakeyaGraph'
import { Tubes3DView } from '../canvas/views/Tubes3DView'
import { MultiplicityChart } from '../canvas/views/MultiplicityChart'
import { PaperPageView } from '../canvas/views/PaperPageView'
import { ParamSlider, ParamToggle } from '../canvas/controls/ParamSlider'
import { histogramRows } from '../kakeya/metrics'
import { PAPER_META } from '../paper/wangZahl'

function SpikeParamsNode() {
  return (
    <div className="sheet" style={{ width: 280 }}>
      <div className="sheet-label">SPIKE · PARAMETERS</div>
      <ParamSlider label="δ = 2^−e" paramId="kakeya.deltaExp" min={3} max={5.5} step={0.25} format={(v) => `2^−${v} = ${(2 ** -v).toFixed(4)}`} />
      <ParamSlider label="packing" paramId="kakeya.packing" min={0} max={1} step={0.05} format={(v) => v.toFixed(2)} />
      <ParamSlider label="N tubes" paramId="kakeya.nTubes" min={16} max={256} step={16} format={(v) => `${v}`} />
      <ParamSlider label="voxel res" paramId="kakeya.voxelRes" min={32} max={64} step={16} format={(v) => `${v}³`} />
      <ParamToggle label="voxel 视图" paramId="spike.showVoxels" labels={['tubes', 'voxels']} />
    </div>
  )
}

function Spike3DNode() {
  const tubes = useCell(tubesCell)
  const vox = useCell(voxelCell)
  const delta = useCell(deltaCell)
  const showVox = useCell<number>('spike.showVoxels')
  return (
    <div className="sheet" style={{ width: 380 }}>
      <div className="sheet-label">SPIKE · 3D δ-TUBES — δ = {delta.value?.toFixed(4)} {vox.stale ? '· computing…' : ''}</div>
      <Tubes3DView
        tubes={tubes.value ?? []}
        visGrid={vox.value?.result?.visGrid}
        visMaxM={vox.value?.result?.maxMultiplicity}
        showVoxels={!!showVox.value}
        height={300}
      />
    </div>
  )
}

function SpikeChartNode() {
  const vox = useCell(voxelCell)
  const rows = useMemo(
    () => (vox.value?.result ? histogramRows(vox.value.result).filter((r) => r.count > 0) : []),
    [vox.value],
  )
  return (
    <div className="sheet" style={{ width: 340 }}>
      <div className="sheet-label">SPIKE · MULTIPLICITY {vox.stale ? '· computing…' : ''}</div>
      <MultiplicityChart rows={rows} stale={vox.stale} />
      <div className="metric-row">
        |⋃T| = {(vox.value?.result?.occupiedVolume ?? 0).toFixed(4)} · Σ|T| = {(vox.value?.result?.sumTubeVolume ?? 0).toFixed(4)} · max m = {vox.value?.result?.maxMultiplicity ?? 0}
      </div>
    </div>
  )
}

function SpikePaperNode() {
  return (
    <div className="sheet" style={{ width: 300 }}>
      <div className="sheet-label">SPIKE · PDF PAGE + ANCHOR</div>
      <div style={{ maxHeight: 420, overflow: 'auto' }} className="nowheel">
        <PaperPageView url={PAPER_META.file} page={1} widthCss={280} highlightNeedle="Every Kakeya set in R" />
      </div>
    </div>
  )
}

const nodeTypes = {
  spikeParams: SpikeParamsNode,
  spike3D: Spike3DNode,
  spikeChart: SpikeChartNode,
  spikePaper: SpikePaperNode,
}

const nodes: Node[] = [
  { id: 'params', type: 'spikeParams', position: { x: 0, y: 0 }, data: {} },
  { id: 'tubes', type: 'spike3D', position: { x: 320, y: 0 }, data: {} },
  { id: 'chart', type: 'spikeChart', position: { x: 320, y: 420 }, data: {} },
  { id: 'paper', type: 'spikePaper', position: { x: 720, y: 0 }, data: {} },
]

kakeya.param('spike.showVoxels', 0)

export function SpikeApp() {
  return (
    <RuntimeProvider runtime={kakeya}>
      <div style={{ width: '100vw', height: '100vh' }}>
        <ReactFlow
          nodes={nodes}
          nodeTypes={nodeTypes}
          minZoom={0.2}
          maxZoom={4}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={26} size={1.5} color="#d8cfc0" bgColor="#faf6ee" />
        </ReactFlow>
      </div>
    </RuntimeProvider>
  )
}
