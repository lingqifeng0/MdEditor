<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="html-layout-overlay"
      data-testid="html-layout-editor"
      @keydown="handleKeydown"
      @paste="handlePaste"
    >
      <section
        ref="dialogRef"
        class="html-layout-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="编辑 HTML 布局"
        tabindex="-1"
      >
        <header class="html-layout-header">
          <strong>编辑 HTML 布局</strong>
          <div class="html-layout-tabs">
            <button
              type="button"
              data-testid="html-layout-visual-tab"
              :class="{ active: mode === 'visual' }"
              @click="changeMode('visual')"
            >
              可视编辑
            </button>
            <button
              type="button"
              data-testid="html-layout-source-tab"
              :class="{ active: mode === 'source' }"
              @click="changeMode('source')"
            >
              HTML 源码
            </button>
          </div>
          <button
            type="button"
            aria-label="关闭 HTML 编辑"
            @click="close"
          >
            ×
          </button>
        </header>
        <p class="html-layout-hint">
          {{ mode === 'visual' ? '虚线标出 HTML 范围；图片限定在外框内。拖动时自由移动，靠近边缘会显示提示，松开鼠标再对齐、贴边；按住 Alt 可微调。摆放时可临时重叠，应用修改前需分开。外框上下手柄只调整高度。' : '修改后切回可视编辑，即可查看效果；应用修改前会检查图片是否重叠。' }}
          <span class="html-layout-snap-status-slot">
            <span
              v-if="snapGuides.length"
              class="html-layout-snap-status"
              data-testid="html-layout-snap-status"
              role="status"
            >松开后对齐：{{ snapStatus }}</span>
          </span>
        </p>
        <div
          v-show="mode === 'visual'"
          class="html-layout-body"
        >
          <div
            ref="canvasRef"
            class="html-layout-canvas"
            data-testid="html-layout-canvas"
            @scroll="handleCanvasScroll"
          >
            <div
              class="html-layout-surface"
              :style="{ minWidth: `${canvasWidth + 64}px` }"
            >
              <div
                ref="stageRef"
                class="html-layout-stage"
                data-testid="html-layout-stage"
                :style="{ width: `${canvasWidth}px` }"
                @pointerdown="startMove"
                @click.prevent
                @dragstart.prevent
                @load.capture="updateSelectionFrame"
              />
              <div
                v-if="outerFrame"
                class="html-layout-boundary"
                data-testid="html-layout-boundary"
                :style="outerFrameStyle"
              >
                <span @pointerdown="startOuterPointer($event, 'move')">HTML 范围</span>
                <div
                  v-for="edge in ['top', 'right', 'bottom', 'left']"
                  :key="edge"
                  class="html-layout-frame-edge"
                  :class="edge"
                  @pointerdown="startOuterPointer($event, 'move')"
                />
                <button
                  v-if="layout?.rootTargetId"
                  type="button"
                  class="html-layout-height-handle top"
                  data-testid="html-layout-resize-top"
                  aria-label="拖动上边缘调整外框高度"
                  @pointerdown="startOuterPointer($event, 'resize-top')"
                />
                <button
                  v-if="layout?.rootTargetId"
                  type="button"
                  class="html-layout-height-handle bottom"
                  data-testid="html-layout-resize-bottom"
                  aria-label="拖动下边缘调整外框高度"
                  @pointerdown="startOuterPointer($event, 'resize-bottom')"
                />
              </div>
              <div
                v-if="selectedId && frame"
                class="html-layout-selection"
                data-testid="html-layout-selection"
                :style="frameStyle"
              >
                <template v-if="selected?.kind === 'container' && !isRootContainerSelected">
                  <button
                    type="button"
                    class="html-layout-height-handle top"
                    data-testid="html-layout-resize-top"
                    aria-label="拖动上边缘调整外框高度"
                    @pointerdown="startResize($event, 'resize-top')"
                  />
                  <button
                    type="button"
                    class="html-layout-height-handle bottom"
                    data-testid="html-layout-resize-bottom"
                    aria-label="拖动下边缘调整外框高度"
                    @pointerdown="startResize($event, 'resize-bottom')"
                  />
                </template>
                <button
                  v-if="!isRootContainerSelected"
                  type="button"
                  class="html-layout-resize"
                  data-testid="html-layout-resize"
                  aria-label="拖动调整大小"
                  @pointerdown="startResize($event)"
                />
              </div>
              <div
                v-for="guide in snapGuides"
                :key="guide.key"
                class="html-layout-snap-guide"
                :class="guide.axis"
                data-testid="html-layout-snap-guide"
                data-phase="preview"
                :data-axis="guide.axis"
                :data-snap-kind="guide.kind"
                :data-edge="guide.edge"
                :data-target-edge="guide.targetEdge"
                :data-target-id="guide.targetId ?? 'frame'"
                :style="snapGuideStyle(guide)"
              />
            </div>
          </div>
          <aside class="html-layout-controls">
            <div class="html-layout-order">
              <button
                type="button"
                data-testid="html-layout-add-image"
                :disabled="addingImage || applying || !layout?.rootContainer"
                @click="addImage()"
              >
                {{ addingImage ? '正在添加…' : '添加图片' }}
              </button>
              <button
                type="button"
                data-testid="html-layout-delete-image"
                :disabled="addingImage || applying || selected?.kind !== 'image'"
                @click="deleteImage"
              >
                删除图片
              </button>
            </div>
            <button
              type="button"
              class="html-layout-select-container"
              data-testid="html-layout-clipboard-image"
              :disabled="addingImage || applying || !layout?.rootContainer"
              @click="addImage('clipboard')"
            >
              从剪贴板添加（Ctrl+V）
            </button>
            <label class="html-layout-check">
              <input
                v-model="snapEnabled"
                type="checkbox"
                data-testid="html-layout-snap-enabled"
                @change="clearSnapGuides"
              > 松开时自动对齐、贴边
            </label>
            <label class="html-layout-field">
              对象
              <select
                :value="selectedId"
                @change="selectFromList"
              >
                <option
                  value=""
                  disabled
                >选择外框、图片或文本框</option>
                <option
                  v-for="target in layout?.targets || []"
                  :key="target.id"
                  :value="target.id"
                >{{ targetLabel(target) }}</option>
              </select>
            </label>
            <template v-if="selected">
              <p
                v-if="selected.kind === 'container'"
                class="html-layout-container-hint"
              >
                {{ isRootContainerSelected ? '整体外框宽度与正文中的图组一致。上下手柄只调整留白；收至图片边缘时会停止，避免裁掉图片。' : '调整外框的留白；收至图片边缘时会停止，避免裁掉图片。' }}
              </p>
              <div class="html-layout-size-fields">
                <label class="html-layout-field">
                  宽度（px）
                  <input
                    data-testid="html-layout-width"
                    type="number"
                    :value="dimensions.width"
                    :min="selected.kind === 'image' ? 1 : 24"
                    :max="canvasWidth"
                    :readonly="isRootContainerSelected"
                    @change="setDimension('width', $event)"
                  >
                </label>
                <label class="html-layout-field">
                  高度（px）
                  <input
                    data-testid="html-layout-height"
                    type="number"
                    :value="dimensions.height"
                    :min="selected.kind === 'image' ? 1 : 24"
                    max="6000"
                    @change="setDimension('height', $event)"
                  >
                </label>
              </div>
              <button
                v-if="selected.kind === 'container'"
                type="button"
                class="html-layout-fit-container"
                data-testid="html-layout-fit-bottom"
                @click="fitContainer"
              >
                收起底部空白
              </button>
              <label
                v-if="selected.kind === 'image'"
                class="html-layout-check"
              >
                <input
                  v-model="keepRatio"
                  type="checkbox"
                > 保持图片比例
              </label>
              <div class="html-layout-order">
                <button
                  type="button"
                  data-testid="html-layout-previous"
                  :disabled="!selected.canMovePrevious"
                  @click="reorder('previous')"
                >
                  向前排列
                </button>
                <button
                  type="button"
                  data-testid="html-layout-next"
                  :disabled="!selected.canMoveNext"
                  @click="reorder('next')"
                >
                  向后排列
                </button>
              </div>
              <label
                v-if="selected.textEditable"
                class="html-layout-field"
              >
                文字内容
                <textarea
                  data-testid="html-layout-text"
                  :value="selectedText"
                  rows="5"
                  @input="setText"
                />
              </label>
              <button
                v-if="edits.has(selectedId)"
                type="button"
                @click="resetSelected"
              >
                还原此对象
              </button>
            </template>
            <p
              v-if="!layout?.targets.length"
              class="html-layout-empty"
            >
              此块没有可拖动的图片或文本框，可以切换到 HTML 源码编辑。
            </p>
          </aside>
        </div>
        <textarea
          v-show="mode === 'source'"
          v-model="sourceText"
          class="html-layout-source"
          data-testid="html-layout-source"
          spellcheck="false"
          aria-label="HTML 源码"
        />
        <p
          v-if="error"
          class="html-layout-error"
          data-testid="html-layout-error"
          role="alert"
        >
          {{ error }}
        </p>
        <footer class="html-layout-footer">
          <button
            type="button"
            data-testid="html-layout-cancel"
            @click="close"
          >
            取消
          </button>
          <button
            type="button"
            class="primary"
            data-testid="html-layout-apply"
            :disabled="applying"
            @click="apply"
          >
            {{ applying ? '检查图片布局…' : '应用修改' }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, shallowRef } from 'vue'
import type { IEditHtmlLayoutPayload } from '@muyajs/core'
import { sanitize, EXPORT_DOMPURIFY_CONFIG } from '@/util/dompurify'
import { resolveHtmlImageSource } from '@/util/localFileUrl'
import { applyHtmlLayoutEdits, createHtmlLayoutDocument, reorderHtmlLayoutTarget, appendHtmlLayoutImage, removeHtmlLayoutImage, type HtmlLayoutEdit, type HtmlLayoutTarget } from '@/util/htmlLayout'
import { isResponsiveHtmlLayoutContainer, prepareResponsiveHtmlLayoutPreview, responsiveHtmlLayoutImageRectangle, responsiveHtmlLayoutLength, serializeResponsiveHtmlLayout } from '@/util/htmlLayoutResponsive'
import { clampHtmlLayoutImageOffset, fitHtmlLayoutImageSize, placeHtmlLayoutImage } from '@/util/htmlLayoutBounds'
import { findHtmlLayoutImageOverlaps } from '@/util/htmlLayoutValidation'
import { previewHtmlLayoutImageSnap, type HtmlLayoutSnapGuide, type HtmlLayoutSnapImage } from '@/util/htmlLayoutSnapping'
import { askImageRemoval } from '@/util/imageOperationDialog'

