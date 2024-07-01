import 'highlight.js/styles/github-dark.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './assets/styles/index.scss'
import './init'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)