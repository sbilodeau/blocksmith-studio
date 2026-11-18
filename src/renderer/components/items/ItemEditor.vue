<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NAlert,
  NButton,
  NDropdown,
  NFormItem,
  NInput,
  NModal,
  NSpace,
  NSpin,
  NTab,
  NTabs,
  NTag,
  NText,
  NTooltip,
  useDialog,
  useMessage,
  type DropdownOption
} from 'naive-ui'
import { packAssetUrl } from '@shared/assets'
import {
  ITEM_ID_RE,
  ITEM_REF_RE,
  armorTexturePath,
  itemTexturePath,
  type CustomItem,
  type CustomItemInput,
  type ItemRecipe
} from '@shared/items/schema'
import ItemPropertiesForm from './ItemPropertiesForm.vue'
import RecipeGrid from './RecipeGrid.vue'
import HowToGet from './HowToGet.vue'
import ItemPreview from './ItemPreview.vue'
import ItemIcon from './ItemIcon.vue'
import ItemAgentPanel from './ItemAgentPanel.vue'
import ItemExplain from './ItemExplain.vue'
import { useItemIssues } from './issues'
import { call } from '../../services/ipc'
import { itemDisplayName, useItemsStore } from '../../stores/items'
import { usePackStore } from '../../stores/pack'
import { useErrorMessage } from '../../composables/useErrorMessage'

/**
 * The item page (PLAN M14): the properties form, the texture (opened in the pixel editor), a read-only 3D preview,
 * the recipe, the commands to get the item, the base item warning and the AI side pane. The form is the items
 * store's draft; Save writes the definition and every generated file as one history entry.
 */
const props = defineProps<{ packId: string }>()
const { t, locale } = useI18n()
const dialog = useDialog()
const message = useMessage()
const { showError } = useErrorMessage()
const store = computed(() => useItemsStore(props.packId))
const pack = computed(() => usePackStore(props.packId))
const d = computed(() => store.value.draft as CustomItemInput | null)
const saved = computed(() => store.value.saved)
const { issues, fieldError } = useItemIssues(() => store.value.parsed)

const name = computed(() =>
  saved.value ? itemDisplayName(saved.value.names, locale.value) : (store.value.editing ?? '')
)
const canSave = computed(() => store.value.dirty && store.value.valid && !store.value.saving)
const errorCount = computed(() => issues.value.length + (store.value.extraInvalid ? 1 : 0))
const version = computed(() => pack.value.summary?.authoringVersion ?? '')

onMounted(() => void store.value.loadCatalog().catch(() => undefined))

// ---------- saving ----------
async function save(): Promise<boolean> {
  if (!store.value.valid) {
    message.error(t('items.editor.fixErrors'))
    return false
  }
  try {
    await store.value.save()
    return true
  } catch (err) {
    showError(err)
    return false
  }
}

/** Runs `action` after asking what to do with unsaved changes (save, discard or cancel). */
function guardUnsaved(action: () => void): void {
  if (!store.value.dirty) {
    action()
    return
  }
  const dlg = dialog.warning({
    title: t('editor.unsavedTitle'),
    content: t('editor.unsavedBody', { name: name.value }),
    positiveText: t('editor.save'),
    negativeText: t('editor.discard'),
    closable: true,
    onPositiveClick: async () => {
      dlg.loading = true
      if (await save()) {
        action()
        return true
      }
      dlg.loading = false
      return false
    },
    onNegativeClick: () => action()
  })
}

function back(): void {
  guardUnsaved(() => store.value.close())
}

function onKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 's') {
    e.preventDefault()
    if (canSave.value) void save()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

// ---------- rename and delete ----------
const showRename = ref(false)
const newId = ref('')
const renaming = ref(false)
const renameError = computed(() => {
  if (!ITEM_ID_RE.test(newId.value)) return t('items.new.idInvalid')
  if (newId.value !== store.value.editing && store.value.items.some((i) => i.id === newId.value)) {
    return t('items.new.idExists')
  }
  return null
})
async function rename(): Promise<void> {
  const draft = d.value
  if (!draft || renameError.value || renaming.value) return
  const previous = draft.id
  draft.id = newId.value
  renaming.value = true
  try {
    if (await save()) showRename.value = false
    else draft.id = previous
  } finally {
    renaming.value = false
  }
}

function remove(): void {
  const id = store.value.editing
  if (!id) return
  dialog.warning({
    title: t('items.editor.delete'),
    content: t('items.editor.deleteConfirm', { name: name.value }),
    positiveText: t('items.editor.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      try {
        await store.value.remove(id)
      } catch (err) {
        showError(err)
      }
    }
  })
}

const moreOptions = computed<DropdownOption[]>(() => [
  { key: 'rename', label: t('items.editor.rename') },
  { key: 'delete', label: t('items.editor.delete') }
])
function onMore(key: string): void {
  if (key === 'rename') {
    newId.value = d.value?.id ?? ''
    showRename.value = true
  }
  if (key === 'delete') remove()
}

// ---------- texture ----------
const texturePath = computed(() => (saved.value ? itemTexturePath(saved.value) : null))
const wornPath = computed(() => (saved.value ? armorTexturePath(saved.value) : null))
const url = (path: string | null): string | undefined =>
  path ? packAssetUrl(props.packId, path, String(store.value.revision)) : undefined

/** Opens a texture of the item in the pixel editor; Back returns here, with the form as it was. */
async function editTexture(path: string | null): Promise<void> {
  if (!path) return
  try {
    await pack.value.load()
    if (!pack.value.textures.some((tex) => tex.path === path)) {
      message.warning(t('items.editor.textureMissing'))
      return
    }
    pack.value.openEditor(path, true)
  } catch (err) {
    showError(err)
  }
}

// ---------- recipe ----------
const recipe = computed({
  get: () => (d.value?.recipe ?? null) as ItemRecipe | null,
  set: (r: ItemRecipe | null) => {
    if (d.value) d.value.recipe = r
  }
})

// ---------- base item warning ----------
const baseUses = ref<string[]>([])
let contextTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => d.value?.base,
  (base) => {
    clearTimeout(contextTimer)
    if (!base || !ITEM_REF_RE.test(base)) {
      baseUses.value = []
      return
    }
    contextTimer = setTimeout(async () => {
      try {
        const context = await call('items.context', { packId: props.packId, base })
        if (d.value?.base === base) baseUses.value = context.baseRecipeUses
      } catch {
        baseUses.value = []
      }
    }, 200)
  },
  { immediate: true }
)
onBeforeUnmount(() => clearTimeout(contextTimer))
const baseName = computed(() =>
  d.value ? (store.value.vanillaName(d.value.base) ?? d.value.base) : ''
)

// ---------- AI pane ----------
const aiTab = ref<'chat' | 'explain' | null>(null)
const explainSeen = ref(false)
watch(aiTab, (tab) => {
  if (tab === 'explain') explainSeen.value = true
})
/** The AI's proposal goes into the form, unsaved (the user saves it). */
function applyProposal(item: CustomItem): void {
  store.value.applyToForm(item)
  message.success(t('items.editor.applied'))
}

defineExpose({ guardUnsaved })
</script>