const emit = defineEmits<{ (event: 'openChange', open: boolean): void }>()
const visible = ref(false)
const mode = ref<'visual' | 'source'>('visual')
const sourceText = ref('')
const error = ref('')
const applying = ref(false)
const addingImage = ref(false)
const canvasWidth = ref(720)
const selectedId = ref('')
const keepRatio = ref(true)
const snapEnabled = ref(true)
// Root-local CSS pixels keep overlays attached when surrounding document flow moves.
const snapGuides = ref<HtmlLayoutSnapGuide[]>([])
const snapStatus = computed(() => [...new Set(snapGuides.value.map(guide => guide.label))].join('、'))
const layout = shallowRef<ReturnType<typeof createHtmlLayoutDocument> | null>(null)
const edits = reactive(new Map<string, HtmlLayoutEdit>())
const dialogRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLElement | null>(null)
const stageRef = ref<HTMLElement | null>(null)
const dimensions = reactive({ width: 0, height: 0 })
type LayoutFrame = { left: number; top: number; width: number; height: number }
const frame = ref<LayoutFrame | null>(null)
const outerFrame = ref<LayoutFrame | null>(null)
const selected = computed(() => layout.value?.targets.find(target => target.id === selectedId.value))
const isRootContainerSelected = computed(() => selected.value?.kind === 'container' && selectedId.value === layout.value?.rootTargetId)
const selectedText = computed(() => edits.get(selectedId.value)?.text ?? selected.value?.text ?? '')
const frameStyle = computed(() => frame.value
  ? {
      left: `${frame.value.left}px`, top: `${frame.value.top}px`, width: `${frame.value.width}px`, height: `${frame.value.height}px`
    }
  : {})
const outerFrameStyle = computed(() => outerFrame.value
  ? { left: `${outerFrame.value.left}px`, top: `${outerFrame.value.top}px`, width: `${outerFrame.value.width}px`, height: `${outerFrame.value.height}px` }
  : {})

let session: IEditHtmlLayoutPayload | null = null
type ImagePicker = (source?: File | 'clipboard') => Promise<{ src: string; alt: string; dirname?: string } | null>
let pickImage: ImagePicker | null = null
let deleteDraftImages: ((sources: string[], commit: () => boolean, linksOnly: string[]) => Promise<boolean>) | null = null
const removedImageSources = new Set<string>()
const linksOnlyImageSources = new Set<string>()
const addedImageSources = new Set<string>()
let releaseDraftImages: ((sources: string[]) => Promise<void>) | null = null
let imageReload = 0
let originalFocus: HTMLElement | null = null
let imageSources = new Map<string, string>()
let documentDirectory = ''
let resizeObserver: ResizeObserver | null = null
let widthObserver: ResizeObserver | null = null
let widthRefreshing = false
let widthRefreshRequested = false
const containerMedia = new Map<string, { width: number; height: number; media: { element: HTMLElement; width: number; height: number }[] }>()
const frozenGroups = new Map<string, Map<string, HtmlLayoutEdit | undefined>>()
const pinnedImageBaselines = new Map<string, { edits: Map<string, HtmlLayoutEdit>; imageEditing: boolean }>()
let imageRootLock: { id: string; original: HtmlLayoutEdit | undefined; generated: HtmlLayoutEdit } | null = null
let validationCanvas: { frame: LayoutFrame; scrollLeft: number; scrollTop: number } | null = null
type ImageScene = {
  root: HTMLElement
  element: HTMLElement
  bounds: LayoutFrame
  rect: DOMRect
  edit: HtmlLayoutEdit | undefined
  style: string
  originalTransform: string | undefined
  media: { element: HTMLElement; overflow: number[] }[]
  snapImages: HtmlLayoutSnapImage[]
  rollback: () => void
}
let pointerSession: {
  pointerId: number
  operation: 'move' | 'resize' | 'resize-top' | 'resize-bottom'
  x: number
  y: number
  width: number
  height: number
  offsetX: number
  offsetY: number
  baseLeft: number
  baseTop: number
  moved: boolean
  imageScene?: ImageScene
} | null = null

function resolveImageSource (src: string) {
  const rendered = imageSources.get(src)
  if (rendered) return rendered
  return resolveHtmlImageSource(src, documentDirectory)
}

function targetLabel (target: HtmlLayoutTarget) {
  if (target.kind !== 'container') return target.label
  if (target.id === layout.value?.rootTargetId) return '整体外框（所有图片和文字）'
  const containers = layout.value?.targets.filter(item => item.kind === 'container') ?? []
  return `图片与文字组 ${containers.indexOf(target) + 1}`
}

function selectedElement () {
  const model = layout.value
  if (!model || !selected.value) return null
  return stageRef.value?.querySelector<HTMLElement>(`[${model.markerAttribute}="${selectedId.value}"]`) ?? null
}

function outerElement () {
  const model = layout.value
  return (model?.rootTargetId && stageRef.value?.querySelector<HTMLElement>(`[${model.markerAttribute}="${model.rootTargetId}"]`)) || stageRef.value
}

function snapGuideStyle (guide: HtmlLayoutSnapGuide) {
  const surface = stageRef.value?.parentElement?.getBoundingClientRect()
  const root = outerElement()?.getBoundingClientRect()
  if (!surface || !root) return {}
  return guide.axis === 'x'
    ? { left: `${root.left + guide.position - surface.left}px`, top: `${root.top + guide.start - surface.top}px`, height: `${guide.end - guide.start}px` }
    : { left: `${root.left + guide.start - surface.left}px`, top: `${root.top + guide.position - surface.top}px`, width: `${guide.end - guide.start}px` }
}

function clearSnapGuides () {
  snapGuides.value = []
}

function handleCanvasScroll () {
  if (pointerSession?.imageScene) endPointer()
  updateSelectionFrame()
}

function updateSelectionFrame () {
  const element = selectedElement()
  const surface = stageRef.value?.parentElement
  const outer = outerElement()
  if (!visible.value || !surface || !outer) {
    outerFrame.value = null
    frame.value = null
    return
  }
  const container = surface.getBoundingClientRect()
  const outerRect = outer.getBoundingClientRect()
  outerFrame.value = { left: outerRect.left - container.left, top: outerRect.top - container.top, width: outerRect.width, height: outerRect.height }
  if (!element) {
    frame.value = null
    return
  }
  const rect = element.getBoundingClientRect()
  frame.value = { left: rect.left - container.left, top: rect.top - container.top, width: rect.width, height: rect.height }
  dimensions.width = Math.round(rect.width)
  dimensions.height = Math.round(rect.height)
}

function containerMinimumHeight (element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  const style = getComputedStyle(element)
  const paddingTop = parseFloat(style.paddingTop || '0')
  const borderTop = parseFloat(style.borderTopWidth || '0')
  let bottom = rect.top + borderTop + paddingTop
  let contentTop = Infinity
  const include = (box: DOMRect) => {
    bottom = Math.max(bottom, box.bottom)
    contentTop = Math.min(contentTop, box.top)
  }
  const model = layout.value
  for (const child of element.querySelectorAll<HTMLElement>('img, svg, video, canvas, input, textarea, select, button, hr')) {
    const style = getComputedStyle(child)
    if (child.getClientRects().length && style.visibility !== 'hidden' && style.visibility !== 'collapse') {
      include(child.getBoundingClientRect())
    }
  }
  if (model) {
    for (const target of model.targets) {
      if (target.kind !== 'container') continue
      const child = element.querySelector<HTMLElement>(`[${model.markerAttribute}="${target.id}"]`)
      if (child?.getClientRects().length) include(child.getBoundingClientRect())
    }
  }
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (!node.textContent?.trim() || !node.parentElement?.getClientRects().length) continue
    const style = getComputedStyle(node.parentElement)
    if (style.visibility === 'hidden' || style.visibility === 'collapse') continue
    const range = document.createRange()
    range.selectNodeContents(node)
    for (const line of range.getClientRects()) include(line)
  }
  const borderBottom = parseFloat(style.borderBottomWidth || '0')
  const contentHeight = Number.isFinite(contentTop) ? bottom - contentTop + paddingTop + borderTop + borderBottom : 0
  return Math.max(24, Math.ceil(bottom - rect.top + borderBottom), Math.ceil(contentHeight))
}

function containerMinimumWidth (element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  const style = getComputedStyle(element)
  let right = rect.left + parseFloat(style.borderLeftWidth || '0') + parseFloat(style.paddingLeft || '0')
  for (const child of element.querySelectorAll<HTMLElement>('img, svg, video, canvas, input, textarea, select, button, hr')) {
    if (child.getClientRects().length && getComputedStyle(child).visibility !== 'hidden') right = Math.max(right, child.getBoundingClientRect().right)
  }
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (!node.textContent?.trim() || !node.parentElement?.getClientRects().length || getComputedStyle(node.parentElement).visibility === 'hidden') continue
    const range = document.createRange()
    range.selectNodeContents(node)
    for (const line of range.getClientRects()) right = Math.max(right, line.right)
  }
  return Math.max(24, Math.ceil(right - rect.left + parseFloat(style.borderRightWidth || '0')))
}

function translationOnly (element: HTMLElement) {
  const style = getComputedStyle(element)
  if ([style.scale, style.rotate, style.translate].some(value => value && value !== 'none')) return false
  const transform = style.transform
  const matrix = transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(transform)
  return matrix.is2D && matrix.a === 1 && matrix.b === 0 && matrix.c === 0 && matrix.d === 1
}

