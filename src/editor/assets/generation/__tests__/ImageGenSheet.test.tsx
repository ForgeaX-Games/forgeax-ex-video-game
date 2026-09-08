// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { KinoGenerationTask } from '../generation-api'
import { ImageGenSheet } from '../ImageGenSheet'

const idleState = {
  phase: 'idle' as const,
  history: [],
  loadingHistory: false,
  tracking: false,
}

function renderSheet(overrides: Partial<ComponentProps<typeof ImageGenSheet>> = {}) {
  const props: ComponentProps<typeof ImageGenSheet> = {
    open: true,
    variant: 'page',
    imageAssets: [{ id: 'reference-1', resourceId: 'kino-reference-1', label: 'Hero', url: 'https://example.com/hero.png' }],
    visualStyles: [{ key: 'cinematic', label: 'Cinematic', cdnUrl: '', tags: [], order: 1 }],
    state: idleState,
    onSubmit: vi.fn(),
    onStopWaiting: vi.fn(),
    onTrack: vi.fn(),
    onClose: vi.fn(),
    onLocateAsset: vi.fn(),
    ...overrides,
  }
  render(<ImageGenSheet {...props} />)
  return props
}

describe('ImageGenSheet', () => {
  function fillPrompt(value: string): void {
    const input = screen.getByRole('textbox', { name: '提示词' })
    input.textContent = value
    fireEvent.input(input)
  }

  it('renders an idle page without ready status or empty history', () => {
    const { container } = render(<ImageGenSheet
      open
      variant="page"
      imageAssets={[]}
      visualStyles={[]}
      state={idleState}
      onSubmit={vi.fn()}
      onStopWaiting={vi.fn()}
      onTrack={vi.fn()}
      onClose={vi.fn()}
      onLocateAsset={vi.fn()}
    />)

    expect(screen.queryByText('就绪')).toBeNull()
    expect(screen.queryByLabelText('历史记录')).toBeNull()
    expect(container.querySelector('.igen-workspace')).not.toHaveClass('has-history')
    expect(window.getComputedStyle(container.querySelector('.igen-empty-frame .generation-preview-frame__footer') as HTMLElement).display).toBe('none')
  })

  it('renders a reusable page surface aligned with video generation controls', () => {
    const props = renderSheet({ initialValues: { model: 'lite' } })
    expect(screen.getByLabelText('模型')).toBeDisabled()
    expect(screen.getByLabelText('模型')).toHaveTextContent('lite')
    expect(screen.getByRole('button', { name: '16:9 2560×1440' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: '尺寸' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '3:2 2496×1664' }))
    fireEvent.click(screen.getByRole('button', { name: '视觉风格' }))
    const styleDialog = screen.getByRole('dialog', { name: '风格选择' })
    const styleElement = document.querySelector('style[data-reel-style="game-video-visual-style-picker"]')
    expect(styleElement).not.toBeNull()
    expect(styleElement?.textContent).toContain('width: min(971px,calc(100vw - 48px))')
    expect(styleElement?.textContent).toContain('.vgen-style-search > input:focus, .vgen-style-search > input:focus-visible { border: 0; outline: 0; background: transparent; box-shadow: none; }')
    expect(window.getComputedStyle(styleDialog).backgroundColor).toBe('#141414')
    expect(window.getComputedStyle(styleDialog.querySelector('h3') as HTMLElement).fontSize).toBe('24px')
    expect(window.getComputedStyle(styleDialog.querySelector('.vgen-style-card') as HTMLElement).height).toBe('119px')
    fireEvent.click(screen.getByRole('button', { name: 'Cinematic' }))
    fillPrompt('A painted hero portrait')
    fireEvent.click(screen.getByRole('button', { name: '@ 素材' }))
    fireEvent.click(screen.getByRole('option', { name: 'Hero' }))
    fireEvent.click(screen.getByRole('button', { name: '生成一张图片' }))

    expect(props.onSubmit).toHaveBeenCalledWith({
      prompt: 'A painted hero portrait@Hero ',
      promptContent: [
        { type: 'text', text: 'A painted hero portrait' },
        { type: 'resource', resourceId: 'kino-reference-1' },
        { type: 'text', text: ' ' },
      ],
      size: '2496x1664',
      visualStyleKey: 'cinematic',
    })
  })

  it('submits inline @ assets as structured Kino prompt content', () => {
    const props = renderSheet()
    fillPrompt('Use ')
    fireEvent.click(screen.getByRole('button', { name: '@ 素材' }))
    fireEvent.click(screen.getByRole('option', { name: 'Hero' }))
    fireEvent.click(screen.getByRole('button', { name: '生成一张图片' }))

    expect(props.onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      promptContent: [
        { type: 'text', text: 'Use ' },
        { type: 'resource', resourceId: 'kino-reference-1' },
        { type: 'text', text: ' ' },
      ],
    }))
  })

  it('keeps the form editable for another image task while an older task is tracked', () => {
    const props = renderSheet({
      state: {
        ...idleState,
        phase: 'polling',
        tracking: true,
        currentTask: {
          generationId: 'older-task',
          mediaType: 'image',
          status: 'polling',
          prompt: 'Older task',
        },
      },
    })

    expect(screen.getByRole('textbox', { name: '提示词' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '生成一张图片' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '停止本地等待' }))
    expect(props.onStopWaiting).toHaveBeenCalledOnce()
    fillPrompt('Second task')
    fireEvent.click(screen.getByRole('button', { name: '生成一张图片' }))
    expect(props.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Second task' }))
  })

  it('keeps image inputs disabled only during the create submission window', () => {
    renderSheet({ state: { ...idleState, phase: 'submitting' } })

    expect(screen.getByRole('textbox', { name: '提示词' })).toHaveAttribute('contenteditable', 'false')
    expect(screen.getByRole('button', { name: '生成一张图片' })).toBeDisabled()
  })

  it('re-enables image submission after a terminal task', () => {
    const props = renderSheet({
      state: {
        ...idleState,
        phase: 'succeeded',
        currentTask: {
          generationId: 'completed-task',
          mediaType: 'image',
          status: 'succeeded',
          prompt: 'Completed task',
          resourceId: 'completed-resource',
          resultUrl: 'https://example.com/completed.png',
        },
      },
    })

    expect(screen.getByRole('textbox', { name: '提示词' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '生成一张图片' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '生成一张图片' }))
    expect(props.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Completed task' }))
  })

  it('offers supplied image assets but excludes videos from the page mention dialog', () => {
    renderSheet({
      mentionAssets: [
        { id: 'image-1', resourceId: 'kino-image-1', label: 'Key art', category: 'image' },
        { id: 'character-1', resourceId: 'kino-character-1', label: 'Hero', category: 'character' },
        { id: 'scene-1', resourceId: 'kino-scene-1', label: 'Forest', category: 'scene' },
        { id: 'video-1', resourceId: 'kino-video-1', label: 'Intro', category: 'video' },
      ],
    })

    fireEvent.click(screen.getByRole('button', { name: '@ 素材' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('option', { name: 'Key art' })).toBeVisible()
    expect(within(dialog).getByRole('option', { name: 'Hero' })).toBeVisible()
    expect(within(dialog).getByRole('option', { name: 'Forest' })).toBeVisible()
    expect(within(dialog).queryByRole('option', { name: 'Intro' })).not.toBeInTheDocument()
  })

  it('keeps assets without a Kino id visible but disabled in the mention dialog', () => {
    renderSheet({
      imageAssets: [
        { id: 'kino-image', resourceId: 'kino-resource', label: 'Kino image', url: 'https://example.com/kino.png' },
        { id: 'local-image', label: 'Local image', url: 'https://example.com/local.png' },
      ],
    })

    fireEvent.click(screen.getByRole('button', { name: '@ 素材' }))
    expect(screen.getByRole('option', { name: 'Kino image' })).toBeEnabled()
    expect(screen.getByRole('option', { name: 'Local image' })).toBeDisabled()
  })

  it.each(['page', 'sheet'] as const)('polishes and clears the prompt in the %s variant', async (variant) => {
    const polishPrompt = vi.fn(async (value: string) => `${value}, cinematic lighting`)
    renderSheet({ variant, polishPrompt })
    fillPrompt('Hero portrait')
    fireEvent.click(screen.getByRole('button', { name: '提示词润色' }))

    await waitFor(() => expect(screen.getByRole('textbox', { name: '提示词' }))
      .toHaveTextContent('Hero portrait, cinematic lighting'))
    expect(polishPrompt).toHaveBeenCalledWith('Hero portrait')

    fireEvent.click(screen.getByRole('button', { name: '清空提示词' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '提示词' })).toBeEmptyDOMElement())
  })

  it('switches image history by cover without rendering copy or restoring prompt settings', () => {
    const task: KinoGenerationTask = {
      generationId: 'generation-1',
      mediaType: 'image',
      status: 'succeeded',
      prompt: 'History prompt',
      resultUrl: 'https://example.com/result.png',
      resourceId: 'resource-1',
      createdAt: 1,
    }
    const props = renderSheet({
      state: { ...idleState, history: [task] },
      initialValues: { prompt: 'Current draft' },
      historyAssets: [{
        id: 'manifest-image-1',
        generationId: task.generationId,
        resourceId: task.resourceId,
        label: 'History prompt',
        prompt: task.prompt,
        url: task.resultUrl,
        createdAt: task.createdAt,
        status: task.status,
        model: 'lite',
        params: {
          size: '1664x2496',
          visualStyleKey: 'cinematic',
        },
      }],
    })

    expect(document.querySelector('.igen-workspace')).toHaveClass('has-history')
    fireEvent.click(within(screen.getByLabelText('历史记录')).getByRole('button', { name: '查看History prompt' }))
    expect(props.onLocateAsset).not.toHaveBeenCalled()
    expect(screen.getByLabelText('图片生成结果').querySelector('.generation-preview-image-like__media')).toHaveAttribute('src', 'https://example.com/result.png')
    expect(screen.getByRole('textbox', { name: '提示词' })).toHaveTextContent('Current draft')
    expect(screen.getByRole('button', { name: '16:9 2560×1440' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('历史记录')).not.toHaveTextContent('History prompt')
    expect(screen.getByLabelText('历史记录').querySelector('.generation-history-item__content')).toBeNull()
    expect(screen.getByLabelText('历史记录').querySelector('.generation-history-item__actions')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '生成一张图片' }))
    expect(props.onSubmit).toHaveBeenCalledWith({
      prompt: 'Current draft',
      size: '2560x1440',
    })
  })

  it('shows the clicked manifest asset immediately without requiring a history click', () => {
    renderSheet({
      initialHistoryAssetId: 'manifest-image-1',
      historyAssets: [{
        id: 'manifest-image-1',
        generationId: 'generation-1',
        resourceId: 'resource-1',
        label: 'Clicked asset',
        prompt: 'Clicked asset prompt',
        url: 'https://example.com/clicked.png',
        createdAt: 1,
        status: 'succeeded',
      }],
    })

    expect(screen.getByLabelText('图片生成结果').querySelector('.generation-preview-image-like__media'))
      .toHaveAttribute('src', 'https://example.com/clicked.png')
    expect(screen.queryByText('生成成功后将在此预览一张图片')).toBeNull()
  })

  it('applies the selected history image from below the preview', async () => {
    const onApplyResult = vi.fn(async () => {})
    renderSheet({
      initialHistoryAssetId: 'registry-image-1',
      historyAssets: [{
        id: 'registry-image-1',
        generationId: 'generation-select-1',
        resourceId: 'resource-select-1',
        label: 'Selectable image',
        url: 'https://example.com/selectable.png',
        status: 'succeeded',
      }],
      onApplyResult,
    })

    expect(screen.queryByRole('button', { name: '选择结果' })).toBeNull()
    expect(screen.queryByRole('button', { name: '恢复设置' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '应用' }))

    await waitFor(() => expect(onApplyResult).toHaveBeenCalledWith('registry-image-1'))
    expect(screen.queryByRole('button', { name: '应用' })).not.toBeInTheDocument()
  })

  it('does not allow applying a generating history image even when it has a preview URL', () => {
    const onApplyResult = vi.fn(async () => {})
    renderSheet({
      initialHistoryAssetId: 'registry-image-generating',
      historyAssets: [{
        id: 'registry-image-generating',
        generationId: 'generation-running',
        resourceId: 'resource-running',
        label: 'Generating image',
        url: 'https://example.com/incomplete.png',
        status: 'polling',
      }],
      onApplyResult,
    })

    expect(screen.queryByRole('button', { name: '应用' })).not.toBeInTheDocument()
    expect(onApplyResult).not.toHaveBeenCalled()
  })

  it('hides apply for the current image and reveals it only after selecting another history image', () => {
    renderSheet({
      initialHistoryAssetId: 'current-image',
      appliedAssetId: 'current-image',
      historyAssets: [
        {
          id: 'current-image',
          generationId: 'generation-current',
          label: 'Current image',
          url: 'https://example.com/current.png',
          createdAt: 2,
          status: 'succeeded',
        },
        {
          id: 'previous-image',
          generationId: 'generation-previous',
          label: 'Previous image',
          url: 'https://example.com/previous.png',
          createdAt: 1,
          status: 'succeeded',
        },
      ],
      onApplyResult: vi.fn(async () => {}),
    })

    expect(screen.queryByRole('button', { name: '应用' })).not.toBeInTheDocument()
    fireEvent.click(within(screen.getByLabelText('历史记录')).getByRole('button', { name: '查看Previous image' }))
    expect(screen.getByRole('button', { name: '应用' })).toBeEnabled()
  })

  it('keeps completed image media free of status, prompt, and asset-library actions', () => {
    const task: KinoGenerationTask = {
      generationId: 'generation-preview-1',
      mediaType: 'image',
      status: 'succeeded',
      prompt: 'Prompt that belongs in the composer',
      resultUrl: 'https://example.com/preview.png',
      resourceId: 'resource-preview-1',
      createdAt: 1,
    }
    renderSheet({
      state: {
        ...idleState,
        phase: 'succeeded',
        currentTask: task,
      },
    })

    const output = screen.getByLabelText('图片生成结果')
    expect(output.querySelector('.generation-preview-frame__footer')).toBeNull()
    expect(output.querySelector('.generation-preview-image-like__actions')).toBeNull()
    expect(output.querySelector('.igen-status')).toBeNull()
    expect(output.querySelector('[data-action="locate"]')).toBeNull()
    expect(output.querySelector('.igen-locate')).toBeNull()
    expect(output).not.toHaveTextContent(task.prompt as string)
  })

  it('can be mounted independently as a closed sheet', () => {
    renderSheet({ open: false, variant: 'sheet' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
