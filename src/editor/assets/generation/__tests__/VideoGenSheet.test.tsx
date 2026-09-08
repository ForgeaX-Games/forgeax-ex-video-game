import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setLocale } from '../../../../i18n'
import {
  VideoGenSheet,
  type VideoGenSheetProps,
} from '../VideoGenSheet'
import type { ClipGenerationRequest, VideoGenerationTask } from '../generation-api'

const IMAGE_ASSETS: VideoGenSheetProps['imageAssets'] = [
  { id: 'char-1', resourceId: 'kino-char-1', label: 'Hero', kind: 'character_ref', thumbUrl: '/hero.png' },
  { id: 'scene-1', resourceId: 'kino-scene-1', label: 'Street', kind: 'scene_ref', thumbUrl: '/street.png' },
  { id: 'key-1', resourceId: 'kino-key-1', label: 'Keyframe', kind: 'keyframe', thumbUrl: '/key.png' },
]
const LATE_IMAGE_ASSET = {
  id: 'char-2',
  resourceId: 'kino-char-2',
  label: 'Villain',
  kind: 'character_ref' as const,
  thumbUrl: '/villain.png',
}

function renderSheet(overrides: Partial<VideoGenSheetProps> = {}) {
  const props: VideoGenSheetProps = {
    open: true,
    gameSlug: 'demo',
    imageAssets: IMAGE_ASSETS,
    recentClips: [],
    genState: { phase: 'idle' },
    onSubmit: vi.fn<(request: ClipGenerationRequest) => void>(),
    onCancel: vi.fn(),
    onTrack: vi.fn(),
    onClose: vi.fn(),
    onLocateAsset: vi.fn(),
    loadVisualStyles: async () => [],
    ...overrides,
  }
  const view = render(<VideoGenSheet {...props} />)
  return { ...view, props, onSubmit: props.onSubmit as ReturnType<typeof vi.fn>, onCancel: props.onCancel as ReturnType<typeof vi.fn>, onTrack: props.onTrack as ReturnType<typeof vi.fn>, onLocateAsset: props.onLocateAsset as ReturnType<typeof vi.fn> }
}

function fillPrompt(value: string): void {
  const editor = screen.getByRole('textbox', { name: '视频提示词' })
  editor.textContent = value
  fireEvent.input(editor)
}

function chooseMode(mode: 'strict' | 'firstref' | 't2v'): void {
  const labels = {
    strict: '首尾帧生视频',
    firstref: '首帧生视频',
    t2v: '文生视频',
  } as const
  fireEvent.click(screen.getByRole('button', { name: labels[mode] }))
}

function pickFrame(buttonLabel: string, assetLabel: string): void {
  fireEvent.click(screen.getByRole('button', { name: buttonLabel }))
  const picker = screen.getByRole('dialog', { name: '选择图片' })
  fireEvent.click(within(picker).getByRole('button', { name: assetLabel }))
}

function baseTask(overrides: Partial<VideoGenerationTask> = {}): VideoGenerationTask {
  return {
    generationId: 'task-1',
    status: 'succeeded',
    prompt: '历史提示词',
    resourceId: 'kino-video-1',
    resultUrl: 'https://cdn.test/video.mp4',
    params: {
      mode: 'ref',
      durationSeconds: 11,
      generateAudio: false,
      size: '2496x1664',
      resolution: '1080p',
      referenceImageResourceIds: ['kino-char-1'],
    },
    ...overrides,
  }
}