function freezeTranslatedImages (id: string, element: HTMLElement, forImageEdit = false) {
  const model = layout.value
  if (forImageEdit && frozenGroups.has(id)) {
    const baseline = pinnedImageBaselines.get(id)
    if (baseline && !baseline.imageEditing) pinnedImageBaselines.set(id, { ...baseline, imageEditing: true })
    return
  }
  if (!model || frozenGroups.has(id) || !['static', 'relative'].includes(getComputedStyle(element).position) || !translationOnly(element)) return
  if (![...element.childNodes].every(node => node.nodeType === Node.COMMENT_NODE ||
    (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) || node instanceof HTMLImageElement)) return
  const images = [...element.children] as HTMLImageElement[]
  if (!images.length) return
  if (!images.every(image => image.complete && (image.naturalWidth > 0 || imageHasDeclaredSize(image)) && translationOnly(image))) return
  const snapshots = images.map(image => ({ image, id: image.getAttribute(model.markerAttribute) ?? '', rect: image.getBoundingClientRect() }))
  if (!snapshots.every(item => model.targets.some(target => target.id === item.id && target.kind === 'image') && item.rect.width > 0 && item.rect.height > 0)) return
  const rect = element.getBoundingClientRect()
  const originalEdits = new Map<string, HtmlLayoutEdit | undefined>([id, ...snapshots.map(item => item.id)].map(key => {
    const original = edits.get(key)
    return [key, original ? { ...original } : undefined]
  }))
  frozenGroups.set(id, originalEdits)
  const shiftX = forImageEdit ? 0 : Math.max(0, rect.left - Math.min(...snapshots.map(item => item.rect.left)))
  const shiftY = forImageEdit ? 0 : Math.max(0, rect.top - Math.min(...snapshots.map(item => item.rect.top)))
  const containerEdit: HtmlLayoutEdit = { ...edits.get(id), id, position: 'relative', width: rect.width, height: rect.height, preservePaddingBottom: forImageEdit }
  edits.set(id, containerEdit)
  element.style.setProperty('position', 'relative', 'important')
  element.style.setProperty('width', `${rect.width}px`, 'important')
  element.style.setProperty('height', `${rect.height}px`, 'important')
  element.style.setProperty('box-sizing', 'border-box', 'important')
  // Translated inline images retain their old line boxes; absolute positions remove those ghost rows and prevent width-driven reflow.
  for (const snapshot of snapshots) {
    const edit: HtmlLayoutEdit = {
      ...edits.get(snapshot.id),
      id: snapshot.id,
      position: 'absolute',
      left: 0,
      top: 0,
      width: snapshot.rect.width,
      height: snapshot.rect.height,
      resetTransform: true,
      offsetX: 0,
      offsetY: 0
    }
    edits.set(snapshot.id, edit)
    applyLiveEdit(snapshot.id)
    const origin = snapshot.image.getBoundingClientRect()
    edit.left = snapshot.rect.left + shiftX - origin.left
    edit.top = snapshot.rect.top + shiftY - origin.top
    applyLiveEdit(snapshot.id)
  }
  applyLiveEdit(id, forImageEdit)
  pinnedImageBaselines.set(id, {
    edits: new Map([id, ...snapshots.map(item => item.id)].map(key => [key, { ...edits.get(key)! }])),
    imageEditing: forImageEdit
  })
}

function rememberContainerMedia (id: string, element: HTMLElement) {
  containerMedia.set(id, {
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
    media: [...element.querySelectorAll<HTMLElement>('img, svg, video, canvas')]
      .filter(child => child.getClientRects().length > 0)
      .map(child => {
        const rect = child.getBoundingClientRect()
        return { element: child, width: rect.width, height: rect.height }
      })
  })
}

function preserveContainerMedia (id: string, element: HTMLElement, edit: HtmlLayoutEdit) {
  const baseline = containerMedia.get(id)
  if (!baseline) return
  for (const dimension of ['width', 'height'] as const) {
    const requested = edit[dimension]
    if (requested === undefined) continue
    const fits = () => baseline.media.every(item => item.element.getBoundingClientRect()[dimension] >= item[dimension] - 0.25)
    if (fits()) continue
    let lower = requested
    let upper = Math.max(lower, baseline[dimension])
    element.style.setProperty(dimension, `${upper}px`, 'important')
    if (fits()) {
      // Flex and responsive images can shrink before a content-floor measurement.
      for (let attempt = 0; attempt < 12 && upper - lower > 0.25; attempt++) {
        const size = (lower + upper) / 2
        element.style.setProperty(dimension, `${size}px`, 'important')
        if (fits()) upper = size
        else lower = size
      }
    }
    edit[dimension] = Math.ceil(upper)
    element.style.setProperty(dimension, `${edit[dimension]}px`, 'important')
  }
}

function applyLiveEdit (id: string, preserveBounds = false) {
  const target = layout.value?.targets.find(item => item.id === id)
  if (!target || !stageRef.value || !layout.value) return
  const element = stageRef.value.querySelector<HTMLElement>(`[${layout.value.markerAttribute}="${id}"]`)
  if (!element) return
  const edit = edits.get(id)
  if (!edit) return
  if (target.kind === 'container' && (edit.width !== undefined || edit.height !== undefined) && !containerMedia.has(id)) rememberContainerMedia(id, element)
  if (edit.position !== undefined) element.style.setProperty('position', edit.position, 'important')
  if (edit.left !== undefined) element.style.setProperty('left', `${edit.left}px`, 'important')
  if (edit.top !== undefined) element.style.setProperty('top', `${edit.top}px`, 'important')
  if (edit.width !== undefined || edit.height !== undefined) element.style.setProperty('box-sizing', 'border-box', 'important')
  if ((edit.width !== undefined || edit.height !== undefined || edit.offsetX || edit.offsetY) && ['span', 'label'].includes(target.tagName) && getComputedStyle(element).display === 'inline') {
    element.style.display = 'inline-block'
  }
  if (edit.width !== undefined) {
    element.style.setProperty('width', `${edit.width}px`, 'important')
    element.style.setProperty('min-width', '0', 'important')
    element.style.setProperty('max-width', 'none', 'important')
  }
  if (edit.height !== undefined) {
    element.style.setProperty('height', `${edit.height}px`, 'important')
    element.style.setProperty('min-height', '0', 'important')
    element.style.setProperty('max-height', 'none', 'important')
    if (target.kind === 'container' && !edit.preservePaddingBottom) element.style.setProperty('padding-bottom', '0', 'important')
  }
  if (edit.resetTransform) {
    element.style.setProperty('transform', 'none', 'important')
    element.dataset.layoutOriginalTransform = 'none'
  }
  if (edit.offsetX !== undefined || edit.offsetY !== undefined) {
    const original = element.dataset.layoutOriginalTransform ?? element.style.transform
    element.dataset.layoutOriginalTransform = original
    element.style.setProperty('transform', `translate(${edit.offsetX ?? 0}px, ${edit.offsetY ?? 0}px) ${original === 'none' ? '' : original}`.trim(), 'important')
    if (id === layout.value.rootTargetId && target.kind === 'container' && edit.offsetY !== undefined) {
      const originalMargin = element.dataset.layoutOriginalMarginBottom ?? element.style.marginBottom
      const priority = element.dataset.layoutOriginalMarginPriority ?? element.style.getPropertyPriority('margin-bottom')
      element.dataset.layoutOriginalMarginBottom = originalMargin
      element.dataset.layoutOriginalMarginPriority = priority
      const base = originalMargin && !['auto', 'initial', 'inherit', 'unset', 'revert', 'revert-layer'].includes(originalMargin) ? originalMargin : '0px'
      if (edit.offsetY) element.style.setProperty('margin-bottom', `max(0px, ${edit.offsetY}px, calc(${base} + ${edit.offsetY}px))`, 'important')
      else if (originalMargin) element.style.setProperty('margin-bottom', originalMargin, priority)
      else element.style.removeProperty('margin-bottom')
    }
  }
  if (target.kind === 'container' && (edit.width !== undefined || edit.height !== undefined) && !preserveBounds && imageRootLock?.id !== id) {
    if (edit.width !== undefined) {
      const minimum = containerMinimumWidth(element)
      if (edit.width < minimum) {
        edit.width = minimum
        element.style.setProperty('width', `${minimum}px`, 'important')
      }
    }
    if (edit.height !== undefined) {
      const minimum = containerMinimumHeight(element)
      if (edit.height < minimum) {
        edit.height = minimum
        element.style.setProperty('height', `${minimum}px`, 'important')
      }
    }
    preserveContainerMedia(id, element, edit)
  }
  if (edit.text !== undefined && target.textEditable) element.textContent = edit.text
  updateSelectionFrame()
}

async function renderPreview (preferredId = '') {
  if (!stageRef.value || !layout.value) return
  containerMedia.clear()
  stageRef.value.innerHTML = sanitize(prepareResponsiveHtmlLayoutPreview(layout.value), {
    ...EXPORT_DOMPURIFY_CONFIG,
    ADD_ATTR: [...EXPORT_DOMPURIFY_CONFIG.ADD_ATTR, layout.value.markerAttribute],
    FORBID_TAGS: ['style', 'iframe', 'object', 'embed']
  })
  selectedId.value = layout.value.targets.some(item => item.id === preferredId) ? preferredId : ''
  for (const target of layout.value.targets) {
    const element = stageRef.value.querySelector<HTMLElement>(`[${layout.value.markerAttribute}="${target.id}"]`)
    if (element) element.style.cursor = 'move'
  }
  // Pinned children must be in place before container bounds are measured.
  const orderedTargets = [...layout.value.targets].sort((a, b) => {
    if (a.kind !== b.kind && (a.kind === 'container' || b.kind === 'container')) return a.kind === 'container' ? 1 : -1
    return a.kind === 'container' ? b.path.length - a.path.length : 0
  })
  for (const target of orderedTargets) if (edits.has(target.id)) applyLiveEdit(target.id)
  await nextTick()
  observePreview()
  updateSelectionFrame()
}

function observePreview () {
  resizeObserver?.disconnect()
  if (!stageRef.value || !resizeObserver) return
  resizeObserver.observe(stageRef.value)
  for (const element of stageRef.value.querySelectorAll<HTMLElement>(`[${layout.value?.markerAttribute}]`)) resizeObserver.observe(element)
}

