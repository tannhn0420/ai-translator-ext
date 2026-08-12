import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import ProgressApp from './ProgressApp.tsx'
import './progress.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProgressApp />
  </StrictMode>,
)