<template>
  <div class="item-editor" data-testid="item-editor">
    <div class="head">
      <div class="head-left">
        <n-button size="small" data-testid="item-back" @click="back">
          {{ t('items.editor.back') }}
        </n-button>
        <div class="title">
          <item-icon :url="url(texturePath)" :size="28" />
          <n-text strong class="name" data-testid="item-name">{{ name }}</n-text>
          <n-tag v-if="saved" size="tiny" type="info" :bordered="false">
            {{ t(`items.kinds.${saved.kind}`) }}
          </n-tag>
          <n-tag
            v-if="store.dirty"
            size="tiny"
            type="info"
            :bordered="false"
            data-testid="item-dirty"
          >
            {{ t('editor.unsaved') }}
          </n-tag>
          <n-text v-if="saved" depth="3" class="ref">{{ `${saved.namespace}:${saved.id}` }}</n-text>
        </div>
      </div>
      <div class="head-right">
        <n-text v-if="errorCount" type="error" class="errors" data-testid="item-error-count">
          {{ t('items.editor.errorCount', { count: errorCount }, errorCount) }}
        </n-text>
        <n-tooltip v-if="saved">
          <template #trigger>
            <n-button
              size="small"
              :type="aiTab ? 'primary' : 'default'"
              data-testid="item-ai-open"
              @click="aiTab = aiTab ? null : 'chat'"
            >
              {{ t('items.editor.ai') }}
            </n-button>
          </template>
          {{ t('items.editor.aiHint') }}
        </n-tooltip>
        <n-dropdown trigger="click" :options="moreOptions" @select="onMore">
          <n-button size="small" :disabled="!saved" data-testid="item-more">
            {{ t('data.editor.more') }}
          </n-button>
        </n-dropdown>
        <n-tooltip>
          <template #trigger>
            <n-button
              size="small"
              type="primary"
              :disabled="!canSave"
              :loading="store.saving"
              data-testid="item-save"
              @click="save"
            >
              {{ t('editor.save') }}
            </n-button>
          </template>
          {{ t('editor.shortcut', { label: t('editor.save'), key: 'Ctrl/Cmd+S' }) }}
        </n-tooltip>
      </div>
    </div>

    <n-spin :show="!d" class="spin">
      <div v-if="d && saved" class="panes">
        <div class="main-pane">
          <div class="columns">
            <div class="left">
              <item-properties-form :pack-id="packId" />
              <section class="block">
                <h4>{{ t('items.recipe.title') }}</h4>
                <recipe-grid
                  v-model:recipe="recipe"
                  :pack-id="packId"
                  :result-icon="url(texturePath)"
                  :error="fieldError('recipe', true)"
                />
              </section>
              <section class="block">
                <h4>{{ t('items.howTo.title') }}</h4>
                <how-to-get
                  v-if="store.current"
                  :item="store.current"
                  :version="version"
                  :dirty="store.dirty"
                />
              </section>
            </div>
            <div class="right">
              <section class="block texture" data-testid="item-texture">
                <h4>{{ t('items.editor.texture') }}</h4>
                <div class="texture-row">
                  <item-icon :url="url(texturePath)" :size="64" />
                  <div class="texture-info">
                    <n-text depth="3" class="path">{{ texturePath }}</n-text>
                    <n-button
                      size="small"
                      data-testid="item-texture-edit"
                      @click="editTexture(texturePath)"
                    >
                      {{ t('items.editor.editTexture') }}
                    </n-button>
                  </div>
                </div>
                <div v-if="wornPath" class="texture-row" data-testid="item-worn">
                  <item-icon :url="url(wornPath)" :size="64" />
                  <div class="texture-info">
                    <n-text depth="3" class="path">{{ t('items.editor.worn') }}</n-text>
                    <n-text depth="3" class="path">{{ wornPath }}</n-text>
                    <n-button
                      size="small"
                      data-testid="item-worn-edit"
                      @click="editTexture(wornPath)"
                    >
                      {{ t('items.editor.editTexture') }}
                    </n-button>
                  </div>
                </div>
                <n-text depth="3" class="hint">{{ t('items.editor.textureHint') }}</n-text>
              </section>
              <item-preview
                v-if="texturePath"
                :pack-id="packId"
                :path="texturePath"
                :revision="store.revision"
              />
              <n-alert
                v-if="baseUses.length"
                type="warning"
                :show-icon="false"
                class="block"
                data-testid="item-base-warning"
              >
                {{
                  t(
                    'items.editor.baseUsed',
                    { base: baseName, count: baseUses.length },
                    baseUses.length
                  )
                }}
                <ul class="uses">
                  <li v-for="use in baseUses.slice(0, 12)" :key="use">
                    <n-text code>{{ use }}</n-text>
                  </li>
                </ul>
                <n-text depth="3" class="hint">{{ t('items.editor.baseUsedHint') }}</n-text>
              </n-alert>
            </div>
          </div>
        </div>
        <div v-if="aiTab && store.current" class="ai-pane" data-testid="item-ai">
          <n-tabs v-model:value="aiTab" type="line" size="small" class="ai-tabs">
            <n-tab name="chat" :tab="t('data.agent.chatTab')" />
            <n-tab name="explain" :tab="t('data.agent.explainTab')" />
            <template #suffix>
              <n-button size="tiny" quaternary data-testid="item-ai-close" @click="aiTab = null">
                {{ t('common.close') }}
              </n-button>
            </template>
          </n-tabs>
          <div class="ai-body">
            <item-agent-panel
              v-show="aiTab === 'chat'"
              :pack-id="packId"
              :item="store.current"
              @apply="applyProposal"
            />
            <!-- Mounted the first time its tab opens (opening it asks for an explanation), then kept. -->
            <item-explain
              v-if="explainSeen"
              v-show="aiTab === 'explain'"
              :pack-id="packId"
              :item="store.current"
            />
          </div>
        </div>
      </div>
    </n-spin>

    <n-modal
      v-model:show="showRename"
      preset="card"
      :title="t('items.editor.rename')"
      style="width: 420px"
      data-testid="item-rename-dialog"
    >
      <n-form-item
        :label="t('items.new.id')"
        :validation-status="renameError ? 'warning' : undefined"
        :feedback="renameError ?? t('items.editor.renameHint')"
      >
        <n-input v-model:value="newId" data-testid="item-rename-id" @keyup.enter="rename" />
      </n-form-item>
      <template #footer>
        <n-space justify="end">
          <n-button :disabled="renaming" @click="showRename = false">
            {{ t('common.cancel') }}
          </n-button>
          <n-button
            type="primary"
            :loading="renaming"
            :disabled="!!renameError || newId === store.editing"
            data-testid="item-rename-confirm"
            @click="rename"
          >
            {{ t('items.editor.rename') }}
          </n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.item-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 8px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}