function minimumHeight () {
  if (imageRootLock?.id === layout.value?.rootTargetId) return undefined
  if (!layout.value?.rootContainer || !stageRef.value || ![...edits.values()].some(edit =>
    edit.width !== undefined || edit.height !== undefined || edit.offsetX !== undefined || edit.offsetY !== undefined
  )) return undefined
  const root = stageRef.value.firstElementChild as HTMLElement | null
  if (!root) return undefined
  // The root's translated position reserves flow via margin; adding it to its own height would enlarge it twice.
  return Math.max(24, Math.ceil(root.getBoundingClientRect().height), containerMinimumHeight(root))
}

function flushDraft () {
  if (!layout.value || mode.value === 'source') return sourceText.value
  const html = applyHtmlLayoutEdits(layout.value, [...edits.values()], { minimumHeight: minimumHeight() })
  sourceText.value = stageRef.value ? serializeResponsiveHtmlLayout(layout.value, stageRef.value, html) : html
  return sourceText.value
}

async function rebuildPreview (html: string, preferredId = '') {
  const activeSession = session
  layout.value = createHtmlLayoutDocument(html, resolveImageSource)
  sourceText.value = html
  edits.clear()
  frozenGroups.clear()
  pinnedImageBaselines.clear()
  imageRootLock = null
  await nextTick()
  if (session !== activeSession || !visible.value) return
  await renderPreview(preferredId || layout.value.rootTargetId)
}

async function refreshCanvasWidth () {
  widthRefreshRequested = true
  if (widthRefreshing) return
  widthRefreshing = true
  try {
    while (widthRefreshRequested) {
      if (!visible.value || !session) break
      widthRefreshRequested = false
      const activeSession = session
      const width = activeSession.preview.getBoundingClientRect().width
      if (width <= 0 || Math.abs(width - canvasWidth.value) < 0.05) continue
      endPointer()
      const selectedPath = selected.value?.path.join('/')
      const html = flushDraft()
      canvasWidth.value = width
      await rebuildPreview(html)
      if (session !== activeSession || !visible.value) continue
      const target = layout.value?.targets.find(target => target.path.join('/') === selectedPath)
      if (target) selectedId.value = target.id
      updateSelectionFrame()
    }
  } catch {
    if (session && visible.value) error.value = '未能同步正文宽度，请关闭后重新打开此 HTML 块。当前文档未修改。'
  } finally {
    widthRefreshing = false
  }
}

async function open (payload: IEditHtmlLayoutPayload, dirname = '', imagePicker?: ImagePicker, imageDeleter?: (sources: string[], commit: () => boolean, linksOnly: string[]) => Promise<boolean>, imageReleaser?: (sources: string[]) => Promise<void>) {
  if (visible.value) close()
  session = payload
  pickImage = imagePicker ?? null
  deleteDraftImages = imageDeleter ?? null
  releaseDraftImages = imageReleaser ?? null
  addedImageSources.clear()
  removedImageSources.clear()
  linksOnlyImageSources.clear()
  keepRatio.value = true
  addingImage.value = false
  documentDirectory = dirname
  originalFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  imageSources = new Map()
  const sourceImages = new DOMParser().parseFromString(payload.html, 'text/html').querySelectorAll('img')
  const renderedImages = payload.preview.querySelectorAll('img')
  sourceImages.forEach((image, index) => {
    const src = image.getAttribute('src')
    const rendered = renderedImages[index]
    if (src && rendered) imageSources.set(src, rendered.currentSrc || rendered.src)
  })
  canvasWidth.value = Math.max(1, payload.preview.getBoundingClientRect().width || 720)
  mode.value = 'visual'
  validationCanvas = null
  error.value = ''
  selectedId.value = ''
  visible.value = true
  emit('openChange', true)
  await rebuildPreview(payload.html)
  if (session !== payload || !visible.value) return
  resizeObserver?.disconnect()
  resizeObserver = new ResizeObserver(updateSelectionFrame)
  observePreview()
  widthObserver = new ResizeObserver(refreshCanvasWidth)
  widthObserver.observe(payload.preview)
  dialogRef.value?.focus({ preventScroll: true })
  payload.restoreViewport()
}

function selectFromList (event: Event) {
  endPointer()
  const id = (event.target as HTMLSelectElement).value
  selectedId.value = layout.value?.targets.some(target => target.id === id) ? id : ''
  error.value = ''
  updateSelectionFrame()
}

async function deleteImage () {
  if (selected.value?.kind !== 'image' || addingImage.value || applying.value) return
  endPointer()
  const path = selected.value.path.join('/')
  const html = flushDraft()
  const activeSession = session
  const choice = await askImageRemoval()
  if (choice === 'cancel' || !visible.value || session !== activeSession || html !== flushDraft() || selected.value?.path.join('/') !== path) return
  const model = createHtmlLayoutDocument(html)
  const target = model.targets.find(target => target.kind === 'image' && target.path.join('/') === path)
  if (!target) return
  if (target.src && choice === 'files') removedImageSources.add(target.src)
  if (target.src && choice === 'links') linksOnlyImageSources.add(target.src)
  error.value = ''
  await rebuildPreview(removeHtmlLayoutImage(model, target.id))
}

async function addImage (source?: File | 'clipboard') {
  if (!pickImage || !layout.value?.rootTargetId || addingImage.value || applying.value) return
  endPointer()
  const activeSession = session
  const release = releaseDraftImages
  const originalDraft = flushDraft()
  addingImage.value = true
  error.value = ''
  try {
    const image = await pickImage(source)
    if (!image) return
    if (session !== activeSession || !visible.value) { await release?.([image.src]); return }
    addedImageSources.add(image.src)
    if (image.dirname) documentDirectory = image.dirname
    const bitmap = new Image()
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => { bitmap.onload = null; bitmap.onerror = null; reject(new Error('图片加载超时，请检查原图文件。')) }, 10000)
      bitmap.onload = () => { clearTimeout(deadline); resolve() }
      bitmap.onerror = () => { clearTimeout(deadline); reject(new Error('图片无法加载，请检查原图文件。')) }
      bitmap.src = resolveImageSource(image.src)
    })
    if (session !== activeSession || !visible.value || mode.value !== 'visual' || flushDraft() !== originalDraft) return
    const root = outerElement()
    const model = layout.value
    const stage = stageRef.value
    if (!root || !model?.rootTargetId || !stage) return
    const rect = root.getBoundingClientRect()
    const bounds = imageBounds(root)
    const blockers = visibleImages(root).map(image => {
      const box = image.getBoundingClientRect()
      return { left: box.left - bounds.left, top: box.top - bounds.top, width: box.width, height: box.height }
    })
    const box = placeHtmlLayoutImage({ width: bitmap.naturalWidth, height: bitmap.naturalHeight }, bounds, blockers)
    const base = applyHtmlLayoutEdits(model, [
      ...[...edits.values()].filter(edit => edit.id !== model.rootTargetId),
      { ...edits.get(model.rootTargetId), id: model.rootTargetId, width: rect.width, height: rect.height, position: 'relative', preservePaddingBottom: true }
    ], { minimumHeight: minimumHeight() })
    const frozen = serializeResponsiveHtmlLayout(model, stage, base)
    const frozenModel = createHtmlLayoutDocument(frozen)
    const length = (value: number, extent: number) => responsiveHtmlLayoutLength(value, extent)
    const css = `position: absolute !important; left: ${length(box.left, bounds.width)} !important; top: ${length(box.top, bounds.height)} !important; width: ${length(box.width, bounds.width)} !important; height: ${length(box.height, bounds.height)} !important; margin: 0 !important; padding: 0 !important; border: 0 !important; box-sizing: border-box !important; min-width: 0 !important; min-height: 0 !important; max-width: none !important; max-height: none !important; object-fit: contain;`
    // All new positions are relative to the root padding box, whose dimensions exclude its borders.
    const html = appendHtmlLayoutImage(frozenModel, { ...image, style: css })
    const added = createHtmlLayoutDocument(html).targets.filter(target => target.kind === 'image').at(-1)
    await rebuildPreview(html, added?.id)
  } catch (cause) {
    if (session === activeSession && visible.value) error.value = cause instanceof Error ? cause.message : '添加图片失败，请检查图片文件和笔记目录。'
  } finally {
    if (session === activeSession) addingImage.value = false
  }
}

function handlePaste (event: ClipboardEvent) {
  if (mode.value !== 'visual' || !visible.value) return
  event.preventDefault()
  event.stopPropagation()
  const image = [...(event.clipboardData?.files ?? [])].find(file => file.type.startsWith('image/'))
  addImage(image || 'clipboard').catch(() => { error.value = '添加图片失败，请重新打开图片编辑窗口。' })
}

function reloadImages () {
  const model = layout.value
  if (!model || !stageRef.value) return
  for (const image of stageRef.value.querySelectorAll('img')) {
    const target = model.targets.find(target => target.id === image.getAttribute(model.markerAttribute))
    if (!target?.src) continue
    const url = resolveHtmlImageSource(target.src, documentDirectory)
    if (!/^file:/i.test(url)) continue
    const fresh = new URL(url)
    fresh.searchParams.set('mtlayout', `${Date.now()}-${++imageReload}`)
    imageSources.set(target.src, fresh.href)
    image.src = fresh.href
  }
}

function selectContainer () {
  endPointer()
  selectedId.value = layout.value?.rootTargetId ?? ''
  error.value = ''
  updateSelectionFrame()
}

function startOuterPointer (event: PointerEvent, operation: 'move' | 'resize-top' | 'resize-bottom') {
  if (event.button !== 0 || !layout.value?.rootTargetId) return
  event.preventDefault()
  event.stopPropagation()
  selectContainer()
  beginPointer(event, operation)
}

function fitContainer () {
  const element = selectedElement()
  if (!element || selected.value?.kind !== 'container') return
  endPointer()
  imageRootLock = null
  freezeTranslatedImages(selectedId.value, element)
  rememberContainerMedia(selectedId.value, element)
  const edit: HtmlLayoutEdit = { ...edits.get(selectedId.value), id: selectedId.value, height: 24, preservePaddingBottom: false }
  edits.set(selectedId.value, edit)
  // Applying the trial height first lets flex/grid children reflow before their safe content floor is measured.
  for (let attempt = 0; attempt < 4; attempt++) {
    applyLiveEdit(selectedId.value)
    const height = containerMinimumHeight(element)
    if (height === edit.height) break
    edit.height = height
  }
  applyLiveEdit(selectedId.value)
}

