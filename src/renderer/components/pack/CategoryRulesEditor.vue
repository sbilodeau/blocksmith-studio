<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NAlert, NButton, NInput, NInputNumber, NSelect, NSwitch, NTag, NText } from 'naive-ui'
import {
  FALLBACK_CATEGORY,
  MAX_CATEGORY_LABEL,
  categorizePath,
  countCategoryMatches,
  countGlobMatches,
  globIssue,
  isBuiltinCategory,
  mergeCategoryRules,
  newCategoryId,
  validateCategoryRules,
  type CategoryIssue,
  type CategoryRule
} from '@shared/categories'
import { useCategoryName } from './category-name'

/**
 * One scope of the category mapping editor. "global" edits the whole "All packs" mapping; "pack" edits the pack's
 * extra rules (replacements by id and custom categories) on top of `baseRules`. Counts, invalid patterns and the
 * "test a path" field are computed live against the pack's texture paths.
 */
const props = defineProps<{
  scope: 'global' | 'pack'
  /** "Pack" scope: the "All packs" rules the pack rules apply on top of. */
  baseRules?: CategoryRule[]
  /** Texture paths of the current pack (live counts). */
  paths: string[]
  /** Thumbnail URL of a texture path of the pack, if any. */
  iconUrl?: (path: string) => string | undefined
}>()
const rules = defineModel<CategoryRule[]>('rules', { required: true })
const { t } = useI18n()
const categoryName = useCategoryName()

/** Rules that apply to the pack in this scope. */
const effective = computed(() =>
  props.scope === 'global' ? rules.value : mergeCategoryRules(props.baseRules ?? [], rules.value)
)
const issues = computed(() => validateCategoryRules(rules.value))
const baseIds = computed(() => new Set((props.baseRules ?? []).map((r) => r.id)))

/** Live counts per category (debounced: they cover every texture of the pack). */
const counts = ref<Record<string, number>>({})
let timer: ReturnType<typeof setTimeout> | undefined
watch(
  [effective, () => props.paths],
  () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      counts.value = countCategoryMatches(effective.value, props.paths)
    }, 150)
  },
  { deep: true, immediate: true }
)
onBeforeUnmount(() => clearTimeout(timer))

/** List order: the scope's rules by display order (the fallback last). */
const listed = computed(() =>
  rules.value
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) => a.rule.order - b.rule.order || a.index - b.index)
)

const selectedId = ref<string | null>(rules.value[0]?.id ?? null)
const selectedIndex = computed(() => rules.value.findIndex((r) => r.id === selectedId.value))
const selected = computed(() =>
  selectedIndex.value >= 0 ? rules.value[selectedIndex.value] : undefined
)
const selectedIssues = computed(() => issues.value.filter((i) => i.index === selectedIndex.value))

function hasIssue(index: number): boolean {
  return issues.value.some((i) => i.index === index)
}

function globError(field: 'include' | 'exclude', globIndex: number): string | null {
  const issue = selectedIssues.value.find(
    (i: CategoryIssue) => i.code === 'glob' && i.field === field && i.globIndex === globIndex
  )
  return issue?.globIssue ? t(`categoriesEditor.globIssues.${issue.globIssue}`) : null
}

const ruleErrors = computed(() =>
  selectedIssues.value
    .filter((i) => i.code !== 'glob')
    .map((i) => t(`categoriesEditor.issues.${i.code}`))
)

function globCount(glob: string): number | null {
  return globIssue(glob) ? null : countGlobMatches(glob, props.paths)
}

function isCustom(rule: CategoryRule): boolean {
  return !isBuiltinCategory(rule.id) && !rule.i18nKey
}

/** Built-in categories can be hidden (and, in a pack, any category of "All packs" it replaces); never "other". */
function canHide(rule: CategoryRule): boolean {
  if (rule.id === FALLBACK_CATEGORY) return false
  return isBuiltinCategory(rule.id) || (props.scope === 'pack' && baseIds.value.has(rule.id))
}

