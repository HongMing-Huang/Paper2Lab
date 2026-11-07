// preview entry — mounts PreviewApp; bundled standalone via esbuild (see
// build-preview.mjs). Not part of the product surface or the game window.
import { createRoot } from 'react-dom/client'
import { PreviewApp } from './PreviewApp'

const el = document.getElementById('root')
if (el) createRoot(el).render(<PreviewApp />)