function startMove (event: PointerEvent) {
  if (event.button !== 0 || !layout.value) return
  event.preventDefault()
  event.stopPropagation()
  endPointer()
  const model = layout.value
  let node = event.target instanceof Element ? event.target.closest<HTMLElement>(`[${model.markerAttribute}]`) : null
  // Nested formatting and wrapper nodes can have markers without being editable objects.
  while (node && stageRef.value?.contains(node) && !model.targets.some(target => target.id === node?.getAttribute(model.markerAttribute))) {
    node = node.parentElement?.closest<HTMLElement>(`[${model.markerAttribute}]`) ?? null
  }
  if (!node || !stageRef.value?.contains(node)) {
    selectedId.value = ''
    updateSelectionFrame()
    return
  }
  selectedId.value = node.getAttribute(model.markerAttribute) || ''
  error.value = ''
  updateSelectionFrame()
  beginPointer(event, 'move')
}

function startResize (event: PointerEvent, operation: 'resize' | 'resize-top' | 'resize-bottom' = 'resize') {
  if (event.button !== 0 || !selected.value) return
  event.preventDefault()
  event.stopPropagation()
  endPointer()
  beginPointer(event, operation)
}

function beginPointer (event: PointerEvent, operation: 'move' | 'resize' | 'resize-top' | 'resize-bottom') {
  const element = selectedElement()
  const stage = stageRef.value
  if (!element || !stage) return
  const rect = element.getBoundingClientRect()
  const stageRect = stage.getBoundingClientRect()
  const edit = edits.get(selectedId.value)
  pointerSession = {
    pointerId: event.pointerId,
    operation,
    x: event.clientX,
    y: event.clientY,
    width: rect.width,
    height: rect.height,
    offsetX: edit?.offsetX ?? 0,
    offsetY: edit?.offsetY ?? 0,
    baseLeft: rect.left - stageRect.left - (edit?.offsetX ?? 0),
    baseTop: rect.top - stageRect.top - (edit?.offsetY ?? 0),
    moved: false
  }
  window.addEventListener('pointermove', movePointer, { capture: true })
  window.addEventListener('pointerup', handlePointerUp, { capture: true })
  window.addEventListener('pointercancel', cancelPointer, { capture: true })
  window.addEventListener('blur', endPointer, { capture: true })
}

function boundedSize (value: number) {
  return Math.max(24, Math.min(6000, Math.round(value)))
}

function imageAspectRatio (scene: ImageScene) {
  const image = scene.element
  return image instanceof HTMLImageElement && image.naturalWidth > 0 && image.naturalHeight > 0
    ? image.naturalWidth / image.naturalHeight
    : scene.rect.width / scene.rect.height
}

function imageOverflow (rect: DOMRect, bounds: LayoutFrame) {
  return [Math.max(0, bounds.left - rect.left), Math.max(0, bounds.top - rect.top),
    Math.max(0, rect.right - bounds.left - bounds.width), Math.max(0, rect.bottom - bounds.top - bounds.height)]
}

function imageBounds (root: HTMLElement): LayoutFrame {
  const rect = root.getBoundingClientRect()
  const style = getComputedStyle(root)
  const borderLeft = parseFloat(style.borderLeftWidth) || 0
  const borderTop = parseFloat(style.borderTopWidth) || 0
  return {
    left: rect.left + borderLeft,
    top: rect.top + borderTop,
    width: rect.width - borderLeft - (parseFloat(style.borderRightWidth) || 0),
    height: rect.height - borderTop - (parseFloat(style.borderBottomWidth) || 0)
  }
}

function visibleImages (root: HTMLElement) {
  return [...root.querySelectorAll('img')].filter(image => {
    if (!image.getClientRects().length || ['hidden', 'collapse'].includes(getComputedStyle(image).visibility)) return false
    let ancestor: HTMLElement | null = image
    while (ancestor) {
      const style = getComputedStyle(ancestor)
      if (Number(style.opacity) === 0) return false
      if (ancestor === root) break
      ancestor = ancestor.parentElement
    }
    return true
  })
}

