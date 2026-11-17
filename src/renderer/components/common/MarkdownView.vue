<script setup lang="ts">
import { computed, h, type VNode } from 'vue'
import { parseMarkdown, type Block, type Inline } from '@shared/markdown'
import { noteLinkUrl } from '../../services/changelog'
import { call } from '../../services/ipc'

/** Renders release notes (a Markdown subset) as Vue nodes: no HTML from the notes ever reaches the page. */
const props = defineProps<{ source: string }>()

const blocks = computed(() => parseMarkdown(props.source))

function open(url: string): void {
  void call('app.openExternal', { url }).catch(() => undefined)
}

function inline(nodes: Inline[]): (VNode | string)[] {
  return nodes.map((node): VNode | string => {
    switch (node.kind) {
      case 'text':
        return node.text
      case 'strong':
        return h('strong', inline(node.children))
      case 'em':
        return h('em', inline(node.children))
      case 'code':
        return h('code', node.text)
      case 'link': {
        const url = noteLinkUrl(node.href)
        if (!url) return h('span', inline(node.children))
        return h(
          'a',
          {
            href: url,
            onClick: (event: MouseEvent) => {
              event.preventDefault()
              open(url)
            }
          },
          inline(node.children)
        )
      }
    }
  })
}

function block(node: Block): VNode {
  switch (node.kind) {
    case 'heading':
      // Release notes sit inside a dialog: start at h3 so they never compete with its title.
      return h(`h${Math.min(6, node.level + 2)}`, inline(node.children))
    case 'paragraph':
      return h('p', inline(node.children))
    case 'list':
      return h(
        'ul',
        node.items.map((item) => h('li', inline(item)))
      )
  }
}

const Notes = (): VNode[] => blocks.value.map(block)
</script>

<template>
  <div class="markdown">
    <Notes />
  </div>
</template>

<style scoped>
.markdown {
  line-height: 1.5;
}
.markdown :deep(:is(h3, h4, h5, h6)) {
  margin: 16px 0 6px;
  font-weight: 600;
}
.markdown :deep(h3) {
  font-size: 16px;
}
.markdown :deep(h4) {
  font-size: 15px;
}
.markdown :deep(:is(h5, h6)) {
  font-size: 14px;
}
.markdown :deep(:first-child) {
  margin-top: 0;
}
.markdown :deep(p) {
  margin: 6px 0;
}
.markdown :deep(ul) {
  margin: 6px 0;
  padding-left: 20px;
}
.markdown :deep(li) {
  margin: 3px 0;
}
.markdown :deep(code) {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 0.9em;
  padding: 0 3px;
  border-radius: 3px;
  background: rgba(128, 128, 128, 0.16);
}
.markdown :deep(a) {
  color: inherit;
  text-decoration: underline;
}
</style>
