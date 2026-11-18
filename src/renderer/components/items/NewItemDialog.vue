<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NButton,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSpace,
  NText,
  type SelectOption
} from 'naive-ui'
import { packAssetUrl } from '@shared/assets'
import {
  ARMOR_SLOTS,
  CustomItemSchema,
  ITEM_ID_RE,
  ITEM_KINDS,
  TOOL_TYPES,
  itemIdFromName,
  type ArmorSlot,
  type ItemKind,
  type ToolType
} from '@shared/items/schema'
import { itemPreset } from '@shared/items/presets'
import ItemIcon from './ItemIcon.vue'
import ItemPicker from './ItemPicker.vue'
import { useItemsStore, type PickerExtra } from '../../stores/items'
import { useErrorMessage } from '../../composables/useErrorMessage'

/**
 * New custom item (PLAN M14): the kind (and tool type / armor slot), the English and French names, the id built
 * from the English name, and the starting texture (the kind's preset, a blank 16x16, or the texture of another
 * item). The definition starts from the kind's preset; everything is editable on the item page afterwards.
 */
const show = defineModel<boolean>('show', { required: true })
const props = defineProps<{ packId: string }>()
const { t } = useI18n()
const { showError } = useErrorMessage()
const store = computed(() => useItemsStore(props.packId))

const kind = ref<ItemKind>('simple')
const toolType = ref<ToolType>('pickaxe')
const slot = ref<ArmorSlot>('head')
const nameEn = ref('')
const nameFr = ref('')
const id = ref('')
/** The id follows the English name until the user types one. */
const idTouched = ref(false)
const textureMode = ref<'preset' | 'blank' | 'other'>('preset')
const otherTexture = ref<string | null>(null)
const showPicker = ref(false)
const creating = ref(false)

watch(
  show,
  (open) => {
    if (!open) return
    kind.value = 'simple'
    toolType.value = 'pickaxe'
    slot.value = 'head'
    nameEn.value = ''
    nameFr.value = ''
    id.value = ''
    idTouched.value = false
    textureMode.value = 'preset'
    otherTexture.value = null
  },
  { immediate: true }
)
watch(nameEn, (name) => {
  if (!idTouched.value) id.value = itemIdFromName(name)
})

function onId(value: string): void {
  idTouched.value = true
  id.value = value
}

const variant = computed(() =>
  kind.value === 'tool' ? toolType.value : kind.value === 'armor' ? slot.value : undefined
)
const preset = computed(() => itemPreset(kind.value, variant.value))

const kindOptions = computed(() =>
  ITEM_KINDS.map((k) => ({ value: k, label: t(`items.kinds.${k}`) }))
)
const toolOptions = computed<SelectOption[]>(() =>
  TOOL_TYPES.map((v) => ({ value: v, label: t(`items.toolTypes.${v}`) }))
)
const slotOptions = computed<SelectOption[]>(() =>
  ARMOR_SLOTS.map((v) => ({ value: v, label: t(`items.slots.${v}`) }))
)

const exists = computed(() => store.value.items.some((i) => i.id === id.value))
const idError = computed(() => {
  if (!id.value) return nameEn.value.trim() ? t('items.new.idEmpty') : null
  if (!ITEM_ID_RE.test(id.value)) return t('items.new.idInvalid')
  if (exists.value) return t('items.new.idExists')
  return null
})
const idFeedback = computed(
  () => idError.value ?? (id.value ? `${store.value.namespace}:${id.value}` : t('items.new.idHint'))
)

/** The pack's own items, offered as texture sources next to the vanilla items. */
const packItems = computed<PickerExtra[]>(() =>
  store.value.items
    .filter((i) => i.hasTexture)
    .map((i) => ({ id: `${i.namespace}:${i.id}`, name: i.names['en_us'], icon: i.texture }))
)

const textureFrom = computed<string | null>(() =>
  textureMode.value === 'preset'
    ? preset.value.textureFrom
    : textureMode.value === 'other'
      ? otherTexture.value
      : null
)
const textureUrl = computed(() =>
  textureFrom.value ? packAssetUrl(props.packId, textureFrom.value) : undefined
)

function onPick(_id: string, icon: string | undefined): void {
  if (icon) otherTexture.value = icon
}

const canCreate = computed(
  () =>
    nameEn.value.trim().length > 0 &&
    !!id.value &&
    !idError.value &&
    (textureMode.value !== 'other' || !!otherTexture.value)
)

