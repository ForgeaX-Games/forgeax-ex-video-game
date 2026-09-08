import { t as translateUi } from '../../i18n'
import { useEffect, useMemo, useState } from 'react'
import { hasSelectedDesignOption } from '@/authoring/documents/core-design-options'
import type { DocumentType } from '@/authoring/assets/registry-types'
import { getDocumentMountOptions } from '@/editor/host-init'
import { injectStyleOnce } from '@/editor/styles/injectStyle'
import entityEmptyIcon from '@/editor/ui-assets/entity-empty.svg?url'
import {
  fetchProjectDocument,
  fetchProjectDocuments,
  type ProjectDocument,
  type ProjectDocumentSummary,
} from './document-client'
import { extractAuthorVisible } from './extractAuthorVisible'
import { useDocumentNav } from '../persist/documentNavStore'
import { useProductionProjection } from '../persist/productionProjectionStore'
import { AuthorDocumentView } from './AuthorDocumentView'
import { DesignOptionsSlide } from './DesignOptionsSlide'

const DOCUMENT_LABELS: Record<DocumentType, string> = {
  intake: '需求',
  'design-options': '核心方案候选',
  core: '核心',
  inquiry: '问询',
  pillar: '支柱',
}

const CSS = `
.gdx-root{height:100%;min-height:0;display:flex;flex-direction:column;background:#201d1a;color:#f6f1e9;font-family:'PingFang SC',system-ui,-apple-system,'Segoe UI',sans-serif}
.gdx-content{flex:1;min-height:0;height:100%;overflow:auto;padding:28px 36px 56px}
.gdx-content.is-design-options,.gdx-content.is-author-document{overflow:hidden;padding:0}
.gdx-empty,.gdx-error{max-width:620px;padding:30px;border:1px dashed rgba(255,255,255,.22);border-radius:10px;background:rgba(255,255,255,.025);color:rgba(255,255,255,.72);line-height:1.7}
.gdx-error{border-color:rgba(255,134,134,.6);color:#ffc1c1}.gdx-loading{color:rgba(255,255,255,.6)}
.gdx-content.is-document-empty{display:grid;place-items:center;overflow:hidden;padding:0;background:#232323}
.gdx-document-empty{display:flex;flex-direction:column;align-items:center;gap:8px;width:80px}
.gdx-document-empty img{display:block;width:72px;height:80px}
.gdx-document-empty p{width:148px;height:48px;margin:0;color:rgba(255,255,255,.4);font-size:16px;line-height:24px;text-align:center}
`

