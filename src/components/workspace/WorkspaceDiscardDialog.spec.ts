import { shallowMount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import WorkspaceDiscardDialog from './WorkspaceDiscardDialog.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'workspace.confirmDiscard.selected') return `Discard ${params?.count}`
      if (key === 'workspace.confirmDiscard.selectedMore') return `and ${params?.count} more`
      if (key === 'workspace.confirmDiscard.file') return `Discard ${params?.file}`
      return key
    },
  }),
}))

describe('WorkspaceDiscardDialog', () => {
  it('shows a bounded path preview and forwards confirmation events', () => {
    const wrapper = shallowMount(WorkspaceDiscardDialog, {
      props: {
        request: {
          repoId: 'repo-a',
          kind: 'selected',
          paths: ['1', '2', '3', '4', '5', '6'],
        },
        loading: true,
      },
    })

    const dialog = wrapper.findComponent(ConfirmDialog)
    expect(dialog.props('visible')).toBe(true)
    expect(dialog.props('danger')).toBe(true)
    expect(dialog.props('loading')).toBe(true)
    expect(dialog.props('message')).toBe('Discard 6\n\n• 1\n• 2\n• 3\n• 4\n• 5\nand 1 more')

    dialog.vm.$emit('confirm')
    dialog.vm.$emit('cancel')
    expect(wrapper.emitted('confirm')).toHaveLength(1)
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('shows the captured file path for a single-file request', () => {
    const wrapper = shallowMount(WorkspaceDiscardDialog, {
      props: {
        request: {
          repoId: 'repo-a',
          kind: 'file',
          paths: ['src/exact-file.ts'],
        },
        loading: false,
      },
    })

    expect(wrapper.findComponent(ConfirmDialog).props('message')).toBe(
      'Discard src/exact-file.ts',
    )
  })
})