async function create(): Promise<void> {
  if (!canCreate.value || creating.value) return
  const names: Record<string, string> = { en_us: nameEn.value.trim() }
  if (nameFr.value.trim()) names['fr_fr'] = nameFr.value.trim()
  const parsed = CustomItemSchema.safeParse({
    schemaVersion: 1,
    id: id.value,
    namespace: store.value.namespace,
    names,
    ...preset.value.item
  })
  if (!parsed.success) {
    showError(parsed.error)
    return
  }
  creating.value = true
  try {
    await store.value.create(parsed.data, textureFrom.value)
    show.value = false
  } catch (err) {
    showError(err)
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    :title="t('items.new.title')"
    style="width: 560px"
    :mask-closable="!creating"
    data-testid="item-new-dialog"
  >
    <n-form label-placement="top" @submit.prevent="create">
      <n-form-item :label="t('items.new.kind')">
        <n-radio-group v-model:value="kind" size="small">
          <n-radio-button
            v-for="k in kindOptions"
            :key="k.value"
            :value="k.value"
            :data-testid="`item-new-kind-${k.value}`"
          >
            {{ k.label }}
          </n-radio-button>
        </n-radio-group>
      </n-form-item>
      <n-form-item v-if="kind === 'tool'" :label="t('items.form.toolType')">
        <n-select v-model:value="toolType" :options="toolOptions" data-testid="item-new-tool" />
      </n-form-item>
      <n-form-item v-if="kind === 'armor'" :label="t('items.form.slot')">
        <n-select v-model:value="slot" :options="slotOptions" data-testid="item-new-slot" />
      </n-form-item>
      <n-text depth="3" class="hint">{{ t(`items.new.kindHint.${kind}`) }}</n-text>
      <n-space :wrap="false" class="names">
        <n-form-item :label="t('items.form.nameEn')" style="flex: 1">
          <n-input
            v-model:value="nameEn"
            :placeholder="t('items.new.nameEnPlaceholder')"
            data-testid="item-new-name-en"
          />
        </n-form-item>
        <n-form-item :label="t('items.form.nameFr')" style="flex: 1">
          <n-input
            v-model:value="nameFr"
            :placeholder="t('items.new.nameFrPlaceholder')"
            data-testid="item-new-name-fr"
          />
        </n-form-item>
      </n-space>
      <n-form-item
        :label="t('items.new.id')"
        :validation-status="idError ? 'warning' : undefined"
        :feedback="idFeedback"
      >
        <n-input :value="id" data-testid="item-new-id" @update:value="onId" />
      </n-form-item>
      <n-form-item :label="t('items.new.texture')">
        <div class="texture">
          <n-radio-group v-model:value="textureMode" size="small">
            <n-radio-button value="preset" data-testid="item-new-texture-preset">
              {{ t('items.new.texturePreset') }}
            </n-radio-button>
            <n-radio-button value="blank" data-testid="item-new-texture-blank">
              {{ t('items.new.textureBlank') }}
            </n-radio-button>
            <n-radio-button value="other" data-testid="item-new-texture-other">
              {{ t('items.new.textureOther') }}
            </n-radio-button>
          </n-radio-group>
          <div class="texture-row">
            <item-icon :url="textureUrl" :size="40" />
            <n-text v-if="textureFrom" depth="3" class="path" data-testid="item-new-texture-path">
              {{ textureFrom }}
            </n-text>
            <n-text v-else-if="textureMode === 'blank'" depth="3" class="path">
              {{ t('items.new.textureBlankHint') }}
            </n-text>
            <n-button
              v-if="textureMode === 'other'"
              size="small"
              data-testid="item-new-texture-pick"
              @click="showPicker = true"
            >
              {{ t('items.new.texturePick') }}
            </n-button>
          </div>
        </div>
      </n-form-item>
    </n-form>
    <item-picker
      v-model:show="showPicker"
      :pack-id="packId"
      :title="t('items.new.texturePickTitle')"
      :extra="packItems"
      @pick="onPick"
    />
    <template #footer>
      <n-space justify="end">
        <n-button :disabled="creating" @click="show = false">{{ t('common.cancel') }}</n-button>
        <n-button
          type="primary"
          :loading="creating"
          :disabled="!canCreate"
          data-testid="item-new-create"
          @click="create"
        >
          {{ t('items.new.create') }}
        </n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<style scoped>
.hint {
  display: block;
  font-size: 12px;
  margin: -12px 0 12px;
}
.names {
  width: 100%;
}
.names > :deep(div) {
  flex: 1;
}
.texture {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.texture-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.path {
  font-size: 12px;
  font-family: var(--n-font-family-mono, monospace);
}
</style>