function canDelete(rule: CategoryRule): boolean {
  if (props.scope === 'pack') return true
  return rule.id !== FALLBACK_CATEGORY && !isBuiltinCategory(rule.id)
}

/** Replaces the selected rule (the model is never mutated in place). */
function patch(change: Partial<CategoryRule>): void {
  const index = selectedIndex.value
  if (index < 0) return
  const next = [...rules.value]
  const rule: CategoryRule = { ...next[index]!, ...change }
  if (rule.hidden === false) delete rule.hidden
  if (rule.exclude && rule.exclude.length === 0) delete rule.exclude
  next[index] = rule
  rules.value = next
}

function globs(field: 'include' | 'exclude'): string[] {
  return selected.value?.[field] ?? []
}

function setGlob(field: 'include' | 'exclude', globIndex: number, value: string): void {
  const list = [...globs(field)]
  list[globIndex] = value
  patch({ [field]: list })
}

function addGlob(field: 'include' | 'exclude'): void {
  patch({ [field]: [...globs(field), ''] })
}

function removeGlob(field: 'include' | 'exclude', globIndex: number): void {
  patch({ [field]: globs(field).filter((_, i) => i !== globIndex) })
}

function remove(): void {
  const index = selectedIndex.value
  if (index < 0) return
  rules.value = rules.value.filter((_, i) => i !== index)
  selectedId.value = listed.value[0]?.rule.id ?? null
}

/** New custom categories go after every category but the fallback. */
function nextOrder(): number {
  const orders = effective.value.filter((r) => r.id !== FALLBACK_CATEGORY).map((r) => r.order)
  return (orders.length ? Math.max(...orders) : 0) + 10
}

const newName = ref('')
function addCategory(): void {
  const label = newName.value.trim()
  if (!label) return
  const id = newCategoryId(
    label,
    effective.value.map((r) => r.id)
  )
  rules.value = [...rules.value, { id, label, icon: '', include: [], order: nextOrder() }]
  selectedId.value = id
  newName.value = ''
}

/** "Pack" scope: categories of "All packs" the pack does not replace yet. */
const overrideOptions = computed(() =>
  (props.baseRules ?? [])
    .filter((r) => !rules.value.some((o) => o.id === r.id))
    .map((r) => ({ value: r.id, label: categoryName(r) }))
)
function addOverride(id: string | null): void {
  const base = props.baseRules?.find((r) => r.id === id)
  if (!base) return
  // A plain deep copy (the base rules are reactive proxies, which structuredClone refuses).
  rules.value = [...rules.value, JSON.parse(JSON.stringify(base)) as CategoryRule]
  selectedId.value = base.id
}

const testInput = ref('')
const testResult = computed(() => {
  const input = testInput.value.trim()
  if (!input) return []
  return categorizePath(effective.value, input).map((id) => {
    const rule = effective.value.find((r) => r.id === id)
    return rule ? categoryName(rule) : categoryName({ id })
  })
})

const iconPreview = computed(() =>
  selected.value?.icon ? props.iconUrl?.(selected.value.icon) : undefined
)
</script>