function imageHasDeclaredSize (image: HTMLImageElement) {
  if (image.parentElement && isResponsiveHtmlLayoutContainer(image.parentElement) &&
    ['width', 'height'].every(dimension => {
      const value = image.style.getPropertyValue(dimension)
      const responsiveLength = /^-?(?:\d+(?:\.\d*)?|\.\d+)%$/.test(value) ||
        (/^calc\(/i.test(value) && !/(?:var|env)\s*\(/i.test(value))
      return responsiveLength && CSS.supports(dimension, value)
    })) {
    const rect = image.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) return true
  }
  const declaredDimension = (dimension: 'width' | 'height') => {
    const style = image.style.getPropertyValue(dimension).trim()
    if (style) return /^(?:\d+(?:\.\d*)?|\.\d+)(?:px|em|rem|ex|ch|ic|cap|lh|rlh|vw|vh|vi|vb|vmin|vmax|svw|svh|lvw|lvh|dvw|dvh|cm|mm|q|in|pt|pc)$/i.test(style) && parseFloat(style) > 0
    const attribute = image.getAttribute(dimension)
    return attribute !== null && /^\d+(?:\.\d+)?$/.test(attribute.trim()) && Number.isFinite(Number(attribute)) && Number(attribute) > 0
  }
  const width = declaredDimension('width')
  const height = declaredDimension('height')
  const ratio = /^(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?$/.exec(image.style.aspectRatio)
  const definiteRatio = ratio !== null && [Number(ratio[1]), Number(ratio[2] ?? 1)].every(value => Number.isFinite(value) && value > 0)
  return (width && height) || ((width || height) && definiteRatio)
}

function prepareImageScene (): ImageScene | undefined {
  const root = outerElement()
  const model = layout.value
  if (!root || !model) return
  const initialRect = selectedElement()?.getBoundingClientRect()
  if (!initialRect || ![initialRect.width, initialRect.height].every(value => Number.isFinite(value) && value > 0)) {
    error.value = '图片尚未加载或尺寸为零，请加载图片后再调整。'
    return
  }
  if (!translationOnly(root)) {
    error.value = '整体外框含旋转或缩放，请切换到 HTML 源码调整外框后再编辑图片。'
    return
  }
  const originalEdits = new Map([...edits].map(([id, edit]) => [id, { ...edit }]))
  const originalGroups = new Map(frozenGroups)
  const originalBaselines = new Map(pinnedImageBaselines)
  const originalMedia = new Map(containerMedia)
  const originalLock = imageRootLock
  const styles = [root, ...root.querySelectorAll<HTMLElement>(`[${model.markerAttribute}]`)].map(element => ({
    element, style: element.style.cssText, transform: element.dataset.layoutOriginalTransform
  }))
  const rollback = () => {
    if (pointerSession) pointerSession.imageScene = undefined
    endPointer()
    edits.clear()
    for (const [id, edit] of originalEdits) edits.set(id, edit)
    frozenGroups.clear()
    for (const [id, group] of originalGroups) frozenGroups.set(id, group)
    pinnedImageBaselines.clear()
    for (const [id, group] of originalBaselines) pinnedImageBaselines.set(id, group)
    containerMedia.clear()
    for (const [id, media] of originalMedia) containerMedia.set(id, media)
    imageRootLock = originalLock
    for (const item of styles) {
      item.element.style.cssText = item.style
      if (item.transform === undefined) delete item.element.dataset.layoutOriginalTransform
      else item.element.dataset.layoutOriginalTransform = item.transform
    }
    updateSelectionFrame()
  }
  if (model.rootTargetId) {
    const id = model.rootTargetId
    const original = edits.get(id) ? { ...edits.get(id)! } : undefined
    freezeTranslatedImages(id, root, true)
    const rect = root.getBoundingClientRect()
    const generated: HtmlLayoutEdit = { ...edits.get(id), id, width: rect.width, height: rect.height, preservePaddingBottom: true }
    if (!imageRootLock) imageRootLock = { id, original, generated }
    edits.set(id, generated)
    applyLiveEdit(id)
  }
  const element = selectedElement()
  if (!element) {
    rollback()
    return
  }
  const bounds = imageBounds(root)
  if (bounds.width <= 0 || bounds.height <= 0) {
    rollback()
    return
  }
  return {
    root,
    element,
    bounds,
    rect: element.getBoundingClientRect(),
    rollback,
    edit: edits.get(selectedId.value) ? { ...edits.get(selectedId.value)! } : undefined,
    style: element.style.cssText,
    originalTransform: element.dataset.layoutOriginalTransform,
    snapImages: visibleImages(root)
      .filter(image => image !== element)
      .map((image, index) => {
        const rect = image.getBoundingClientRect()
        return {
          id: image.getAttribute(model.markerAttribute) ?? `snap-image-${index}`,
          rectangle: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
        }
      })
      .filter(image => image.rectangle.width > 0 && image.rectangle.height > 0),
    media: [...new Set([
      ...root.querySelectorAll<HTMLElement>('img, svg, video, canvas'),
      ...model.targets.filter(target => target.id !== model.rootTargetId)
        .map(target => root.querySelector<HTMLElement>(`[${model.markerAttribute}="${target.id}"]`))
        .filter((element): element is HTMLElement => element !== null)
    ])]
      .filter(child => child.getClientRects().length > 0)
      .map(child => ({ element: child, overflow: imageOverflow(child.getBoundingClientRect(), bounds) }))
  }
}

function imageSceneUnchanged (scene: ImageScene) {
  const rect = scene.element.getBoundingClientRect()
  const root = outerElement()
  const outer = root?.getBoundingClientRect()
  const style = root && getComputedStyle(root)
  const shiftX = outer ? outer.left + (parseFloat(style!.borderLeftWidth) || 0) - scene.bounds.left : 0
  const shiftY = outer ? outer.top + (parseFloat(style!.borderTopWidth) || 0) - scene.bounds.top : 0
  return Math.abs(rect.left - shiftX - scene.rect.left) < 0.001 &&
    Math.abs(rect.top - shiftY - scene.rect.top) < 0.001 &&
    Math.abs(rect.width - scene.rect.width) < 0.001 && Math.abs(rect.height - scene.rect.height) < 0.001
}

function finishImageEdit (scene: ImageScene) {
  if (pointerSession?.imageScene !== scene && imageSceneUnchanged(scene)) scene.rollback()
  error.value = ''
}

function applyBoundedImageEdit (scene: ImageScene, requested: HtmlLayoutEdit, resizing: boolean) {
  const id = selectedId.value
  const bounds = imageBounds(scene.root)
  if (!resizing) {
    const rect = scene.element.getBoundingClientRect()
    const current = edits.get(id)
    const offsetX = current?.offsetX ?? 0
    const offsetY = current?.offsetY ?? 0
    const offsets = clampHtmlLayoutImageOffset({
      left: rect.left, top: rect.top, width: rect.width, height: rect.height, offsetX, offsetY
    }, bounds, (requested.offsetX ?? 0) - offsetX, (requested.offsetY ?? 0) - offsetY)
    edits.set(id, { ...requested, ...offsets })
    applyLiveEdit(id)
    finishImageEdit(scene)
    return
  }
  const restore = () => {
    scene.element.style.cssText = scene.style
    if (scene.originalTransform === undefined) delete scene.element.dataset.layoutOriginalTransform
    else scene.element.dataset.layoutOriginalTransform = scene.originalTransform
    if (scene.edit) edits.set(id, { ...scene.edit })
    else edits.delete(id)
  }
  const trial = (candidate: HtmlLayoutEdit) => {
    restore()
    edits.set(id, candidate)
    applyLiveEdit(id)
    const rect = scene.element.getBoundingClientRect()
    const offsets = clampHtmlLayoutImageOffset({
      offsetX: candidate.offsetX ?? 0,
      offsetY: candidate.offsetY ?? 0,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    }, bounds, 0, 0)
    if (Math.abs(offsets.offsetX - (candidate.offsetX ?? 0)) > 0.001 || Math.abs(offsets.offsetY - (candidate.offsetY ?? 0)) > 0.001) {
      Object.assign(candidate, offsets)
      applyLiveEdit(id)
    }
    return imageOverflow(scene.element.getBoundingClientRect(), bounds).every(value => value <= 0.05) &&
      scene.media.every(item => imageOverflow(item.element.getBoundingClientRect(), bounds)
        .every((value, index) => value <= item.overflow[index] + 0.05))
  }
  let candidate = { ...requested }
  if (resizing) {
    const available = {
      width: bounds.width - Math.max(scene.rect.left - scene.bounds.left, 0),
      height: bounds.height - Math.max(scene.rect.top - scene.bounds.top, 0)
    }
    if (available.width <= 0 || available.height <= 0) {
      scene.rollback()
      error.value = '图片在整体外框之外，请先移动图片或调整外框。'
      return
    }
    Object.assign(candidate, fitHtmlLayoutImageSize({ width: requested.width!, height: requested.height! }, available, keepRatio.value))
  }
  if (trial(candidate)) {
    finishImageEdit(scene)
    return
  }
  if (resizing) {
    // A legal image size can still wrap or push its siblings outside the fixed HTML frame.
    const baseline = { ...scene.edit, id, width: scene.rect.width, height: scene.rect.height }
    if (trial({ ...baseline })) {
      let lower = 0
      let upper = 1
      for (let attempt = 0; attempt < 20; attempt++) {
        const scale = (lower + upper) / 2
        const probe = {
          ...baseline,
          width: scene.rect.width + (candidate.width! - scene.rect.width) * scale,
          height: scene.rect.height + (candidate.height! - scene.rect.height) * scale
        }
        if (trial(probe)) lower = scale
        else upper = scale
      }
      candidate = {
        ...baseline,
        width: scene.rect.width + (candidate.width! - scene.rect.width) * lower,
        height: scene.rect.height + (candidate.height! - scene.rect.height) * lower
      }
      trial(candidate)
      finishImageEdit(scene)
      updateSelectionFrame()
      return
    }
  }
  restore()
  scene.rollback()
  updateSelectionFrame()
  error.value = '图片不能超出整体 HTML 外框，请缩小图片或移回外框内。'
}

function imageMovePreview (scene: ImageScene, dx: number, dy: number, enabled: boolean) {
  const bounds = imageBounds(scene.root)
  const shiftX = bounds.left - scene.bounds.left
  const shiftY = bounds.top - scene.bounds.top
  const requested = { left: scene.rect.left + dx, top: scene.rect.top + dy, width: scene.rect.width, height: scene.rect.height }
  const images = scene.snapImages.map(image => ({
    ...image, rectangle: { ...image.rectangle, left: image.rectangle.left + shiftX, top: image.rectangle.top + shiftY }
  }))
  return { ...previewHtmlLayoutImageSnap(requested, bounds, images, { enabled }), shiftX, shiftY }
}

function movePointer (event: PointerEvent) {
  const pointer = pointerSession
  if (!pointer || !selected.value || event.pointerId !== pointer.pointerId) return
  event.preventDefault()
  const dx = event.clientX - pointer.x
  const dy = event.clientY - pointer.y
  if (!pointer.moved && Math.abs(dx) + Math.abs(dy) < 2) return
  if (!pointer.moved && selected.value.kind === 'container') {
    const element = selectedElement()
    const stage = stageRef.value
    if (!element || !stage) return
    if (pointer.operation !== 'move') freezeTranslatedImages(selectedId.value, element)
    rememberContainerMedia(selectedId.value, element)
    const rect = element.getBoundingClientRect()
    const stageRect = stage.getBoundingClientRect()
    const baseline = edits.get(selectedId.value)
    pointer.width = rect.width
    pointer.height = rect.height
    pointer.offsetX = baseline?.offsetX ?? 0
    pointer.offsetY = baseline?.offsetY ?? 0
    pointer.baseLeft = rect.left - stageRect.left - pointer.offsetX
    pointer.baseTop = rect.top - stageRect.top - pointer.offsetY
  }
  if (!pointer.moved && selected.value.kind === 'image') {
    pointer.imageScene = prepareImageScene()
    if (!pointer.imageScene) return
    pointer.width = pointer.imageScene.rect.width
    pointer.height = pointer.imageScene.rect.height
    pointer.offsetX = pointer.imageScene.edit?.offsetX ?? 0
    pointer.offsetY = pointer.imageScene.edit?.offsetY ?? 0
  }
  pointer.moved = true
  const edit: HtmlLayoutEdit = { ...edits.get(selectedId.value), id: selectedId.value }
  if (selected.value.kind === 'image' && pointer.imageScene) {
    if (pointer.operation === 'move') {
      const scene = pointer.imageScene
      const rect = scene.rect
      const preview = imageMovePreview(scene, dx, dy, snapEnabled.value && !event.altKey)
      const root = scene.root.getBoundingClientRect()
      snapGuides.value = preview.guides.map(guide => ({
        ...guide,
        position: guide.position - (guide.axis === 'x' ? root.left : root.top),
        start: guide.start - (guide.axis === 'x' ? root.top : root.left),
        end: guide.end - (guide.axis === 'x' ? root.top : root.left)
      }))
      edit.offsetX = pointer.offsetX + preview.rectangle.left - rect.left - preview.shiftX
      edit.offsetY = pointer.offsetY + preview.rectangle.top - rect.top - preview.shiftY
    } else {
      const change = keepRatio.value ? (dx * pointer.width + dy * pointer.height) * pointer.width / (pointer.width ** 2 + pointer.height ** 2) : dx
      edit.width = boundedSize(pointer.width + change)
      edit.height = keepRatio.value ? edit.width / imageAspectRatio(pointer.imageScene) : boundedSize(pointer.height + dy)
    }
    applyBoundedImageEdit(pointer.imageScene, edit, pointer.operation !== 'move')
    return
  }
  if (selected.value.kind === 'container') {
    imageRootLock = null
    if (pointer.operation !== 'move') edit.preservePaddingBottom = false
  }
  if (pointer.operation === 'move') {
    edit.offsetX = Math.round(Math.max(-pointer.baseLeft, Math.min(canvasWidth.value - pointer.width - pointer.baseLeft, pointer.offsetX + dx)))
    edit.offsetY = Math.round(Math.max(-pointer.baseTop, pointer.offsetY + dy))
    if (!layout.value?.rootContainer && stageRef.value) {
      edit.offsetY = Math.min(edit.offsetY, Math.max(0, stageRef.value.getBoundingClientRect().height - pointer.height))
    }
  } else if (pointer.operation === 'resize-top' || pointer.operation === 'resize-bottom') {
    edit.height = boundedSize(pointer.height + (pointer.operation === 'resize-top' ? -dy : dy))
    edits.set(selectedId.value, edit)
    applyLiveEdit(selectedId.value)
    if (pointer.operation === 'resize-top') {
      edit.offsetY = Math.round(Math.max(-pointer.baseTop, pointer.offsetY + pointer.height - edit.height))
      edits.set(selectedId.value, edit)
      applyLiveEdit(selectedId.value)
    }
    return
  } else {
    edit.width = boundedSize(pointer.width + dx)
    edit.height = boundedSize(pointer.height + dy)
  }
  edits.set(selectedId.value, edit)
  applyLiveEdit(selectedId.value)
}

function handlePointerUp (event: PointerEvent) {
  const pointer = pointerSession
  if (!pointer || pointer.pointerId !== event.pointerId) return
  movePointer(event)
  const scene = pointer.imageScene
  if (pointerSession === pointer && pointer.moved && pointer.operation === 'move' && scene) {
    const preview = imageMovePreview(scene, event.clientX - pointer.x, event.clientY - pointer.y, snapEnabled.value && !event.altKey)
    const edit = {
      ...edits.get(selectedId.value),
      id: selectedId.value,
      offsetX: pointer.offsetX + preview.snapRectangle.left - scene.rect.left - preview.shiftX,
      offsetY: pointer.offsetY + preview.snapRectangle.top - scene.rect.top - preview.shiftY
    }
    applyBoundedImageEdit(scene, edit, false)
  }
  endPointer()
}

function cancelPointer (event: PointerEvent) {
  if (event.pointerId === pointerSession?.pointerId) endPointer()
}

function endPointer () {
  const scene = pointerSession?.imageScene
  clearSnapGuides()
  pointerSession = null
  window.removeEventListener('pointermove', movePointer, { capture: true })
  window.removeEventListener('pointerup', handlePointerUp, { capture: true })
  window.removeEventListener('pointercancel', cancelPointer, { capture: true })
  window.removeEventListener('blur', endPointer, { capture: true })
  if (scene && imageSceneUnchanged(scene)) scene.rollback()
}

function setDimension (dimension: 'width' | 'height', event: Event) {
  const input = event.target as HTMLInputElement
  const value = Number(input.value)
  if (!Number.isFinite(value) || !selected.value) return
  if (value === Math.round(dimensions[dimension]) || Math.abs(value - dimensions[dimension]) < 0.0001) return
  if (dimension === 'width' && isRootContainerSelected.value) {
    input.value = String(dimensions.width)
    return
  }
  if (selected.value.kind === 'image') {
    const scene = prepareImageScene()
    if (!scene) {
      input.value = String(dimensions[dimension])
      return
    }
    const edit: HtmlLayoutEdit = { ...scene.edit, id: selectedId.value, width: scene.rect.width, height: scene.rect.height, [dimension]: boundedSize(value) }
    if (keepRatio.value) {
      if (dimension === 'width') edit.height = edit.width! / imageAspectRatio(scene)
      else edit.width = edit.height! * imageAspectRatio(scene)
    }
    applyBoundedImageEdit(scene, edit, true)
    input.value = String(dimensions[dimension])
    return
  }
  const element = selectedElement()
  if (selected.value.kind === 'container') imageRootLock = null
  if (selected.value.kind === 'container' && element) freezeTranslatedImages(selectedId.value, element)
  if (selected.value.kind === 'container' && element) rememberContainerMedia(selectedId.value, element)
  const requestedSize = boundedSize(value)
  const edit: HtmlLayoutEdit = {
    ...(selected.value.kind === 'container' ? {} : { width: dimensions.width, height: dimensions.height }),
    ...edits.get(selectedId.value),
    id: selectedId.value,
    preservePaddingBottom: dimension === 'width' ? edits.get(selectedId.value)?.preservePaddingBottom : false,
    [dimension]: requestedSize
  }
  edits.set(selectedId.value, edit)
  applyLiveEdit(selectedId.value)
  input.value = String(dimensions[dimension])
}

function setText (event: Event) {
  if (!selected.value?.textEditable) return
  edits.set(selectedId.value, { ...edits.get(selectedId.value), id: selectedId.value, text: (event.target as HTMLTextAreaElement).value })
  applyLiveEdit(selectedId.value)
}

async function resetSelected () {
  endPointer()
  for (const [id, originalEdits] of frozenGroups) {
    if (!originalEdits.has(selectedId.value)) continue
    const pinned = pinnedImageBaselines.get(id)
    const baseline = pinned?.imageEditing ? pinned.edits : undefined
    const differentEdit = (key: string) => {
      const original = baseline?.get(key)
      const current = edits.get(key)
      if (!original || !current) return original !== current
      return [...new Set([...Object.keys(original), ...Object.keys(current)])]
        .some(property => original[property as keyof HtmlLayoutEdit] !== current[property as keyof HtmlLayoutEdit])
    }
    const changedImages = baseline && layout.value?.targets.filter(target =>
      target.kind === 'image' && baseline.has(target.id) && differentEdit(target.id)
    )
    if (baseline && selectedId.value === id && changedImages?.length) {
      const generated = { ...baseline.get(id)! }
      edits.set(id, generated)
      if (id === layout.value?.rootTargetId) imageRootLock = null
      await renderPreview(selectedId.value)
      if (id === layout.value?.rootTargetId) imageRootLock = { id, original: originalEdits.get(id), generated }
      return
    }
    if (baseline && selected.value?.kind === 'image' && (differentEdit(id) || changedImages?.some(target => target.id !== selectedId.value))) {
      edits.set(selectedId.value, { ...baseline.get(selectedId.value)! })
      await renderPreview(selectedId.value)
      return
    }
    // Absolute children depend on the positioned container; restoring either member must restore the whole transaction first.
    for (const [key, original] of originalEdits) {
      if (original) edits.set(key, { ...original })
      else edits.delete(key)
    }
    frozenGroups.delete(id)
    pinnedImageBaselines.delete(id)
  }
  edits.delete(selectedId.value)
  if (imageRootLock && !layout.value?.targets.some(target => target.kind === 'image' && edits.has(target.id))) {
    const current = edits.get(imageRootLock.id)
    if (current?.preservePaddingBottom && current.width === imageRootLock.generated.width && current.height === imageRootLock.generated.height) {
      if (imageRootLock.original) edits.set(imageRootLock.id, imageRootLock.original)
      else edits.delete(imageRootLock.id)
    }
    imageRootLock = null
  }
  await renderPreview(selectedId.value)
}

async function reorder (direction: 'previous' | 'next') {
  if (!layout.value || !selected.value) return
  const oldTarget = selected.value
  const html = flushDraft()
  const document = createHtmlLayoutDocument(html, resolveImageSource)
  // Style patches change source offsets; the DOM path still identifies the selected object.
  const currentTarget = document.targets.find(target => JSON.stringify(target.path) === JSON.stringify(oldTarget.path))
  if (!currentTarget) return
  const result = reorderHtmlLayoutTarget(document, currentTarget.id, direction)
  if (result === html) return
  const nextPath = [...currentTarget.path]
  nextPath[nextPath.length - 1] += direction === 'previous' ? -1 : 1
  const nextDocument = createHtmlLayoutDocument(result, resolveImageSource)
  const nextId = nextDocument.targets.find(target => JSON.stringify(target.path) === JSON.stringify(nextPath))?.id || ''
  await rebuildPreview(result, nextId)
}

async function changeMode (nextMode: 'visual' | 'source') {
  if (mode.value === nextMode) return
  endPointer()
  if (nextMode === 'source') {
    flushDraft()
    rememberValidationCanvas()
  }
  mode.value = nextMode
  if (nextMode === 'visual') await rebuildPreview(sourceText.value)
}

function rememberValidationCanvas () {
  const canvas = canvasRef.value
  if (!canvas || mode.value !== 'visual') return
  const rect = canvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  validationCanvas = {
    frame: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    scrollLeft: canvas.scrollLeft,
    scrollTop: canvas.scrollTop
  }
}

async function waitForValidationLayout (preview: HTMLElement) {
  const removeListeners: (() => void)[] = []
  let deadline: ReturnType<typeof setTimeout> | undefined
  try {
    const images = [...preview.querySelectorAll('img')]
    const loadedImages = images.map(image => {
      image.loading = 'eager'
      if (image.complete) return Promise.resolve()
      return new Promise<void>(resolve => {
        const loaded = () => resolve()
        image.addEventListener('load', loaded, { once: true })
        image.addEventListener('error', loaded, { once: true })
        removeListeners.push(() => {
          image.removeEventListener('load', loaded)
          image.removeEventListener('error', loaded)
        })
        if (image.complete) loaded()
      })
    })
    preview.getBoundingClientRect()
    await Promise.race([
      Promise.all([...loadedImages, document.fonts.ready]).then(() => new Promise<void>(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })),
      new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => reject(new Error('HTML layout assets did not finish loading.')), 10000)
      })
    ])
  } finally {
    clearTimeout(deadline)
    for (const remove of removeListeners) remove()
  }
}

