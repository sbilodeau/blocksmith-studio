import { describe, expect, it } from 'vitest'
import { patchAria } from '@renderer/services/a11y'

const LABELS = { decrease: 'Decrease', increase: 'Increase' }

function html(markup: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = markup
  return root
}

describe('patchAria', () => {
  it('gives card titles a heading level and drops the duplicate outer heading', () => {
    const root = html(
      '<div class="n-card-header" role="heading"><div class="n-card-header__main" role="heading">T</div></div>' +
        '<div role="heading" aria-level="3">Kept</div>'
    )
    patchAria(root, LABELS)
    expect(root.querySelector('.n-card-header')!.hasAttribute('role')).toBe(false)
    expect(root.querySelector('.n-card-header__main')!.getAttribute('aria-level')).toBe('2')
    expect(root.querySelector('[aria-level="3"]')).not.toBeNull()
  })

  it('names slider handles, number input buttons and marked scroll areas', () => {
    const root = html(
      '<div class="n-slider" aria-label="Opacity"><div role="slider"></div></div>' +
        '<div class="n-input-number"><div class="n-input__suffix"><button></button><button></button></div></div>' +
        '<div data-a11y-scroll aria-label="Chat"><div class="n-scrollbar-container"></div></div>'
    )
    patchAria(root, LABELS)
    expect(root.querySelector('[role="slider"]')!.getAttribute('aria-label')).toBe('Opacity')
    const [minus, plus] = root.querySelectorAll('button')
    expect(minus!.getAttribute('aria-label')).toBe('Decrease')
    expect(plus!.getAttribute('aria-label')).toBe('Increase')
    const scroll = root.querySelector('.n-scrollbar-container')!
    expect(scroll.getAttribute('tabindex')).toBe('0')
    expect(scroll.getAttribute('aria-label')).toBe('Chat')

    // A language change replaces only the labels set here.
    patchAria(root, { decrease: 'Diminuer', increase: 'Augmenter' }, true)
    expect(minus!.getAttribute('aria-label')).toBe('Diminuer')
    const own = html(
      '<div class="n-input-number"><div class="n-input__suffix"><button aria-label="Less"></button><button></button></div></div>'
    )
    patchAria(own, LABELS, true)
    expect(own.querySelector('button')!.getAttribute('aria-label')).toBe('Less')
  })
})
