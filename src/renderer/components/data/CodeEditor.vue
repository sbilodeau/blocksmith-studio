<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useThemeVars } from 'naive-ui'
import { basicSetup } from 'codemirror'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { json } from '@codemirror/lang-json'
import { syntaxTree } from '@codemirror/language'
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint'
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult
} from '@codemirror/autocomplete'

/**
 * CodeMirror 6 editor for data files: JSON highlighting, folding, undo, the diagnostics computed by the parent
 * (shared/datapack, so the messages are localized), and completion of item ids and tags inside JSON strings.
 */
const props = defineProps<{
  value: string
  /** 'json' for data files, 'text' for .mcfunction files. */
  mode: 'json' | 'text'
  readOnly?: boolean
  diagnostics?: Diagnostic[]
  /** Completion candidates inside strings: ids ("minecraft:stone") and tags ("#minecraft:planks"). */
  completions?: readonly string[]
}>()
const emit = defineEmits<{ 'update:value': [value: string]; save: [] }>()

const host = ref<HTMLDivElement | null>(null)
const vars = useThemeVars()
let view: EditorView | null = null
const themeSlot = new Compartment()
const readOnlySlot = new Compartment()
/** Text set from outside (format, revert...): not echoed back as an edit. */
let applying = false

function theme(): Extension {
  const v = vars.value
  return EditorView.theme({
    '&': { height: '100%', backgroundColor: v.inputColor, color: v.textColor1, fontSize: '13px' },
    '.cm-scroller': { fontFamily: v.fontFamilyMono, lineHeight: '1.5' },
    '.cm-gutters': {
      backgroundColor: v.actionColor,
      color: v.textColor3,
      borderRight: `1px solid ${v.dividerColor}`
    },
    '.cm-activeLine': { backgroundColor: v.hoverColor },
    '.cm-activeLineGutter': { backgroundColor: v.hoverColor },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor': { borderLeftColor: v.textColor1 },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: `${v.primaryColor}44 !important`
    },
    '.cm-tooltip': {
      backgroundColor: v.popoverColor,
      color: v.textColor1,
      border: `1px solid ${v.dividerColor}`
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: v.primaryColor,
      color: '#fff'
    }
  })
}

/** Ids and tags inside JSON strings (not property names). */
function idCompletion(ctx: CompletionContext): CompletionResult | null {
  const candidates = props.completions
  if (!candidates?.length) return null
  const node = syntaxTree(ctx.state).resolveInner(ctx.pos, -1)
  if (node.name !== 'String') return null
  const word = ctx.matchBefore(/"#?[a-z0-9_:./-]*/)
  if (!word || (word.from === word.to && !ctx.explicit)) return null
  const options: Completion[] = candidates.map((label) => ({
    label,
    type: label.startsWith('#') ? 'namespace' : 'constant'
  }))
  return { from: word.from + 1, options, validFor: /^#?[a-z0-9_:./-]*$/ }
}

function extensions(): Extension[] {
  return [
    basicSetup,
    keymap.of([
      indentWithTab,
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          emit('save')
          return true
        }
      }
    ]),
    ...(props.mode === 'json'
      ? [json(), lintGutter(), autocompletion({ override: [idCompletion] })]
      : []),
    themeSlot.of(theme()),
    readOnlySlot.of(EditorState.readOnly.of(!!props.readOnly)),
    EditorView.updateListener.of((u) => {
      if (u.docChanged && !applying) emit('update:value', u.state.doc.toString())
    })
  ]
}

function pushDiagnostics(): void {
  if (!view || props.mode !== 'json') return
  const length = view.state.doc.length
  const list = (props.diagnostics ?? []).map((d) => ({
    ...d,
    from: Math.min(d.from, length),
    to: Math.min(Math.max(d.to, d.from), length)
  }))
  view.dispatch(setDiagnostics(view.state, list))
}

onMounted(() => {
  view = new EditorView({
    parent: host.value!,
    state: EditorState.create({ doc: props.value, extensions: extensions() })
  })
  pushDiagnostics()
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

watch(
  () => props.value,
  (value) => {
    if (!view || value === view.state.doc.toString()) return
    applying = true
    try {
      // One transaction: Ctrl+Z restores the previous text.
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    } finally {
      applying = false
    }
  }
)
watch(() => props.diagnostics, pushDiagnostics)
watch(vars, () => view?.dispatch({ effects: themeSlot.reconfigure(theme()) }))
watch(
  () => props.readOnly,
  (ro) => view?.dispatch({ effects: readOnlySlot.reconfigure(EditorState.readOnly.of(!!ro)) })
)

defineExpose({
  /** Moves the cursor to an offset and scrolls it into view (issue list clicks). */
  reveal(offset: number): void {
    if (!view) return
    const pos = Math.min(offset, view.state.doc.length)
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
    view.focus()
  }
})
</script>

<template>
  <div ref="host" class="code" data-testid="code-editor" />
</template>

<style scoped>
.code {
  height: 100%;
  min-height: 0;
  border-radius: 4px;
  overflow: hidden;
}
</style>
