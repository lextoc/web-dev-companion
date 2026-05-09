import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import TerminalWindowApp from './TerminalWindowApp.vue'

const params = new URLSearchParams(window.location.search)
const RootComponent = params.get('window') === 'terminal' ? TerminalWindowApp : App

createApp(RootComponent).mount('#app').$nextTick(() => {
  // Use contextBridge
  window.ipcRenderer.on('main-process-message', (_event, message) => {
    console.log(message)
  })
})
