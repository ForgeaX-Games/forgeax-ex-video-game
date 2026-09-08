import { pluginFetch } from '../../lib/plugin-http'
import { readExtensionJson } from '../../lib/extension-host'
import type { DocumentType } from '@/authoring/assets/registry-types'

export interface ProjectDocumentSummary {
  id: string
  name: string
  documentType: DocumentType
  updatedAt: number
}

export interface ProjectDocument extends ProjectDocumentSummary {
  content: string
}

export interface ProjectDocumentList {
  documents: ProjectDocumentSummary[]
}

export interface ApplyDesignOptionsResult {
  selectedOptionId: 'A' | 'B' | 'C'
  document: ProjectDocumentSummary
}

function isDocumentType(value: unknown): value is DocumentType {
  return value === 'intake' || value === 'design-options' || value === 'core' || value === 'inquiry' || value === 'pillar'
}

function isSummary(value: unknown): value is ProjectDocumentSummary {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.id === 'string'
    && typeof item.name === 'string'
    && isDocumentType(item.documentType)
    && typeof item.updatedAt === 'number'
}

export async function fetchProjectDocuments(): Promise<ProjectDocumentList> {
  const response = await pluginFetch('documents')
  const body = await readExtensionJson(response) as { documents?: unknown }
  if (!Array.isArray(body.documents) || !body.documents.every(isSummary)) {
    throw new Error('Extension returned an invalid documents response')
  }
  return { documents: body.documents }
}

export async function fetchProjectDocument(id: string): Promise<ProjectDocument> {
  const response = await pluginFetch(`documents/${encodeURIComponent(id)}`)
  const body = await readExtensionJson(response) as { document?: unknown, content?: unknown }
  if (!isSummary(body.document) || typeof body.content !== 'string') {
    throw new Error('Extension returned an invalid document response')
  }
  return { ...body.document, content: body.content }
}

export async function applyDesignOptions(optionId: 'A' | 'B' | 'C'): Promise<ApplyDesignOptionsResult> {
  const response = await pluginFetch('documents/design-options/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ optionId }),
  })
  const body = await readExtensionJson(response) as { selectedOptionId?: unknown, document?: unknown, error?: unknown }
  if ((body.selectedOptionId !== optionId) || !isSummary(body.document) || body.document.documentType !== 'core') {
    throw new Error(typeof body.error === 'string' ? body.error : 'Extension returned an invalid design-options apply response')
  }
  return { selectedOptionId: optionId, document: body.document }
}
