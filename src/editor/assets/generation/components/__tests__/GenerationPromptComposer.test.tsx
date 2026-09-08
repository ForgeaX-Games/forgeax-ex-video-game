// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setLocale } from '../../../../../i18n'
import type { KinoPromptContentItem } from '@/runtime/core/schema/kino-schema'
import { GenerationPromptComposer } from '../GenerationPromptComposer'

describe('GenerationPromptComposer', () => {
  beforeEach(() => setLocale('en'))

  it('keeps prompt and inline mentions controlled while exposing the action slots', () => {
    const onSubmit = vi.fn()
    const onStyle = vi.fn()
    render(<ControlledComposer onSubmit={onSubmit} onOpenStylePicker={onStyle} />)

    const editor = screen.getByRole('textbox', { name: 'Generation prompt' })
    editor.textContent = 'Use '
    fireEvent.input(editor)
    fireEvent.click(screen.getByRole('button', { name: 'Mention an asset' }))
    fireEvent.click(screen.getByRole('option', { name: 'Hero' }))
    fireEvent.click(screen.getByRole('button', { name: 'Visual style' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    expect(onStyle).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('Use @Hero ', [
      { type: 'text', text: 'Use ' },
      { type: 'resource', resourceId: 'hero-resource' },
      { type: 'text', text: ' ' },
    ])
  })

  it('polishes through the caller action and clears without owning transport state', async () => {
    const polishPrompt = vi.fn(async (prompt: string) => `${prompt}, cinematic`)
    const onCancel = vi.fn()
    const onClear = vi.fn()
    render(
      <ControlledComposer
        polishPrompt={polishPrompt}
        onCancel={onCancel}
        onClear={onClear}
        interaction={{ busy: true }}
      />,
    )
    const editor = screen.getByRole('textbox', { name: 'Generation prompt' })
    editor.textContent = 'Hero'
    fireEvent.input(editor)

    expect(screen.getByRole('button', { name: 'Cancel generation' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel generation' }))
    expect(onCancel).toHaveBeenCalledTimes(1)

    // Busy state blocks polish/clear until the caller releases it.
    expect(screen.getByRole('button', { name: 'Polish prompt' })).toBeDisabled()
  })

  it('shows exactly one semantic prompt action: clear while idle and cancel while cancellation is available', () => {
    const { container, rerender } = render(<ControlledComposer />)

    expect(container.querySelectorAll('.generation-prompt-clear')).toHaveLength(1)
    expect(container.querySelectorAll('.generation-prompt-cancel')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Clear prompt' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel generation' })).not.toBeInTheDocument()

    rerender(<ControlledComposer interaction={{ busy: true }} />)

    expect(container.querySelectorAll('.generation-prompt-clear')).toHaveLength(0)
    expect(container.querySelectorAll('.generation-prompt-cancel')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Clear prompt' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel generation' })).toBeInTheDocument()

    rerender(<ControlledComposer cancelWhileEditing />)

    expect(container.querySelectorAll('.generation-prompt-clear')).toHaveLength(0)
    expect(container.querySelectorAll('.generation-prompt-cancel')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Clear prompt' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel generation' })).toBeInTheDocument()
  })

  it('disables the editor and generation actions when the surface is disabled', () => {
    const onSubmit = vi.fn()
    const onStyle = vi.fn()
    render(
      <ControlledComposer
        onSubmit={onSubmit}
        onOpenStylePicker={onStyle}
        interaction={{ disabled: true }}
      />,
    )

    expect(screen.getByRole('textbox', { name: 'Generation prompt' })).toHaveAttribute('contenteditable', 'false')
    expect(screen.getByRole('button', { name: 'Mention an asset' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Visual style' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows why a disabled generation button cannot be used on hover', () => {
    render(
      <ControlledComposer
        onOpenStylePicker={vi.fn()}
        submitDisabledReason="当前编辑器为只读状态，暂时无法生成视频。"
        interaction={{ readOnly: true }}
      />,
    )

    const submitButton = screen.getByRole('button', { name: 'Generate' })
    expect(submitButton).toBeDisabled()
    expect(submitButton.parentElement).toHaveAttribute('title', '当前编辑器为只读状态，暂时无法生成视频。')
  })

  it('runs polish and updates the controlled editor through onChange', async () => {
    const polishPrompt = vi.fn(async () => 'Polished')
    render(<ControlledComposer polishPrompt={polishPrompt} />)
    const editor = screen.getByRole('textbox', { name: 'Generation prompt' })
    editor.textContent = 'Draft'
    fireEvent.input(editor)
    fireEvent.click(screen.getByRole('button', { name: 'Polish prompt' }))

    await waitFor(() => expect(editor).toHaveTextContent('Polished'))
    expect(polishPrompt).toHaveBeenCalledWith('Draft')
  })

  it('syncs an external value even when resetKey stays stable', async () => {
    const props = {
      value: 'Initial',
      content: [] as KinoPromptContentItem[],
      assets: [],
      onChange: vi.fn(),
      resetKey: 'history-1',
    }
    const view = render(<GenerationPromptComposer {...props} />)
    const editor = screen.getByRole('textbox', { name: 'Generation prompt' })
    editor.textContent = 'User edit'
    fireEvent.input(editor)

    view.rerender(<GenerationPromptComposer {...props} value="Restored" />)

    await waitFor(() => expect(editor).toHaveTextContent('Restored'))
  })

  it('does not let a late polish response overwrite a newer user edit', async () => {
    let resolve!: (value: string) => void
    const polishPrompt = vi.fn(() => new Promise<string>((onResolve) => { resolve = onResolve }))
    render(<ControlledComposer polishPrompt={polishPrompt} />)
    const editor = screen.getByRole('textbox', { name: 'Generation prompt' })
    editor.textContent = 'Draft'
    fireEvent.input(editor)
    fireEvent.click(screen.getByRole('button', { name: 'Polish prompt' }))

    editor.textContent = 'New user edit'
    fireEvent.input(editor)
    resolve('Stale polished draft')

    await waitFor(() => expect(editor).toHaveTextContent('New user edit'))
    expect(editor).not.toHaveTextContent('Stale polished draft')
  })
})

interface ControlledComposerProps {
  polishPrompt?: (prompt: string) => Promise<string>
  onSubmit?: ReturnType<typeof vi.fn>
  onOpenStylePicker?: () => void
  onCancel?: () => void
  onClear?: () => void
  interaction?: { disabled?: boolean, readOnly?: boolean, busy?: boolean }
  cancelWhileEditing?: boolean
  submitDisabledReason?: string
}

function ControlledComposer({
  polishPrompt,
  onSubmit,
  onOpenStylePicker,
  onCancel,
  onClear,
  interaction,
  cancelWhileEditing,
  submitDisabledReason,
}: ControlledComposerProps): JSX.Element {
  const [value, setValue] = useState('')
  const [content, setContent] = useState<KinoPromptContentItem[]>([])
  return (
    <GenerationPromptComposer
      value={value}
      content={content}
      assets={[{ id: 'hero', resourceId: 'hero-resource', label: 'Hero' }]}
      onChange={(next, nextContent) => { setValue(next); setContent(nextContent) }}
      onSubmit={onSubmit}
      onOpenStylePicker={onOpenStylePicker}
      polishPrompt={polishPrompt}
      onCancel={onCancel}
      cancelWhileEditing={cancelWhileEditing}
      onClear={onClear}
      interaction={interaction}
      submitDisabledReason={submitDisabledReason}
      top={<span data-testid="top-slot">Top</span>}
    >
      <span data-testid="children-slot">Slot</span>
    </GenerationPromptComposer>
  )
}