.head-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1;
}
.head-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.ref {
  font-size: 12px;
  font-family: var(--n-font-family-mono, monospace);
  white-space: nowrap;
}
.errors {
  font-size: 12px;
}
.spin {
  flex: 1;
  min-height: 0;
}
.spin :deep(.n-spin-content) {
  height: 100%;
}
.panes {
  display: flex;
  gap: 8px;
  height: 100%;
  min-height: 0;
}
.main-pane {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding-right: 4px;
}
.columns {
  display: flex;
  gap: 24px;
  align-items: flex-start;
}
.left {
  flex: 1;
  min-width: 0;
}
.right {
  flex: none;
  width: 320px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: sticky;
  top: 0;
}
.block h4 {
  margin: 12px 0 6px;
}
.right .block h4 {
  margin-top: 0;
}
.texture-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.texture-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
}
.path {
  font-size: 11px;
  font-family: var(--n-font-family-mono, monospace);
  word-break: break-all;
}
.hint {
  display: block;
  font-size: 12px;
}
.uses {
  margin: 4px 0;
  padding-left: 16px;
  font-size: 12px;
}
.ai-pane {
  flex: none;
  width: 360px;
  min-height: 0;
  overflow: hidden;
  border-left: 1px solid rgba(128, 128, 128, 0.2);
  padding-left: 8px;
  display: flex;
  flex-direction: column;
}
.ai-tabs {
  flex: none;
}
.ai-body {
  flex: 1;
  min-height: 0;
  padding-top: 8px;
  display: flex;
  flex-direction: column;
}
.ai-body > * {
  flex: 1;
  min-height: 0;
}
</style>
