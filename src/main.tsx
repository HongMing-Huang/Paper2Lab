import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xyflow/react/dist/style.css'
import 'mathlive/static.css'
import 'mathlive/fonts.css'
import './styles/paper.css'
import './styles/desk.css'
import { App } from './App'
import { SpikeApp } from './spike/SpikeApp'

const root = createRoot(document.getElementById('root')!)
if (location.hash === '#spike') {
  root.render(
    <StrictMode>
      <SpikeApp />
    </StrictMode>,
  )
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
