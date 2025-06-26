import React from 'react'
import { createRoot } from 'react-dom/client'
import Overlay from './index'

const container = document.getElementById('overlay-root')
if (container) {
  const root = createRoot(container)
  root.render(React.createElement(Overlay))
} else {
  console.error('Could not find overlay-root element')
} 