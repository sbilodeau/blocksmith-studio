import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import MarkdownView from '@renderer/components/common/MarkdownView.vue'
import UpdateActions from '@renderer/components/UpdateActions.vue'
import WhatsNewOnLaunch from '@renderer/components/WhatsNewOnLaunch.vue'
import { createAppI18n } from '@renderer/i18n'
import { changelogNotes, noteLinkUrl } from '@renderer/services/changelog'
import { useUpdaterStore } from '@renderer/stores/updater'
import { fakeBridge } from './setup'

function mountWith(component: ReturnType<typeof defineComponent>): ReturnType<typeof mount> {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(component, {
    global: { plugins: [pinia, createAppI18n()] },
    attachTo: document.body
  })
}

describe('release notes', () => {
  let wrapper: ReturnType<typeof mount> | null = null

  beforeEach(() => {
    fakeBridge.calls = []
    fakeBridge.whatsNew = null
    fakeBridge.updater = { state: 'disabled', reason: 'dev' }
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    document.body.innerHTML = ''
  })

  it('renders Markdown as elements, never as HTML, and opens links outside the app', async () => {
    wrapper = mountWith(
      defineComponent(
        () => () =>
          h(MarkdownView, {
            source:
              '### Title\n\n- **Bold** and `code` <img src=x onerror=alert(1)>\n- [Docs](docs/performance.md)'
          })
      )
    )
    expect(wrapper.find('h5').text()).toBe('Title')
    expect(wrapper.find('strong').text()).toBe('Bold')
    expect(wrapper.find('code').text()).toBe('code')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>')

    const link = wrapper.find('a')
    expect(link.attributes('href')).toBe(
      'https://github.com/sbilodeau/blocksmith-studio/blob/main/docs/performance.md'
    )
    await link.trigger('click')
    expect(fakeBridge.calls).toContainEqual({
      channel: 'app.openExternal',
      payload: {
        url: 'https://github.com/sbilodeau/blocksmith-studio/blob/main/docs/performance.md'
      }
    })
  })

  it('only links https and repository paths', () => {
    expect(noteLinkUrl('https://example.org/a')).toBe('https://example.org/a')
    expect(noteLinkUrl('./docs/x.md')).toBe(
      'https://github.com/sbilodeau/blocksmith-studio/blob/main/docs/x.md'
    )
    expect(noteLinkUrl('http://example.org')).toBeNull()
    expect(noteLinkUrl('javascript:alert(1)')).toBeNull()
    expect(noteLinkUrl('#top')).toBeNull()
  })

  it('joins several versions with their own headings', () => {
    const text =
      '## Unreleased\n\n## 26.48.0 - 2026-11-24\n\n- B\n\n## 26.47.0 - 2026-11-17\n\n- A\n\n## 26.46.0\n\n- Old\n'
    expect(changelogNotes('26.46.0', '26.48.0', text)).toBe(
      '## 26.48.0 - 2026-11-24\n\n- B\n\n## 26.47.0 - 2026-11-17\n\n- A'
    )
    expect(changelogNotes('26.47.0', '26.48.0', text)).toBe('- B')
    expect(changelogNotes('26.48.0', '26.48.0', text)).toBe('')
  })

  it('shows what changed after an update, once, from the bundled changelog', async () => {
    fakeBridge.whatsNew = { previousVersion: null, version: '26.46.0' }
    wrapper = mountWith(WhatsNewOnLaunch)
    await flushPromises()
    expect(document.body.textContent).toContain('Updated to 26.46.0')
    // 26.46.0 shipped M0: its changelog section is bundled.
    expect(document.querySelector('[data-testid="whats-new-notes"]')?.textContent).toContain(
      'Electron + Vue 3 + TypeScript app scaffold'
    )
  })

  it('shows nothing when the launch does not follow an update', async () => {
    wrapper = mountWith(WhatsNewOnLaunch)
    await flushPromises()
    expect(fakeBridge.calls.map((c) => c.channel)).toContain('app.whatsNew')
    expect(document.querySelector('[data-testid="whats-new-dialog"]')).toBeNull()
  })

  it('offers the new version notes next to the download button', async () => {
    fakeBridge.updater = {
      state: 'available',
      version: '26.47.0',
      mode: 'manual',
      releaseNotes: '### M12 - Releases\n\n- Release notes in the app'
    }
    wrapper = mountWith(UpdateActions)
    await useUpdaterStore().init()
    await flushPromises()
    expect(wrapper.find('[data-testid="update-download"]').exists()).toBe(true)
    await wrapper.find('[data-testid="update-notes"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain("What's new in 26.47.0")
    expect(document.body.textContent).toContain('Release notes in the app')
  })

  it('hides the notes button when the update has no notes', async () => {
    fakeBridge.updater = { state: 'available', version: '26.47.0', mode: 'auto' }
    wrapper = mountWith(UpdateActions)
    await useUpdaterStore().init()
    await flushPromises()
    expect(wrapper.find('[data-testid="update-download"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="update-notes"]').exists()).toBe(false)
  })
})
