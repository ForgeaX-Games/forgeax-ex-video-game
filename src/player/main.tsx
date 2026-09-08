import { createRoot } from 'react-dom/client'
import { detectSystemLocale, initLocaleSync } from '@/i18n'
import { RuntimeGameApp } from './RuntimeGameApp'
import './styles.css'

// A published game runs on its own CDN origin with no Studio host to hand it a
// locale, so URL/storage decide and an untouched browser follows its own
// language rather than the English source-of-truth default.
initLocaleSync(undefined, detectSystemLocale())

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root mount point')

createRoot(root).render(<RuntimeGameApp />)
