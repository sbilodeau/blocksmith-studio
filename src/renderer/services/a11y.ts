/**
 * Accessibility fixes for Naive UI markup the app cannot reach through props (M11 accessibility pass):
 *
 * - Cards mark both the header and its title as `role="heading"` without `aria-level`: the outer one loses the role,
 *   the title becomes a level 2 heading.
 * - Slider handles (`role="slider"`) get the `aria-label` given to their `n-slider` (`:aria-label` lands on the
 *   slider's root element).
 * - The - / + buttons of number inputs get names.
 * - Scroll areas marked `data-a11y-scroll` (on an `n-scrollbar`) can take the keyboard focus, so they can be scrolled
 *   with the arrow keys.
 *
 * Labels set here carry `data-a11y-auto` so a language change can replace them.
 */

export interface AriaLabels {
  decrease: string
  increase: string
}

const AUTO = 'data-a11y-auto'

function setLabel(el: Element, label: string, force: boolean): void {
  if (el.hasAttribute('aria-label') && !(force && el.hasAttribute(AUTO))) return
  el.setAttribute('aria-label', label)
  el.setAttribute(AUTO, '')
}

/** Applies the fixes below `root`. `force` re-labels what an earlier call labeled (language change). */
export function patchAria(root: ParentNode, labels: AriaLabels, force = false): void {
  for (const el of root.querySelectorAll('[role="heading"]:not([aria-level])')) {
    if (el.classList.contains('n-card-header') && el.querySelector('[role="heading"]'))
      el.removeAttribute('role')
    else el.setAttribute('aria-level', '2')
  }
  for (const slider of root.querySelectorAll('.n-slider[aria-label]')) {
    const label = slider.getAttribute('aria-label')!
    for (const handle of slider.querySelectorAll('[role="slider"]')) setLabel(handle, label, true)
  }
  for (const area of root.querySelectorAll('[data-a11y-scroll]')) {
    const container = area.querySelector('.n-scrollbar-container')
    if (container && !container.hasAttribute('tabindex')) {
      container.setAttribute('tabindex', '0')
      const label = area.getAttribute('aria-label')
      if (label) container.setAttribute('aria-label', label)
    }
  }
  for (const input of root.querySelectorAll('.n-input-number')) {
    const buttons = input.querySelectorAll('.n-input__suffix button, .n-input__prefix button')
    if (buttons.length !== 2) continue
    setLabel(buttons[0]!, labels.decrease, force)
    setLabel(buttons[1]!, labels.increase, force)
  }
}

/**
 * Keeps `root` patched: runs once, then after every DOM change (batched per animation frame). Returns a function
 * that re-labels everything (call it when the language changes) and the disconnect function.
 */
export function watchAria(
  root: HTMLElement,
  labels: () => AriaLabels
): { relabel(): void; stop(): void } {
  let raf = 0
  const run = (force = false): void => patchAria(root, labels(), force)
  const observer = new MutationObserver(() => {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      run()
    })
  })
  run()
  observer.observe(root, { childList: true, subtree: true })
  return {
    relabel: () => run(true),
    stop: () => {
      observer.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }
}
