import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './net'
import './styles.css'
import { unlockAudio } from './audio'

// Browsers gate audio behind a user gesture — arm it on the first tap/click.
window.addEventListener('pointerdown', () => unlockAudio(), { once: true })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
