import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchProjectDocument, fetchProjectDocuments } from '../document-client'

const mocks = vi.hoisted(() => ({
  pluginFetch: vi.fn(),
  readExtensionJson: vi.fn(),
}))

vi.mock('../../../lib/plugin-http', () => ({ pluginFetch: mocks.pluginFetch }))
vi.mock('../../../lib/extension-host', () => ({ readExtensionJson: mocks.readExtensionJson }))

const CORE = {
  id: 'doc-core',
  name: '核心方案',
  documentType: 'core',
  updatedAt: 1,
}

describe('project document client', () => {
  beforeEach(() => {
    mocks.pluginFetch.mockReset()
    mocks.readExtensionJson.mockReset()
    mocks.pluginFetch.mockResolvedValue(new Response('{}'))
  })

  it('returns an empty document list as a normal new-project state', async () => {
    mocks.readExtensionJson.mockResolvedValue({ documents: [] })

    await expect(fetchProjectDocuments()).resolves.toEqual({ documents: [] })
    expect(mocks.pluginFetch).toHaveBeenCalledWith('documents')
  })

  it('loads a document body through its registered id', async () => {
    mocks.readExtensionJson.mockResolvedValue({
      document: CORE,
      content: '# 核心方案',
    })

    await expect(fetchProjectDocument('doc-core')).resolves.toEqual({
      ...CORE,
      content: '# 核心方案',
    })
    expect(mocks.pluginFetch).toHaveBeenCalledWith('documents/doc-core')
  })
})
