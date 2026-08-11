import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import DictationApp from './DictationApp.tsx'
import './dictation.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DictationApp />
  </StrictMode>,
)
