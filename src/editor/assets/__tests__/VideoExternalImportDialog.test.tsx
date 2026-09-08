import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setLocale } from '../../../i18n'
import { VideoExternalImportDialog } from '../VideoExternalImportDialog'
import type { KinoResourceDTO, KinoVideoClient } from '../kino-api'

const sourceVideo: KinoResourceDTO = {
  resource_id: 'outdoor-video', game_id: 'source-game', media_type: 'video',
  url: 'https://cdn.example.com/outdoor.mp4', name: '户外', source_meta: { duration_ms: 3_000 },
  created_at: 1, updated_at: 2,
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof VideoExternalImportDialog>> = {}) {
  const onImport = vi.fn(async () => sourceVideo)
  const onClose = vi.fn()
  const props = {
    open: true,
    targetGameId: 'target-game',
    client: {} as KinoVideoClient,
    onImport,
    onClose,
    loadProjects: vi.fn(async () => [{ game_id: 'source-game', name: '源项目' }]),
    loadProjectVideos: vi.fn(async () => [sourceVideo]),
    ...overrides,
  }
  render(<VideoExternalImportDialog {...props} />)
  return props
}

describe('VideoExternalImportDialog', () => {
  it('selects a Kino project and video, then saves the selected resource with the entered name', async () => {
    setLocale('zh')
    const props = renderDialog()

    await waitFor(() => expect(screen.getByTestId('video-external-import-project')).not.toBeDisabled())
    fireEvent.change(screen.getByTestId('video-external-import-project'), { target: { value: 'source-game' } })
    await waitFor(() => expect(screen.getByTestId('video-external-import-video')).not.toBeDisabled())
    fireEvent.change(screen.getByTestId('video-external-import-video'), { target: { value: 'outdoor-video' } })
    expect(screen.getByTestId('video-external-import-name')).toHaveValue('户外')
    fireEvent.change(screen.getByTestId('video-external-import-name'), { target: { value: '导入户外' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(props.onImport).toHaveBeenCalledWith(sourceVideo, '导入户外'))
    expect(props.onClose).toHaveBeenCalledOnce()
    expect(screen.getByTestId('video-external-import-path')).toHaveTextContent('资产库 / 视频 / 户外')
  })

  it('surfaces import failures and keeps the dialog open', async () => {
    setLocale('en')
    const onImport = vi.fn(async () => { throw new Error('Kino rejected the source') })
    const props = renderDialog({ onImport })
    await waitFor(() => expect(screen.getByTestId('video-external-import-project')).not.toBeDisabled())
    fireEvent.change(screen.getByTestId('video-external-import-project'), { target: { value: 'source-game' } })
    await waitFor(() => expect(screen.getByTestId('video-external-import-video')).not.toBeDisabled())
    fireEvent.change(screen.getByTestId('video-external-import-video'), { target: { value: 'outdoor-video' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Kino rejected the source'))
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('closes on Escape unless an import is busy', async () => {
    setLocale('en')
    const props = renderDialog()
    await waitFor(() => expect(screen.getByTestId('video-external-import-project')).not.toBeDisabled())
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledOnce()
  })
})
