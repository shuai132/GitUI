import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './assets/main.css'
// 主题感知的 highlight.js 样式：浅/深色各一套 token 色，替代写死的 github-dark
import './assets/highlight-theme.css'
// 触发 settings 模块顶层 side-effect：同步从 localStorage 读取并 apply
// 到 :root（CSS 变量 + data-theme），需发生在 Vue 挂载之前以避免 FOUC。
import './stores/settings'
import { i18n } from './i18n'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(i18n)
app.mount('#app')