export function DocumentLibraryView(): JSX.Element {
  injectStyleOnce('game-document-library', CSS)
  const documentType = useDocumentNav((state) => state.documentType)
  const projection = useProductionProjection((state) => state.projection)
  const [documents, setDocuments] = useState<ProjectDocumentSummary[] | null>(null)
  const [document, setDocument] = useState<ProjectDocument | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadRevision, setReloadRevision] = useState(0)
  const [coreMaterialized, setCoreMaterialized] = useState<boolean | null>(null)
  const productionModule = documentType === 'pillar'
    ? 'document.pillar'
    : documentType === 'core' || documentType === 'design-options'
      ? 'document.core'
      : null
  const productionModuleState = productionModule
    ? projection?.modules[productionModule]
    : undefined
  const isTargetActivity = projection?.activity === productionModule
  const productionReloadKey = productionModule
    ? `${productionModuleState?.availability ?? 'unavailable'}:${productionModuleState?.count ?? ''}:${isTargetActivity ? `${projection?.activityStatus ?? ''}:${projection?.activityRevision ?? 0}` : ''}:${projection?.workflowRevision ?? 0}`
    : ''

  // Re-listing per active type keeps a document that was upserted or healed
  // after mount visible without a reload; the previous list and error are
  // dropped first so nothing from the outgoing type survives the switch.
  useEffect(() => {
    let cancelled = false
    setDocuments(null)
    setError(null)
    void fetchProjectDocuments()
      .then((next) => {
        if (!cancelled) setDocuments(next.documents)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '读取项目文档失败')
      })
    return () => { cancelled = true }
  }, [documentType, productionReloadKey, reloadRevision])

  const coreSummary = useMemo(
    () => documents?.find((item) => item.documentType === 'core') ?? null,
    [documents],
  )
  const hasDesignOptions = documents?.some((item) => item.documentType === 'design-options') ?? false
  const needsCoreMaterializationCheck = documentType === 'core' && Boolean(coreSummary) && hasDesignOptions

  // A legacy placeholder core can coexist with the real design-options document.
  // Read the core marker before deciding which author-facing view to show; the
  // existence of a registry entry alone is not proof that a selection happened.
  useEffect(() => {
    if (!needsCoreMaterializationCheck || !coreSummary) {
      setCoreMaterialized(null)
      return
    }
    let cancelled = false
    setCoreMaterialized(null)
    void fetchProjectDocument(coreSummary.id)
      .then((next) => {
        if (!cancelled) setCoreMaterialized(hasSelectedDesignOption(next.content))
      })
      .catch(() => {
        // The regular document fetch below owns the visible error state.
      })
    return () => { cancelled = true }
  }, [coreSummary, needsCoreMaterializationCheck, reloadRevision])

  // “核心设计”是作者侧唯一入口。正式 core 尚未物化、但候选方案已就绪时，
  // 该入口先承载 A/B/C 选择器；应用方案后再原位切换为正式核心预览。
  const resolvedDocumentType = useMemo<DocumentType>(() => {
    if (documentType !== 'core' || documents === null) return documentType
    if (!hasDesignOptions) return 'core'
    if (!coreSummary) return 'design-options'
    return coreMaterialized === true ? 'core' : 'design-options'
  }, [coreMaterialized, coreSummary, documentType, documents, hasDesignOptions])

  const matching = useMemo(
    () => (documents ?? []).filter((item) => item.documentType === resolvedDocumentType),
    [documents, resolvedDocumentType],
  )

  const selectedSummary = matching[0] ?? null
  const selectedId = selectedSummary?.id ?? null

  useEffect(() => {
    let cancelled = false
    setDocument(null)
    if (!selectedId) return () => { cancelled = true }
    void fetchProjectDocument(selectedId)
      .then((next) => {
        if (!cancelled) setDocument(next)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '读取文档正文失败')
      })
    return () => { cancelled = true }
  }, [selectedId, selectedSummary, reloadRevision])

  const title = DOCUMENT_LABELS[resolvedDocumentType]
  const { docActionSlotEl } = getDocumentMountOptions()
  const isDesignOptions = resolvedDocumentType === 'design-options'
  const isAuthorDocument = resolvedDocumentType === 'core' || resolvedDocumentType === 'pillar'
  const documentEmpty = isAuthorDocument
    && (documents === null || matching.length === 0)

  return (
    <section className="gdx-root" aria-label={translateUi('ui.copy.1a19124df1e8')}>
      {docActionSlotEl ? (
        <div
          data-testid="doc-action-slot-host"
          ref={(el) => {
            if (el && docActionSlotEl.parentElement !== el) {
              el.appendChild(docActionSlotEl)
            }
          }}
        />
      ) : null}
      <div className={`gdx-content${isDesignOptions ? ' is-design-options' : ''}${isAuthorDocument ? ' is-author-document' : ''}${documentEmpty ? ' is-document-empty' : ''}`}>
        {documentEmpty ? (
          <div className="gdx-document-empty">
            <img src={entityEmptyIcon} alt="" />
            <p>{translateUi('documents.empty')}</p>
          </div>
        ) : (
          <>
            {error ? <div className="gdx-error" role="alert">{error}</div> : null}
            {documents === null && !error ? <p className="gdx-loading">{translateUi('ui.copy.1cd8d327262a')}</p> : null}
            {documents !== null && matching.length === 0 ? (
              <div className="gdx-empty">
                {translateUi('ui.copy.6e8a603f1315')}{title}。
              </div>
            ) : null}
            {selectedId && !document && !error ? <p className="gdx-loading">{translateUi('ui.copy.ffc414a50c0a')}</p> : null}
          </>
        )}
        {!documentEmpty && document?.documentType === 'design-options' ? (
          <DesignOptionsSlide
            content={document.content}
            documentId={document.id}
            documentUpdatedAt={document.updatedAt}
            onContentReload={(next) => {
              setDocuments((current) => current?.map((item) => (
                item.id === next.id
                  ? {
                    id: next.id,
                    name: next.name,
                    documentType: next.documentType,
                    updatedAt: next.updatedAt,
                  }
                  : item
              )) ?? null)
              setDocument(next)
            }}
            onApplied={documentType === 'core'
              ? () => setReloadRevision((revision) => revision + 1)
              : undefined}
          />
        ) : null}
        {!documentEmpty && document && document.documentType !== 'design-options' ? (
          <AuthorDocumentView markdown={extractAuthorVisible(document.content)} />
        ) : null}
      </div>
    </section>
  )
}
