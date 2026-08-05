import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import FlashcardsApp from './FlashcardsApp.tsx'
import './flashcards.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FlashcardsApp />
  </StrictMode>,
)
