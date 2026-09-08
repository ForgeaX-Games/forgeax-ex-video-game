import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { setLocale } from '../../../../i18n'
import type { MediaAsset } from '@/authoring/assets/registry-types'
import { VgenImagePicker, type VgenImageAsset } from '../VgenImagePicker'

const ASSETS: VgenImageAsset[] = [
  { id: 'char-1', resourceId: 'kino-char-1', label: 'Hero', kind: 'character_ref', thumbUrl: '/hero.png' },
  { id: 'scene-1', resourceId: 'kino-scene-1', label: 'Street', kind: 'scene_ref', thumbUrl: '/street.png' },
  { id: 'key-1', resourceId: 'kino-key-1', label: 'Keyframe', kind: 'keyframe', thumbUrl: '/key.png' },
]

describe('VgenImagePicker', () => {
  beforeEach(() => setLocale('zh'))

  it('restores focus to the opener after Escape and explicit close', async () => {
    render(<ControlledPicker />)
    const opener = screen.getByRole('button', { name: '添加参考图' })

    opener.focus()
    fireEvent.click(opener)
    expect(screen.getByRole('button', { name: '关闭图片选择器' })).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(opener).toHaveFocus())

    fireEvent.click(opener)
    fireEvent.click(screen.getByRole('button', { name: '关闭图片选择器' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('restores focus once the picker closes after selecting an image', async () => {
    const onPick = vi.fn()
    render(<ControlledPicker onPick={onPick} />)
    const opener = screen.getByRole('button', { name: '添加参考图' })

    opener.focus()
    fireEvent.click(opener)
    fireEvent.click(screen.getByRole('button', { name: 'Hero' }))

    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(ASSETS[0])
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('filters registry images by role tabs', () => {
    render(
      <VgenImagePicker
        open
        gameSlug="demo"
        imageAssets={ASSETS}
        onPick={() => {}}
        onClose={() => {}}
      />,
    )

    expect(screen.getByRole('button', { name: 'Hero' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Street' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '角色' }))
    expect(screen.getByRole('button', { name: 'Hero' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Street' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '关键帧' }))
    expect(screen.getByRole('button', { name: 'Keyframe' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hero' })).not.toBeInTheDocument()
  })

  it('picks the shared-registry id after local import is atomically registered as scene_ref', async () => {
    const created: MediaAsset = {
      id: 'registry-image-1',
      kind: 'image',
      productionType: 'scene_ref',
      status: 'ready',
      label: 'Imported',
      url: '/uploaded.png',
      createdAt: 1,
      updatedAt: 2,
      provider: { kind: 'local', ref: 'host-media-1' },
      meta: { kinoResourceId: 'kino-imported-1' },
    }
    const uploadRegistryImage = vi.fn(async () => created)
    const onPick = vi.fn()
    render(
      <VgenImagePicker
        open
        gameSlug="demo"
        imageAssets={ASSETS}
        uploadRegistryImage={uploadRegistryImage}
        onPick={onPick}
        onClose={() => {}}
      />,
    )
    const input = screen.getByLabelText('导入本地图片并登记为场景参考图') as HTMLInputElement
    expect(input).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp')
    const file = new File(['png'], 'import.png', { type: 'image/png' })

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(uploadRegistryImage).toHaveBeenCalledWith('demo', file))
    expect(onPick).toHaveBeenCalledWith({
      id: 'registry-image-1',
      resourceId: 'kino-imported-1',
      label: 'Imported',
      kind: 'scene_ref',
      thumbUrl: '/uploaded.png',
    })
    expect(input.value).toBe('')
  })

  it('disables registry images that do not carry a Kino resource id on the HTTP path', () => {
    render(
      <VgenImagePicker
        open
        gameSlug="demo"
        imageAssets={[{ id: 'registry-only', label: 'Legacy image', kind: 'scene_ref' }]}
        requireResourceId
        onPick={() => {}}
        onClose={() => {}}
      />,
    )

    expect(screen.getByRole('button', { name: 'Legacy image' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(
      '部分图片缺少 Kino resource_id，无法用于当前生成链路。',
    )
  })

  it('rejects unsupported local formats before calling the asset client', async () => {
    const uploadRegistryImage = vi.fn()
    render(
      <VgenImagePicker
        open
        gameSlug="demo"
        imageAssets={ASSETS}
        uploadRegistryImage={uploadRegistryImage}
        onPick={() => {}}
        onClose={() => {}}
      />,
    )
    const file = new File(['gif'], 'import.gif', { type: 'image/gif' })
    fireEvent.change(screen.getByLabelText('导入本地图片并登记为场景参考图'), {
      target: { files: [file] },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('仅支持 PNG、JPEG 或 WebP 图片')
    expect(uploadRegistryImage).not.toHaveBeenCalled()
  })

  it('surfaces registry registration failure and never picks the provider-only resource', async () => {
    const uploadRegistryImage = vi.fn(async () => {
      throw new Error('共享素材登记失败')
    })
    const onPick = vi.fn()
    render(
      <VgenImagePicker
        open
        gameSlug="demo"
        imageAssets={ASSETS}
        uploadRegistryImage={uploadRegistryImage}
        onPick={onPick}
        onClose={() => {}}
      />,
    )
    const file = new File(['png'], 'import.png', { type: 'image/png' })

    fireEvent.change(screen.getByLabelText('导入本地图片并登记为场景参考图'), {
      target: { files: [file] },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('共享素材登记失败')
    expect(onPick).not.toHaveBeenCalled()
  })

  it('rejects an imported shared asset when registration omits its real Kino resource id', async () => {
    const uploadRegistryImage = vi.fn(async (): Promise<MediaAsset> => ({
      id: 'registry-image-without-resource',
      kind: 'image',
      productionType: 'scene_ref',
      status: 'ready',
      createdAt: 1,
      updatedAt: 2,
    }))
    const onPick = vi.fn()
    render(
      <VgenImagePicker
        open
        gameSlug="demo"
        imageAssets={ASSETS}
        uploadRegistryImage={uploadRegistryImage}
        requireResourceId
        onPick={onPick}
        onClose={() => {}}
      />,
    )

    fireEvent.change(screen.getByLabelText('导入本地图片并登记为场景参考图'), {
      target: { files: [new File(['png'], 'import.png', { type: 'image/png' })] },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('上传的参考图缺少 Kino resource_id')
    expect(onPick).not.toHaveBeenCalled()
  })

  it('blocks Escape, backdrop, and close while an upload is in flight', async () => {
    let resolveUpload!: (asset: MediaAsset) => void
    const uploadRegistryImage = vi.fn(() => new Promise<MediaAsset>((resolve) => { resolveUpload = resolve }))
    const onClose = vi.fn()
    const onUploadingChange = vi.fn()
    render(
      <VgenImagePicker
        open
        gameSlug="demo"
        imageAssets={ASSETS}
        uploadRegistryImage={uploadRegistryImage}
        onPick={() => {}}
        onClose={onClose}
        onUploadingChange={onUploadingChange}
      />,
    )
    fireEvent.change(screen.getByLabelText('导入本地图片并登记为场景参考图'), {
      target: { files: [new File(['png'], 'import.png', { type: 'image/png' })] },
    })
    await waitFor(() => expect(onUploadingChange).toHaveBeenLastCalledWith(true))
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.mouseDown(screen.getByRole('presentation'))
    fireEvent.click(screen.getByRole('button', { name: '关闭图片选择器' }))
    expect(onClose).not.toHaveBeenCalled()
    resolveUpload({
      id: 'registry-image-1',
      kind: 'image',
      productionType: 'scene_ref',
      status: 'ready',
      label: 'Imported',
      meta: { kinoResourceId: 'kino-imported-1' },
      createdAt: 1,
      updatedAt: 1,
    })
    await waitFor(() => expect(onUploadingChange).toHaveBeenLastCalledWith(false))
  })
})

function ControlledPicker({ onPick = () => {} }: { onPick?: (asset: VgenImageAsset) => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>添加参考图</button>
      <VgenImagePicker
        open={open}
        gameSlug="demo"
        imageAssets={ASSETS}
        onPick={(asset) => {
          onPick(asset)
          setOpen(false)
        }}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
