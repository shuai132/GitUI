import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import MarkdownPreview from './MarkdownPreview.vue'
import MarkdownCodeBlock from './MarkdownCodeBlock.vue'

const mocks = vi.hoisted(() => ({ render: vi.fn(), openUrl: vi.fn(), copy: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/mermaid', () => ({ MAX_MERMAID_CHARS: 20000, renderMermaid: mocks.render }))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: mocks.openUrl }))
vi.mock('@/composables/useGlobalToast', () => ({ useGlobalToast: () => ({ showError: mocks.error, showActionError: mocks.error, showToast: vi.fn() }) }))
function preview(text: string) { return mount(MarkdownPreview, { attachTo: document.body, props: { text, mermaidEnabled: true, highlight: true, remoteImages: false }, global: { plugins: [i18n] } }) }

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  mocks.render.mockReset().mockResolvedValue('data:image/svg+xml,graph')
  mocks.openUrl.mockReset().mockResolvedValue(undefined)
  mocks.copy.mockReset().mockResolvedValue(undefined)
  mocks.error.mockReset()
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mocks.copy } })
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

describe('Markdown preview interactions', () => {
  it('renders nested diagrams, copies source and can disable diagram rendering', async () => {
    const wrapper = preview('> ```mermaid\n> graph LR\n> A-->B\n> ```')
    await flushPromises()
    expect(wrapper.find('.mermaid-image').exists()).toBe(true)
    const code = wrapper.findComponent(MarkdownCodeBlock)
    const buttons = code.findAll('button')
    await buttons[buttons.length - 1].trigger('click')
    expect(mocks.copy).toHaveBeenCalledWith('graph LR\nA-->B')
    await wrapper.setProps({ mermaidEnabled: false })
    expect(wrapper.find('.mermaid-image').exists()).toBe(false)
    expect(wrapper.find('pre').text()).toBe('graph LR\nA-->B')
    wrapper.unmount()
  })
  it('cleans up code islands across document refreshes and never shows a stale render', async () => {
    let resolve!: (url: string) => void
    mocks.render.mockReturnValueOnce(new Promise<string>((done) => { resolve = done }))
    const wrapper = preview('```mermaid\ngraph LR\nA-->B\n```')
    await flushPromises()
    await wrapper.setProps({ text: '```ts\nconst latest = 1\n```\n\n# New title' })
    await flushPromises()
    resolve('data:image/svg+xml,obsolete')
    await flushPromises()
    expect(wrapper.findAllComponents(MarkdownCodeBlock)).toHaveLength(1)
    expect(wrapper.find('.mermaid-image').exists()).toBe(false)
    expect(wrapper.find('pre').text()).toBe('const latest = 1')
    expect(wrapper.find('h1').text()).toBe('New title')
    wrapper.unmount()
  })
  it('shows diagram errors and original source without breaking the rest of the document', async () => {
    mocks.render.mockRejectedValue(new Error('invalid diagram'))
    const wrapper = preview('```mermaid\ninvalid\n```\n\nText after error')
    await flushPromises()
    expect(wrapper.find('.diagram-error').exists()).toBe(true)
    expect(wrapper.find('pre').text()).toBe('invalid')
    expect(wrapper.text()).toContain('Text after error')
    wrapper.unmount()
  })
  it('opens external URLs with the opener and scopes heading navigation to the document', async () => {
    const wrapper = preview('# Title\n\n[local](#title) [external](https://example.com) [relative](./README.md)')
    await flushPromises()
    const links = wrapper.findAll('a')
    await links[0].trigger('click')
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled()
    await links[1].trigger('click')
    expect(mocks.openUrl).toHaveBeenCalledWith('https://example.com/')
    await links[2].trigger('keydown', { key: 'Enter' })
    expect(mocks.error).toHaveBeenCalled()
    expect(mocks.openUrl).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
})