describe('VideoGenSheet compatibility wrapper', () => {
  beforeEach(() => setLocale('zh'))

  it('renders no output when closed and uses the shared dialog/page layouts', () => {
    const { rerender, props } = renderSheet({ open: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    rerender(<VideoGenSheet {...props} open variant="page" />)
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('disables the prompt and all generation controls when the surface is disabled', () => {
    renderSheet({
      variant: 'page',
      interaction: { disabled: true },
      initialValues: { prompt: '节点视频提示词', referenceImageResourceIds: ['kino-char-1'] },
    })

    expect(screen.getByRole('textbox', { name: '视频提示词' })).toHaveAttribute('contenteditable', 'false')
    expect(screen.getByRole('button', { name: '生成视频' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: '模型' })).toBeDisabled()
    expect(screen.getByRole('slider', { name: '时长滑杆' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: '音频' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '删除节点参考图' })).toBeDisabled()
  })

  it('keeps preview, location, and history actions inert when the surface is disabled', () => {
    const task = baseTask()
    const { container, onLocateAsset } = renderSheet({
      variant: 'page',
      interaction: { disabled: true },
      initialValues: { prompt: '节点视频提示词' },
      genState: {
        phase: 'succeeded',
        generationId: 'task-ready',
        assetId: 'asset-ready',
        resourceId: 'kino-ready',
        resultUrl: 'https://cdn.test/recent.mp4',
      },
      recentClips: [{
        id: 'asset-ready',
        generationId: 'task-ready',
        resourceId: 'kino-ready',
        label: '历史视频',
        createdAt: 2,
        status: 'ready',
        playbackUrl: 'https://cdn.test/recent.mp4',
        prompt: '历史提示词',
        params: task.params,
      }],
    })

    expect(container.querySelector<HTMLButtonElement>('.generation-preview-video [data-action="play"]')).toBeDisabled()
    expect(container.querySelector('.generation-preview-video [data-action="locate"]')).toBeNull()
    expect(container.querySelector('.vgen-locate')).toBeNull()

    const historyItem = container.querySelector<HTMLElement>('[data-generation-id="task-ready"]')
    expect(historyItem).not.toBeNull()
    if (!historyItem) return
    expect(within(historyItem).getByRole('button', { name: '查看历史视频' })).toBeDisabled()
    expect(within(historyItem).getByRole('button', { name: '选择结果' })).toBeDisabled()
    expect(within(historyItem).queryByRole('button', { name: '恢复设置' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '视频提示词' })).toHaveTextContent('节点视频提示词')
    expect(onLocateAsset).not.toHaveBeenCalled()
  })

  it('closes an open reference picker when the surface becomes disabled', async () => {
    const { props, rerender } = renderSheet({
      variant: 'page',
      initialValues: { mode: 'firstref' },
    })
    fireEvent.click(screen.getByRole('button', { name: '首帧' }))
    expect(screen.getByRole('dialog', { name: '选择图片' })).toBeInTheDocument()

    rerender(<VideoGenSheet {...props} interaction={{ disabled: true }} />)

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '选择图片' })).not.toBeInTheDocument())
  })

  it('explains why video generation is unavailable on hover', () => {
    renderSheet({
      variant: 'page',
      interaction: { disabled: true },
      initialValues: { prompt: '节点视频提示词' },
    })

    expect(screen.getByRole('button', { name: '生成视频' }).parentElement).toHaveAttribute('title', '当前编辑器已禁用视频生成。')
  })

  it('explains that a prompt is required when the generate button is disabled', () => {
    renderSheet({ variant: 'page' })

    expect(screen.getByRole('button', { name: '生成视频' }).parentElement).toHaveAttribute('title', '请输入视频提示词。')
  })

  it('uses the Figma mode order and compact frame upload control', () => {
    renderSheet({ variant: 'page' })
    const tabs = within(screen.getByRole('tablist', { name: '生成模式' })).getAllByRole('button')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['文生视频', '首帧生视频', '首尾帧生视频'])

    fireEvent.click(screen.getByRole('button', { name: '首帧生视频' }))
    const firstFrame = screen.getByRole('button', { name: '首帧' })
    expect(firstFrame).toHaveClass('vgen-frame-tile')
    expect(firstFrame).not.toHaveClass('vgen-frame')
    expect(window.getComputedStyle(firstFrame).width).toBe('79.443px')
    expect(window.getComputedStyle(firstFrame).height).toBe('94.721px')
    expect(window.getComputedStyle(firstFrame).borderRadius).toBe('11px')
    expect(window.getComputedStyle(firstFrame).fontSize).toBe('12px')
    fireEvent.click(firstFrame)
    const picker = screen.getByRole('dialog', { name: '选择图片' })
    expect(window.getComputedStyle(within(picker).getByRole('heading', { name: '选择图片' })).fontSize).toBe('13px')
  })

  it('lets the page prompt box fill the remaining composer height', () => {
    const { container } = renderSheet({ variant: 'page' })
    const promptBox = container.querySelector<HTMLElement>('.generation-prompt-body')

    expect(promptBox).not.toBeNull()
    const style = getComputedStyle(promptBox!)
    expect(style.height).toBe('auto')
    expect(style.minHeight).toBe('164px')
    expect(style.flexGrow).toBe('1')
    expect(style.flexShrink).toBe('1')
    expect(style.flexBasis).toBe('0%')
  })

  it('uses React button handlers instead of native form submission inside the sandboxed iframe', () => {
    const { container, onSubmit } = renderSheet({ variant: 'page' })
    expect(container.querySelector('form')).not.toBeInTheDocument()

    fillPrompt('雨夜街道上的追逐镜头')
    fireEvent.click(screen.getByRole('button', { name: '生成视频' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      prompt: '雨夜街道上的追逐镜头',
      mode: 't2v',
    }))
  })

  it('renders the Figma empty video preview without an idle status footer', () => {
    const { container } = renderSheet({ variant: 'page' })
    const message = screen.getByText('开始创造独属自己的资源，建造独一无二的游戏体验')
    const empty = message.closest('.vgen-generation-empty') as HTMLElement
    const illustration = empty.querySelector('img') as HTMLImageElement
    const preview = screen.getByLabelText('任务输出')

    expect(window.getComputedStyle(illustration).width).toBe('163.81px')
    expect(window.getComputedStyle(illustration).height).toBe('120px')
    expect(window.getComputedStyle(message).fontSize).toBe('14px')
    expect(window.getComputedStyle(preview.querySelector('.generation-preview-frame__footer') as HTMLElement).display).toBe('none')
    expect(container.querySelector('.vgen-page-history')).toBeNull()
    expect(container.querySelector('.vgen-design-workspace')).not.toHaveClass('has-history')
  })

  it.each([
    ['strict', { first: 'Hero', last: 'Keyframe', expected: { firstFrameResourceId: 'kino-char-1', lastFrameResourceId: 'kino-key-1' } }],
    ['firstref', { first: 'Hero', expected: { firstFrameResourceId: 'kino-char-1' } }],
    ['t2v', { expected: {} }],
  ] as const)('validates and submits the %s mode payload', (_mode, config) => {
    const { onSubmit } = renderSheet({ variant: 'page' })
    chooseMode(_mode)
    fillPrompt('雨夜街道上的追逐镜头')
    if ('first' in config && config.first) pickFrame('首帧', config.first)
    if ('last' in config && config.last) pickFrame('尾帧', config.last)
    fireEvent.click(screen.getByRole('button', { name: '生成视频' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ mode: _mode, prompt: '雨夜街道上的追逐镜头', ...config.expected }))
  })

  it('allows removing a node-prefilled reference image before submitting', () => {
    const { container, onSubmit } = renderSheet({
      variant: 'page',
      initialValues: {
        mode: 'ref',
        referenceImageResourceIds: ['kino-char-1', 'kino-scene-1'],
      },
    })

    fillPrompt('角色在雨夜街道中追逐')
    const references = screen.getByRole('group', { name: '节点参考图' })
    expect(within(references).getByText('Hero')).toBeInTheDocument()
    expect(within(references).getByText('Street')).toBeInTheDocument()
    const removeButtons = within(references).getAllByRole('button', { name: '删除节点参考图' })
    expect(removeButtons).toHaveLength(2)
    fireEvent.click(removeButtons[0] as HTMLButtonElement)
    expect(within(references).queryByText('Hero')).not.toBeInTheDocument()
    expect(within(references).getByText('Street')).toBeInTheDocument()
    expect(references.parentElement).toHaveClass('generation-prompt-prefix')
    expect(references.parentElement?.nextElementSibling).toHaveClass('vgen-mention-editor-wrap')
    expect(container.querySelector('.vgen-mention-editor [data-resource-id="kino-char-1"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '生成视频' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      mode: 't2v',
      referenceImageResourceIds: ['kino-scene-1'],
    }))
  })

  it('submits node-prefilled reference images together with first and last frames', () => {
    const { onSubmit } = renderSheet({
      variant: 'page',
      initialValues: {
        mode: 'strict',
        firstFrameResourceId: 'kino-char-1',
        lastFrameResourceId: 'kino-key-1',
        referenceImageResourceIds: ['kino-scene-1'],
      },
    })

    fillPrompt('从首帧过渡到尾帧')
    fireEvent.click(screen.getByRole('button', { name: '生成视频' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'strict',
      firstFrameResourceId: 'kino-char-1',
      lastFrameResourceId: 'kino-key-1',
      referenceImageResourceIds: ['kino-scene-1'],
    }))
  })

  it('drops prefilled reference images when switching to a target without them', async () => {
    const { onSubmit, props, rerender } = renderSheet({
      variant: 'page',
      resetKey: 'node-a',
      initialValues: {
        prompt: 'Node A',
        mode: 'ref',
        referenceImageResourceIds: ['kino-char-1'],
      },
    })

    rerender(<VideoGenSheet
      {...props}
      resetKey="node-b"
      initialValues={{ prompt: 'Node B', mode: 't2v' }}
    />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: '视频提示词' })).toHaveTextContent('Node B'))
    fireEvent.click(screen.getByRole('button', { name: '生成视频' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('referenceImageResourceIds')
  })

  it.each([
    ['strict', '严格首尾帧模式需要同时选择首帧和尾帧。'],
    ['firstref', '首帧参考模式需要选择首帧。'],
  ] as const)('blocks %s without required references', (mode, message) => {
    const { onSubmit } = renderSheet({ variant: 'page' })
    chooseMode(mode)
    fillPrompt('镜头')
    fireEvent.click(screen.getByRole('button', { name: '生成视频' }))
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('supports first/last frame picker and swaps frame order', () => {
    renderSheet({ variant: 'page' })
    chooseMode('strict')
    pickFrame('首帧', 'Hero')
    pickFrame('尾帧', 'Keyframe')
    expect(screen.getByRole('button', { name: '首帧' })).toHaveStyle({ backgroundImage: 'url("/hero.png")' })
    expect(screen.getByRole('button', { name: '尾帧' })).toHaveStyle({ backgroundImage: 'url("/key.png")' })
    fireEvent.click(screen.getByRole('button', { name: '交换首尾帧' }))
    expect(screen.getByRole('button', { name: '首帧' })).toHaveStyle({ backgroundImage: 'url("/key.png")' })
    expect(screen.getByRole('button', { name: '尾帧' })).toHaveStyle({ backgroundImage: 'url("/hero.png")' })
  })

  it('removes selected first and last frame references without opening the picker', () => {
    const { onSubmit } = renderSheet({ variant: 'page' })
    chooseMode('strict')
    pickFrame('首帧', 'Hero')
    pickFrame('尾帧', 'Keyframe')

    fireEvent.click(screen.getByRole('button', { name: '删除首帧参考图' }))
    expect(screen.getByRole('button', { name: '首帧' })).not.toHaveClass('has-image')
    expect(screen.queryByRole('button', { name: '删除首帧参考图' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '选择图片' })).not.toBeInTheDocument()

    fillPrompt('从首帧过渡到尾帧')
    fireEvent.click(screen.getByRole('button', { name: '生成视频' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('严格首尾帧模式需要同时选择首帧和尾帧。')

    fireEvent.click(screen.getByRole('button', { name: '删除尾帧参考图' }))
    expect(screen.getByRole('button', { name: '尾帧' })).not.toHaveClass('has-image')
  })

  it('supports @ mentions, style selection, prompt polish, audio, and exact request metadata', async () => {
    const polishPrompt = vi.fn(async () => '润色后的镜头 @Hero')
    const loadVisualStyles = vi.fn(async () => [{ key: 'noir', label: '黑色电影', cdnUrl: '', tags: ['真人'], order: 0 }])
    const { onSubmit, container } = renderSheet({
      variant: 'page',
      polishPrompt,
      loadVisualStyles,
      mentionAssets: [{
        id: 'char-1',
        resourceId: 'kino-char-1',
        label: 'Hero',
        category: 'character',
        thumbUrl: '/hero.png',
        prompt: 'Silver-haired swordsman in a rainy neon street',
      }],
    })
    fillPrompt('开场 ')
    fireEvent.click(screen.getByRole('button', { name: '@ 素材' }))
    const assetDialog = screen.getByRole('dialog', { name: '项目资产' })
    expect(within(assetDialog).queryByText('Silver-haired swordsman in a rainy neon street')).not.toBeInTheDocument()
    fireEvent.click(within(assetDialog).getByRole('option', { name: /Hero/ }))
    fireEvent.click(screen.getByRole('button', { name: '风格' }))
    fireEvent.click(await screen.findByRole('button', { name: '黑色电影' }))
    fireEvent.click(screen.getByRole('button', { name: '提示词润色' }))
    await waitFor(() => {
      expect(polishPrompt).toHaveBeenCalledWith(expect.stringContaining('开场'))
      expect(screen.getByRole('textbox', { name: '视频提示词' })).toHaveTextContent('润色后的镜头 @Hero')
    })
    expect(container.querySelector('[data-resource-id="kino-char-1"]')).toHaveTextContent('@Hero')
    fireEvent.click(screen.getByRole('checkbox', { name: '音频' }))
    fireEvent.click(screen.getByRole('button', { name: '生成视频' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      prompt: '润色后的镜头 @Hero',
      promptContent: [
        { type: 'text', text: '润色后的镜头 ' },
        { type: 'resource', resourceId: 'kino-char-1' },
      ],
      visualStyleKey: 'noir',
      generateAudio: false,
    }))
  })

  it('shows image, character, and scene tabs with image as the default all-assets view', () => {
    renderSheet({
      variant: 'page',
      mentionAssets: [
        { id: 'image-1', resourceId: 'kino-image-1', label: 'Magic sword', category: 'image', thumbUrl: '/image.png', prompt: 'Hidden image prompt' },
        { id: 'character-1', resourceId: 'kino-character-1', label: 'Hero', category: 'character', thumbUrl: '/hero.png', prompt: 'Hidden character prompt' },
        { id: 'scene-1', resourceId: 'kino-scene-1', label: 'Street', category: 'scene', thumbUrl: '/street.png', prompt: 'Hidden scene prompt' },
        { id: 'video-1', resourceId: 'kino-video-1', label: 'Generated clip', category: 'video', mediaUrl: '/clip.mp4' },
      ],
    })

    fireEvent.click(screen.getByRole('button', { name: '@ 素材' }))
    const assetDialog = screen.getByRole('dialog', { name: '项目资产' })
    const tabs = within(assetDialog).getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['图片', '角色', '场景'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(within(assetDialog).getAllByRole('option')).toHaveLength(3)
    expect(within(assetDialog).queryByRole('option', { name: 'Generated clip' })).not.toBeInTheDocument()
    const imageCard = within(assetDialog).getByRole('option', { name: 'Magic sword' })
    expect(window.getComputedStyle(imageCard).width).toBe('140px')
    expect(window.getComputedStyle(imageCard.querySelector('.vgen-asset-preview') as HTMLElement).height).toBe('140px')
    expect(window.getComputedStyle(within(assetDialog).getByRole('heading')).fontSize).toBe('24px')
    expect(window.getComputedStyle(within(assetDialog).getByRole('button', { name: '关闭项目资产' }).querySelector('img') as HTMLElement).transform).toBe('rotate(-45deg)')
    expect(within(assetDialog).queryByText('Hidden image prompt')).not.toBeInTheDocument()
    expect(within(assetDialog).queryByText('Hidden character prompt')).not.toBeInTheDocument()
    expect(within(assetDialog).queryByText('Hidden scene prompt')).not.toBeInTheDocument()

    fireEvent.click(within(assetDialog).getByRole('tab', { name: '角色' }))
    expect(within(assetDialog).getAllByRole('option')).toHaveLength(1)
    expect(within(assetDialog).getByRole('option', { name: 'Hero' })).toBeInTheDocument()

    fireEvent.click(within(assetDialog).getByRole('tab', { name: '场景' }))
    expect(within(assetDialog).getAllByRole('option')).toHaveLength(1)
    expect(within(assetDialog).getByRole('option', { name: 'Street' })).toBeInTheDocument()

    fireEvent.click(within(assetDialog).getByRole('tab', { name: '图片' }))
    expect(within(assetDialog).getAllByRole('option')).toHaveLength(3)
  })

  it('preserves the submitted @ asset chip when Kino starts tracking the new generation', () => {
    const mentionAssets: NonNullable<VideoGenSheetProps['mentionAssets']> = [{
      id: 'image-1',
      resourceId: 'kino-image-1',
      label: '图片 1',
      category: 'image',
      thumbUrl: '/image-1.png',
    }]
    const { rerender, props, container } = renderSheet({ variant: 'page', mentionAssets })
    fillPrompt('让 ')
    fireEvent.click(screen.getByRole('button', { name: '@ 素材' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '项目资产' })).getByRole('option', { name: '图片 1' }))
    fireEvent.click(screen.getByRole('button', { name: '生成视频' }))

    rerender(<VideoGenSheet
      {...props}
      mentionAssets={mentionAssets}
      genState={{ phase: 'generating', generationId: 'new-task', prompt: '让 @图片 1' }}
    />)

    expect(container.querySelector('[data-resource-id="kino-image-1"]')).toHaveTextContent('@图片 1')
    expect(screen.getByRole('textbox', { name: '视频提示词' }).querySelector('.vgen-mention-chip')).not.toBeNull()
  })

  it('preserves page and dialog defaults in the exact request payload', () => {
    const page = renderSheet({ variant: 'page' })
    fillPrompt('文生视频')
    fireEvent.click(screen.getByRole('button', { name: '生成视频' }))
    expect(page.onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      mode: 't2v',
      durationSeconds: 5,
      generateAudio: true,
    }))

    page.unmount()
    const dialog = renderSheet({ variant: 'sheet' })
    fillPrompt('首尾帧')
    pickFrame('首帧', 'Hero')
    pickFrame('尾帧', 'Keyframe')
    fireEvent.click(screen.getByRole('button', { name: '生成视频' }))
    expect(dialog.onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'strict',
      durationSeconds: 8,
      generateAudio: false,
    }))
  })

  it('submits the only available model as the selected state', () => {
    const { onSubmit } = renderSheet({ variant: 'page', availableModels: ['kino-fast'] })
    fillPrompt('单模型')
    fireEvent.click(screen.getByRole('button', { name: '生成视频' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ model: 'kino-fast' }))
  })

  it('switches to a history preview while generating without changing settings', () => {
    const task = baseTask({ status: 'polling' })
    const { container, onTrack, onLocateAsset } = renderSheet({
      variant: 'sheet',
      genState: { phase: 'generating', generationId: 'active', activeTasks: [task] },
      recentClips: [{ id: 'asset-1', generationId: 'task-1', resourceId: 'kino-video-1', label: '历史视频', createdAt: 1, status: 'ready', playbackUrl: 'https://cdn.test/video.mp4', prompt: '历史提示词', params: task.params }],
    })
    const item = container.querySelector<HTMLElement>('[data-generation-id="task-1"]')
    expect(item).not.toBeNull()
    if (!item) return
    fireEvent.click(within(item).getByRole('button', { name: '查看历史视频' }))
    expect(onTrack).not.toHaveBeenCalled()
    expect(onLocateAsset).not.toHaveBeenCalled()
    expect(screen.getByTestId('generation-preview')).toHaveAttribute('src', 'https://cdn.test/video.mp4')
    expect(screen.getByRole('textbox', { name: '视频提示词' })).toHaveTextContent('')
    expect(screen.getByRole('button', { name: '首尾帧生视频' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('slider', { name: '时长滑杆' })).toHaveValue('8')
    expect(screen.getByRole('checkbox', { name: '音频' })).not.toBeChecked()
    fireEvent.click(within(item).getByRole('button', { name: '选择结果' }))
    expect(onLocateAsset).not.toHaveBeenCalled()
    expect(within(item).queryByRole('button', { name: '恢复设置' })).not.toBeInTheDocument()
  })

  it('keeps page history selection inside the generation preview', () => {
    const task = baseTask()
    const { container, onTrack, onLocateAsset } = renderSheet({
      variant: 'page',
      recentClips: [{
        id: 'page-asset-1',
        resourceId: 'kino-page-video-1',
        label: '页面历史视频',
        createdAt: 1,
        status: 'ready',
        playbackUrl: 'https://cdn.test/page-video.mp4',
        prompt: '页面历史提示词',
        params: task.params,
      }],
    })
    const history = container.querySelector<HTMLElement>('.vgen-page-history')
    expect(history).not.toBeNull()
    expect(container.querySelector('.vgen-design-workspace')).toHaveClass('has-history')
    expect(window.getComputedStyle(history as HTMLElement).width).toBe('67px')
    if (!history) return
    const item = history.querySelector<HTMLElement>('[data-generation-id="page-asset-1"]')
    expect(item).not.toBeNull()
    if (!item) return

    fireEvent.click(within(item).getByRole('button', { name: '查看页面历史视频' }))
    expect(onTrack).not.toHaveBeenCalled()
    expect(onLocateAsset).not.toHaveBeenCalled()
    expect(screen.getByTestId('generation-preview')).toHaveAttribute('src', 'https://cdn.test/page-video.mp4')
    expect(screen.getByRole('textbox', { name: '视频提示词' })).toHaveTextContent('')
    expect(screen.getByRole('slider', { name: '时长滑杆' })).toHaveValue('5')
    expect(screen.getByRole('checkbox', { name: '音频' })).toBeChecked()
    fireEvent.click(within(item).getByRole('button', { name: '选择结果' }))
    expect(onLocateAsset).not.toHaveBeenCalled()
    expect(within(item).queryByRole('button', { name: '恢复设置' })).not.toBeInTheDocument()
  })

  it('keeps recent ready clips out of mentions while reusing their playback preview for asset-only state', () => {
    renderSheet({
      variant: 'page',
      genState: { phase: 'succeeded', generationId: 'task-ready', assetId: 'asset-ready' },
      recentClips: [{
        id: 'asset-ready',
        resourceId: 'kino-ready',
        label: 'Recent clip',
        createdAt: 2,
        status: 'ready',
        playbackUrl: 'https://cdn.test/recent.mp4',
        posterUrl: 'https://cdn.test/recent.jpg',
      }],
    })
    fireEvent.click(screen.getByRole('button', { name: '@ 素材' }))
    expect(screen.queryByRole('option', { name: 'Recent clip' })).not.toBeInTheDocument()
    expect(screen.getByTestId('generation-preview')).toHaveAttribute('src', 'https://cdn.test/recent.mp4')
  })

  it('shows the restored manifest video in the completed output while generation is idle', () => {
    const { container, onLocateAsset } = renderSheet({
      variant: 'page',
      initialResultAssetId: 'restored-video',
      recentClips: [{
        id: 'restored-video',
        resourceId: 'kino-restored-video',
        label: '还原的视频',
        createdAt: 2,
        status: 'ready',
        playbackUrl: 'https://cdn.test/restored.mp4',
        posterUrl: 'https://cdn.test/restored.jpg',
      }],
    })

    expect(screen.getByTestId('generation-preview')).toHaveAttribute('src', 'https://cdn.test/restored.mp4')
    expect(screen.getByTestId('generation-preview')).not.toHaveAttribute('poster')
    expect(container.querySelector('.vgen-preview-stage > .generation-preview-frame')).toHaveAttribute('data-phase', 'succeeded')
    expect(container.querySelector('[data-generation-id="restored-video"]')).toHaveClass('is-selected')
    expect(container.querySelector('.vgen-preview-stage .generation-preview-frame__footer')).toBeNull()
    expect(container.querySelector('.generation-preview-video [data-action="locate"]')).toBeNull()
    expect(container.querySelector('.vgen-locate')).toBeNull()
    expect(onLocateAsset).not.toHaveBeenCalled()
  })

  it('shows a selected manifest history video in the completed output', () => {
    const task = baseTask()
    const { container } = renderSheet({
      variant: 'page',
      recentClips: [{
        id: 'history-video',
        resourceId: 'kino-history-video',
        label: '历史还原视频',
        createdAt: 3,
        status: 'ready',
        playbackUrl: 'https://cdn.test/history-restored.mp4',
        params: task.params,
        prompt: '历史提示词',
      }],
    })

    const item = container.querySelector<HTMLElement>('[data-generation-id="history-video"]')
    expect(item).not.toBeNull()
    if (!item) return
    fireEvent.click(within(item).getByRole('button', { name: '查看历史还原视频' }))

    expect(screen.getByTestId('generation-preview')).toHaveAttribute('src', 'https://cdn.test/history-restored.mp4')
    expect(container.querySelector('.vgen-preview-stage > .generation-preview-frame')).toHaveAttribute('data-phase', 'succeeded')
    expect(within(item).queryByRole('button', { name: '恢复设置' })).not.toBeInTheDocument()
  })

  it('applies the previewed history video only from the explicit player action', async () => {
    const onApplyResult = vi.fn(async () => {})
    const { container } = renderSheet({
      variant: 'page',
      appliedAssetId: 'current-video',
      onApplyResult,
      recentClips: [
        {
          id: 'current-video',
          label: '当前视频',
          createdAt: 1,
          status: 'ready',
          playbackUrl: 'https://cdn.test/current.mp4',
        },
        {
          id: 'history-video',
          label: '历史视频',
          createdAt: 2,
          status: 'ready',
          playbackUrl: 'https://cdn.test/history.mp4',
          prompt: '历史提示词',
        },
      ],
      initialResultAssetId: 'current-video',
    })

    expect(screen.queryByRole('button', { name: '应用历史视频' })).not.toBeInTheDocument()
    const history = container.querySelector<HTMLElement>('[data-generation-id="history-video"]')
    expect(history).not.toBeNull()
    if (!history) return
    fireEvent.click(within(history).getByRole('button', { name: '查看历史视频' }))
    expect(onApplyResult).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '应用历史视频' }))
    await waitFor(() => expect(onApplyResult).toHaveBeenCalledWith('history-video'))
    await waitFor(() => expect(screen.queryByRole('button', { name: '应用历史视频' })).not.toBeInTheDocument())
  })

  it('deduplicates a completed Kino task and its registered asset by generation id', () => {
    const { container } = renderSheet({
      variant: 'page',
      genState: {
        phase: 'succeeded',
        generationId: 'task-ready',
        assetId: 'asset-ready',
        resourceId: 'kino-ready',
        resultUrl: 'https://cdn.test/recent.mp4',
      },
      recentClips: [{
        id: 'asset-ready',
        generationId: 'task-ready',
        resourceId: 'kino-ready',
        label: 'Recent clip',
        createdAt: 2,
        status: 'ready',
        playbackUrl: 'https://cdn.test/recent.mp4',
      }],
    })

    expect(container.querySelectorAll('[data-generation-id="task-ready"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-generation-id="asset-ready"]')).toHaveLength(0)
  })

  it('does not expose registry-only images or clips as @ mention resources', () => {
    renderSheet({
      variant: 'page',
      imageAssets: [...IMAGE_ASSETS, { id: 'registry-only', label: 'Registry only', kind: 'scene_ref' }],
      recentClips: [{ id: 'asset-only', label: 'Asset only', createdAt: 1, status: 'ready', prompt: 'Asset only' }],
    })
    fireEvent.click(screen.getByRole('button', { name: '@ 素材' }))
    expect(screen.queryByRole('option', { name: 'Registry only' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Asset only' })).not.toBeInTheDocument()
  })

  it('keeps the composer available for another task while generation is active', () => {
    const { onSubmit } = renderSheet({ variant: 'page', genState: { phase: 'generating', generationId: 'active', prompt: '进行中' } })
    const submit = screen.getByRole('button', { name: '生成视频' })
    expect(submit).toBeEnabled()
    expect(screen.getByRole('textbox', { name: '视频提示词' })).toHaveAttribute('contenteditable', 'true')
    fireEvent.click(submit)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('keeps frame controls available while another generation is active', () => {
    renderSheet({
      variant: 'page',
      genState: { phase: 'generating', generationId: 'active', prompt: '进行中' },
      initialValues: { mode: 'strict' },
    })
    expect(screen.getByRole('button', { name: '首帧' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '尾帧' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '交换首尾帧' })).toBeDisabled()
  })

  it('still blocks duplicate clicks while the create request is submitting', () => {
    renderSheet({ variant: 'page', genState: { phase: 'submitting', prompt: '正在创建任务' } })
    expect(screen.getByRole('button', { name: '生成中' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '视频提示词' })).toHaveAttribute('contenteditable', 'false')
  })

  it('shows submission validation errors beside the composer actions', () => {
    renderSheet({ variant: 'page', submissionError: '节点所需角色或场景参考图已被移除，请恢复预填参考图后再生成' })
    expect(screen.getByRole('alert')).toHaveTextContent('节点所需角色或场景参考图已被移除')
  })

  it('keeps user and history edits when image assets refresh, but resets for a new target', async () => {
    const { rerender, props } = renderSheet({ variant: 'page', resetKey: 'target-a', initialValues: { prompt: 'Target A' } })
    const editor = screen.getByRole('textbox', { name: '视频提示词' })
    editor.textContent = 'User prompt'
    fireEvent.input(editor)
    rerender(<VideoGenSheet {...props} imageAssets={[...IMAGE_ASSETS, LATE_IMAGE_ASSET]} />)
    await waitFor(() => expect(editor).toHaveTextContent('User prompt'))

    rerender(<VideoGenSheet {...props} resetKey="target-b" initialValues={{ prompt: 'Target B' }} />)
    await waitFor(() => expect(editor).toHaveTextContent('Target B'))
  })

  it('does not hydrate initial prompt chips into the next submit payload', () => {
    const { onSubmit } = renderSheet({
      variant: 'page',
      initialValues: {
        prompt: 'Visible prompt only',
        promptContent: [{ type: 'resource', resourceId: 'kino-char-1' }],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: '生成视频' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Visible prompt only' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.not.objectContaining({ promptContent: expect.anything() }))
  })
})