async function overlappingImagesMessage (html: string): Promise<string> {
  const sourceDocument = new DOMParser().parseFromString(html, 'text/html')
  if (sourceDocument.querySelector('style, link[rel~="stylesheet" i]')) {
    return 'HTML 中包含样式表，无法可靠检查图片重叠。请把 <style> 或外部样式表中的布局样式移到元素的 style 属性，再应用修改；当前源码已保留。'
  }
  const dialog = dialogRef.value
  if (!dialog) throw new Error('The HTML layout dialog is unavailable.')
  rememberValidationCanvas()
  const canvas = validationCanvas
  if (!canvas) throw new Error('The HTML layout preview size is unavailable.')
  const model = createHtmlLayoutDocument(html, resolveImageSource)
  const holder = document.createElement('div')
  holder.className = 'html-layout-canvas'
  holder.setAttribute('aria-hidden', 'true')
  holder.inert = true
  Object.assign(holder.style, {
    position: 'fixed',
    left: `${canvas.frame.left}px`,
    top: `${canvas.frame.top}px`,
    width: `${canvas.frame.width}px`,
    height: `${canvas.frame.height}px`,
    clipPath: 'inset(100%)',
    pointerEvents: 'none'
  })
  const surface = document.createElement('div')
  surface.className = 'html-layout-surface'
  surface.style.minWidth = `${canvasWidth.value + 64}px`
  const preview = document.createElement('div')
  preview.className = 'html-layout-stage'
  preview.style.width = `${canvasWidth.value}px`
  preview.innerHTML = sanitize(prepareResponsiveHtmlLayoutPreview(model), {
    ...EXPORT_DOMPURIFY_CONFIG,
    ADD_ATTR: [...EXPORT_DOMPURIFY_CONFIG.ADD_ATTR, model.markerAttribute],
    FORBID_TAGS: ['style', 'iframe', 'object', 'embed']
  })
  surface.append(preview)
  holder.append(surface)
  dialog.append(holder)
  holder.scrollLeft = canvas.scrollLeft
  holder.scrollTop = canvas.scrollTop
  try {
    try {
      await waitForValidationLayout(preview)
    } catch {
      return '图片或字体仍在加载，暂时无法确认图片是否重叠。请等待加载完成后再应用修改。'
    }
    // Source mode hides the live canvas, so both modes measure the same serialized draft in a separate rendered preview.
    const visible = visibleImages(preview)
    const unmeasuredImage = visible.findIndex(image => !image.naturalWidth && !imageHasDeclaredSize(image))
    if (unmeasuredImage !== -1) {
      const image = visible[unmeasuredImage]!
      const description = image.getAttribute('alt')?.trim().slice(0, 60)
      return `第 ${unmeasuredImage + 1} 张图片${description ? `（${description}）` : ''}未能加载，无法确认实际大小。请加载图片或在源码中设置明确的像素宽高后再应用修改。`
    }
    const images = visible.map((image, index) => {
      const targetId = image.getAttribute(model.markerAttribute)
      const target = model.targets.find(item => item.id === targetId)
      const description = (image.getAttribute('alt')?.trim() || target?.label || '').slice(0, 60)
      const rect = image.getBoundingClientRect()
      return {
        id: `validation-image-${index}`,
        label: `第 ${index + 1} 张图片${description ? `（${description}）` : ''}`,
        rectangle: responsiveHtmlLayoutImageRectangle(image) ?? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      }
    })
    const pairs = findHtmlLayoutImageOverlaps(images)
    const pair = pairs[0]
    return pair
      ? `${pair.first.label}与${pair.second.label}重叠${pairs.length > 1 ? `，共发现 ${pairs.length} 对重叠图片` : ''}。请移开图片后再应用修改；当前摆放和源码已保留。`
      : ''
  } finally {
    holder.remove()
  }
}