<template>
  <div class="rules-editor" :data-testid="`cat-editor-${scope}`">
    <div class="list">
      <n-text depth="3" class="hint">
        {{ scope === 'global' ? t('categoriesEditor.allHint') : t('categoriesEditor.packHint') }}
      </n-text>
      <n-text v-if="scope === 'pack' && rules.length === 0" depth="3" class="hint">
        {{ t('categoriesEditor.packEmpty') }}
      </n-text>
      <button
        v-for="{ rule, index } in listed"
        :key="rule.id"
        class="row"
        :class="{ active: rule.id === selectedId, hidden: rule.hidden, invalid: hasIssue(index) }"
        :data-testid="`cat-rule-${rule.id}`"
        @click="selectedId = rule.id"
      >
        <span class="name">{{ categoryName(rule) || rule.id }}</span>
        <n-tag v-if="rule.hidden" size="tiny" :bordered="false">
          {{ t('categoriesEditor.hidden') }}
        </n-tag>
        <n-tag v-else-if="scope === 'pack'" size="tiny" :bordered="false" type="info">
          {{
            baseIds.has(rule.id) ? t('categoriesEditor.replaces') : t('categoriesEditor.packOnly')
          }}
        </n-tag>
        <n-tag v-else-if="isCustom(rule)" size="tiny" :bordered="false" type="success">
          {{ t('categoriesEditor.custom') }}
        </n-tag>
        <n-text depth="3" class="count">{{ rule.hidden ? '-' : (counts[rule.id] ?? 0) }}</n-text>
      </button>
      <div class="add">
        <n-input
          v-model:value="newName"
          size="small"
          :maxlength="MAX_CATEGORY_LABEL"
          :placeholder="t('categoriesEditor.newName')"
          data-testid="cat-new-name"
          @keydown.enter.prevent="addCategory"
        />
        <n-button
          size="small"
          :disabled="!newName.trim()"
          data-testid="cat-add"
          @click="addCategory"
        >
          {{ t('categoriesEditor.add') }}
        </n-button>
      </div>
      <n-select
        v-if="scope === 'pack'"
        size="small"
        :value="null"
        :options="overrideOptions"
        :placeholder="t('categoriesEditor.override')"
        data-testid="cat-override"
        @update:value="addOverride"
      />
      <n-text depth="3" class="hint">{{ t('categoriesEditor.countsHint') }}</n-text>
    </div>

    <div class="detail">
      <template v-if="selected">
        <div class="field">
          <template v-if="isCustom(selected)">
            <n-text strong>{{ t('categoriesEditor.name') }}</n-text>
            <n-input
              :value="selected.label ?? ''"
              :maxlength="MAX_CATEGORY_LABEL"
              :status="selected.label?.trim() ? undefined : 'error'"
              data-testid="cat-edit-label"
              @update:value="(v: string) => patch({ label: v })"
            />
          </template>
          <n-text v-else strong class="title">{{ categoryName(selected) }}</n-text>
          <n-text depth="3" class="small">{{
            t('categoriesEditor.id', { id: selected.id })
          }}</n-text>
        </div>
        <n-alert v-for="e in ruleErrors" :key="e" type="error" :show-icon="false" class="small">
          {{ e }}
        </n-alert>
        <n-text v-if="selected.id === FALLBACK_CATEGORY" depth="3" class="small">
          {{ t('categoriesEditor.otherFixed') }}
        </n-text>
        <div class="inline">
          <div class="field grow">
            <n-text strong>{{ t('categoriesEditor.icon') }}</n-text>
            <div class="inline">
              <img v-if="iconPreview" :src="iconPreview" alt="" class="icon pixelated" />
              <n-input
                :value="selected.icon"
                size="small"
                :placeholder="t('categoriesEditor.iconPlaceholder')"
                data-testid="cat-edit-icon"
                @update:value="(v: string) => patch({ icon: v.trim() })"
              />
            </div>
          </div>
          <div class="field">
            <n-text strong>{{ t('categoriesEditor.order') }}</n-text>
            <n-input-number
              :value="selected.order"
              size="small"
              :step="10"
              :precision="0"
              class="order"
              data-testid="cat-edit-order"
              @update:value="(v: number | null) => patch({ order: v ?? selected!.order })"
            />
          </div>
        </div>
        <label v-if="canHide(selected)" class="inline">
          <n-switch
            :value="selected.hidden === true"
            size="small"
            data-testid="cat-edit-hidden"
            @update:value="(v: boolean) => patch({ hidden: v })"
          />
          <span>{{ t('categoriesEditor.hide') }}</span>
        </label>

        <template v-if="!selected.hidden">
          <div v-for="field in ['include', 'exclude'] as const" :key="field" class="field">
            <n-text strong>{{ t(`categoriesEditor.${field}`) }}</n-text>
            <div
              v-for="(glob, gi) in globs(field)"
              :key="`${field}-${gi}`"
              class="glob"
              :data-testid="`glob-${field}-${gi}`"
            >
              <div class="inline">
                <n-input
                  :value="glob"
                  size="small"
                  :placeholder="t('categoriesEditor.patternPlaceholder')"
                  :status="globError(field, gi) ? 'error' : undefined"
                  @update:value="(v: string) => setGlob(field, gi, v)"
                />
                <n-text depth="3" class="count">
                  {{
                    globCount(glob) === null
                      ? '-'
                      : t('categoriesEditor.matches', { count: globCount(glob) }, globCount(glob)!)
                  }}
                </n-text>
                <n-button
                  size="tiny"
                  quaternary
                  :title="t('categoriesEditor.removePattern')"
                  :data-testid="`glob-remove-${field}-${gi}`"
                  @click="removeGlob(field, gi)"
                >
                  {{ t('categoriesEditor.remove') }}
                </n-button>
              </div>
              <n-text v-if="globError(field, gi)" type="error" class="small">
                {{ globError(field, gi) }}
              </n-text>
            </div>
            <n-button
              size="tiny"
              dashed
              class="add-glob"
              :data-testid="`glob-add-${field}`"
              @click="addGlob(field)"
            >
              {{ t('categoriesEditor.addPattern') }}
            </n-button>
          </div>
          <n-text depth="3" class="small">{{ t('categoriesEditor.globHelp') }}</n-text>
        </template>

        <n-button
          v-if="canDelete(selected)"
          size="small"
          type="error"
          secondary
          class="delete"
          data-testid="cat-delete"
          @click="remove"
        >
          {{
            scope === 'pack' ? t('categoriesEditor.removeOverride') : t('categoriesEditor.delete')
          }}
        </n-button>
      </template>
      <n-text v-else depth="3">{{ t('categoriesEditor.select') }}</n-text>

      <div class="test">
        <n-text strong>{{ t('categoriesEditor.testPath') }}</n-text>
        <n-input
          v-model:value="testInput"
          size="small"
          clearable
          :placeholder="t('categoriesEditor.testPlaceholder')"
          data-testid="cat-test-path"
        />
        <div v-if="testResult.length" class="inline wrap" data-testid="cat-test-result">
          <n-text depth="3">{{ t('categoriesEditor.testResult') }}</n-text>
          <n-tag v-for="name in testResult" :key="name" size="small" :bordered="false">
            {{ name }}
          </n-tag>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rules-editor {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 16px;
  min-height: 420px;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 60vh;
  overflow-y: auto;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.row:hover {
  background: rgba(128, 128, 128, 0.12);
}
.row.active {
  background: rgba(24, 160, 88, 0.16);
  font-weight: 600;
}
.row.hidden .name {
  opacity: 0.55;
  text-decoration: line-through;
}
.row.invalid {
  box-shadow: inset 2px 0 0 #d03050;
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.count {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.hint,
.small {
  font-size: 12px;
}
.hint {
  margin: 4px 0;
}
.add {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 60vh;
  overflow-y: auto;
  padding-right: 4px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.grow {
  flex: 1;
}
.title {
  font-size: 16px;
}
.inline {
  display: flex;
  align-items: center;
  gap: 8px;
}
.wrap {
  flex-wrap: wrap;
}
.glob {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.icon {
  width: 24px;
  height: 24px;
  flex: none;
}
.order {
  width: 110px;
}
.add-glob,
.delete {
  align-self: flex-start;
}
.test {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
  padding-top: 10px;
  border-top: 1px solid rgba(128, 128, 128, 0.2);
}
</style>