async function apply () {
  if (applying.value || !session) return
  endPointer()
  error.value = ''
  applying.value = true
  const activeSession = session
  try {
    const html = flushDraft()
    await nextTick()
    const overlapMessage = await overlappingImagesMessage(html)
    if (session !== activeSession || !visible.value) return
    if (html !== flushDraft()) {
      error.value = '检查期间布局已修改，请再次应用以检查最新摆放。'
      return
    }
    if (overlapMessage) {
      error.value = overlapMessage
      return
    }
    const sources = [...removedImageSources].filter(src => !createHtmlLayoutDocument(html).targets.some(target => target.kind === 'image' && target.src === src))
    const linksOnly = [...linksOnlyImageSources].filter(src => !createHtmlLayoutDocument(html).targets.some(target => target.kind === 'image' && target.src === src))
    const commit = () => session === activeSession && !!session?.apply(html)
    const applied = (sources.length || linksOnly.length) && deleteDraftImages ? await deleteDraftImages(sources, commit, linksOnly) : commit()
    if (!applied) {
      error.value = '原来的 HTML 块已发生变化。请取消后重新点击该块编辑，以保留最新内容。'
      return
    }
    close()
  } catch {
    if (session === activeSession && visible.value) error.value = '未能检查或应用修改。请重新选择对象，或切换到 HTML 源码检查后再应用。'
  } finally {
    applying.value = false
  }
}

function close () {
  if (!visible.value) return
  endPointer()
  const previous = session
  const release = releaseDraftImages
  const additions = [...addedImageSources]
  releaseDraftImages = null
  addedImageSources.clear()
  release?.(additions).catch(cause => { error.value = cause instanceof Error ? cause.message : '未能清理未使用的新增图片。' })
  session = null
  pickImage = null
  deleteDraftImages = null
  removedImageSources.clear()
  linksOnlyImageSources.clear()
  addingImage.value = false
  resizeObserver?.disconnect()
  resizeObserver = null
  widthObserver?.disconnect()
  widthObserver = null
  widthRefreshRequested = false
  visible.value = false
  frozenGroups.clear()
  pinnedImageBaselines.clear()
  imageRootLock = null
  selectedId.value = ''
  frame.value = null
  outerFrame.value = null
  const focus = originalFocus
  originalFocus = null
  nextTick(() => {
    if (visible.value) return
    // Refocusing the contenteditable restores its old caret and can scroll away from this block.
    if (focus?.isConnected && !focus.isContentEditable) focus.focus({ preventScroll: true })
    previous?.restoreViewport()
    emit('openChange', false)
  })
}

function handleKeydown (event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Alt') clearSnapGuides()
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
  }
  if (event.key !== 'Tab' || !dialogRef.value) return
  const controls = [...dialogRef.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')]
    .filter(element => element.getClientRects().length > 0)
  if (!controls.length) return
  const first = controls[0]
  const last = controls[controls.length - 1]
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.value)) {
    event.preventDefault()
    last.focus({ preventScroll: true })
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus({ preventScroll: true })
  }
}

onBeforeUnmount(() => {
  session = null
  visible.value = false
  endPointer()
  resizeObserver?.disconnect()
  widthObserver?.disconnect()
})

defineExpose({ open, close, reloadImages })
</script>

<style>
.html-layout-overlay {
  position: fixed;
  inset: 0;
  z-index: 10002;
  background: rgb(0 0 0 / 42%);
  display: flex;
  padding: 28px;
  box-sizing: border-box;
  color: var(--editorColor);
}
.html-layout-dialog {
  width: 100%;
  max-width: 1600px;
  margin: auto;
  height: min(820px, calc(100vh - 56px));
  border-radius: 12px;
  background: var(--floatBgColor);
  box-shadow: 0 12px 60px rgb(0 0 0 / 30%);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  outline: none;
}
.html-layout-dialog button,
.html-layout-dialog input,
.html-layout-dialog select,
.html-layout-dialog textarea {
  font: inherit;
  color: inherit;
  background: var(--floatBgColor);
  border: 1px solid var(--editorColor10);
  border-radius: 5px;
  box-sizing: border-box;
}
.html-layout-dialog button { cursor: pointer; padding: 7px 12px; }
.html-layout-dialog button:disabled { cursor: default; opacity: .4; }
.html-layout-dialog button:focus-visible,
.html-layout-dialog input:focus-visible,
.html-layout-dialog textarea:focus-visible,
.html-layout-dialog select:focus-visible { outline: 2px solid var(--themeColor); outline-offset: 1px; }
.html-layout-header { display: flex; align-items: center; gap: 20px; padding: 16px 20px; border-bottom: 1px solid var(--editorColor10); }
.html-layout-header strong { font-size: 17px; }
.html-layout-header > button:last-child { margin-left: auto; border: 0; font-size: 24px; padding: 0 8px; }
.html-layout-tabs { display: flex; gap: 6px; }
.html-layout-tabs button.active { color: var(--themeColor); border-color: var(--themeColor); }
.html-layout-hint { margin: 0; padding: 12px 20px; color: var(--editorColor60); font-size: 13px; }
.html-layout-body { display: flex; flex: 1; min-height: 0; border-top: 1px solid var(--editorColor10); }
.html-layout-canvas { flex: 1; overflow: auto; min-width: 0; background: var(--editorBgColor, var(--floatBgColor)); }
.html-layout-surface { position: relative; padding: 32px; min-height: 100%; box-sizing: border-box; }
.html-layout-stage { min-height: 320px; font-family: var(--mu-font-family, sans-serif); line-height: 1.6; }
.html-layout-stage [data-mt-layout-target] { cursor: move; }
.html-layout-stage img { user-select: none; -webkit-user-drag: none; }
.html-layout-boundary { position: absolute; box-sizing: border-box; border: 2px dashed var(--themeColor); pointer-events: none; }
.html-layout-boundary > span { position: absolute; left: -2px; top: -25px; padding: 2px 7px; border-radius: 4px 4px 0 0; background: var(--themeColor); color: white; font-size: 12px; line-height: 19px; white-space: nowrap; }
.html-layout-boundary > span { pointer-events: auto; cursor: move; }
.html-layout-frame-edge { position: absolute; pointer-events: auto; cursor: move; }
.html-layout-frame-edge.top, .html-layout-frame-edge.bottom { left: 0; right: 0; height: 8px; }
.html-layout-frame-edge.top { top: -5px; }
.html-layout-frame-edge.bottom { bottom: -5px; }
.html-layout-frame-edge.left, .html-layout-frame-edge.right { top: 0; bottom: 0; width: 8px; }
.html-layout-frame-edge.left { left: -5px; }
.html-layout-frame-edge.right { right: -5px; }
.html-layout-snap-guide { position: absolute; z-index: 1; pointer-events: none; color: #ff77c7; }
.html-layout-snap-guide.x { width: 0; border-left: 1px dashed currentColor; }
.html-layout-snap-guide.y { height: 0; border-top: 1px dashed currentColor; }
.html-layout-snap-status-slot { display: block; height: 18px; line-height: 18px; overflow: hidden; white-space: nowrap; }
.html-layout-snap-status { color: #d54e9d; }
.html-layout-selection { position: absolute; box-sizing: border-box; border: 2px solid var(--themeColor); pointer-events: none; }
.html-layout-dialog .html-layout-resize { position: absolute; bottom: -7px; right: -7px; width: 13px; height: 13px; padding: 0; background: var(--themeColor); border: 2px solid var(--floatBgColor); pointer-events: auto; cursor: nwse-resize; border-radius: 2px; }
.html-layout-dialog .html-layout-height-handle { position: absolute; left: 50%; transform: translateX(-50%); width: 42px; height: 13px; padding: 0; background: var(--themeColor); border: 2px solid var(--floatBgColor); pointer-events: auto; cursor: ns-resize; border-radius: 4px; }
.html-layout-height-handle.top { top: -7px; }
.html-layout-height-handle.bottom { bottom: -7px; }
.html-layout-select-container,
.html-layout-fit-container { width: 100%; margin-bottom: 16px; }
.html-layout-container-hint { font-size: 13px; line-height: 1.6; margin: 0 0 16px; color: var(--editorColor60); }
.html-layout-controls { width: 236px; flex-shrink: 0; padding: 18px; border-left: 1px solid var(--editorColor10); overflow: auto; box-sizing: border-box; }
.html-layout-field { display: flex; flex-direction: column; gap: 7px; font-size: 13px; margin-bottom: 18px; }
.html-layout-field input,
.html-layout-field select,
.html-layout-field textarea { width: 100%; padding: 7px; min-width: 0; }
.html-layout-field textarea { resize: vertical; }
.html-layout-size-fields { display: flex; gap: 10px; }
.html-layout-size-fields .html-layout-field { width: 50%; }
.html-layout-check { display: flex; align-items: center; gap: 6px; font-size: 13px; margin-bottom: 18px; }
.html-layout-order { display: flex; gap: 7px; margin-bottom: 18px; }
.html-layout-order button { flex: 1; padding: 7px; font-size: 12px; }
.html-layout-empty { font-size: 13px; line-height: 1.6; color: var(--editorColor60); }
.html-layout-source { flex: 1; width: calc(100% - 40px); margin: 0 20px 16px; padding: 16px; resize: none; min-height: 100px; font-family: monospace !important; line-height: 1.6; }
.html-layout-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 20px; border-top: 1px solid var(--editorColor10); }
.html-layout-dialog button.primary { background: var(--themeColor); color: white; border-color: var(--themeColor); }
.html-layout-error { margin: 10px 20px; color: #e65b52; font-size: 13px; }
</style>
