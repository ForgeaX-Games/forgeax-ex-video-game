import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useT } from '../../i18n'
import type { KinoResourceDTO, KinoVideoClient } from './kino-api'
import {
  listExternalProjectVideos,
  listExternalVideoImportProjects,
  type KinoImportProjectDTO,
} from './video-external-import'

export interface VideoExternalImportDialogProps {
  open: boolean
  targetGameId: string
  client: KinoVideoClient
  onImport: (source: KinoResourceDTO, name: string) => Promise<KinoResourceDTO | undefined>
  onClose: () => void
  loadProjects?: (targetGameId: string) => Promise<KinoImportProjectDTO[]>
  loadProjectVideos?: (sourceGameId: string) => Promise<KinoResourceDTO[]>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error'
}

export function VideoExternalImportDialog({
  open,
  targetGameId,
  client,
  onImport,
  onClose,
  loadProjects = listExternalVideoImportProjects,
  loadProjectVideos,
}: VideoExternalImportDialogProps): JSX.Element | null {
  const t = useT()
  const titleId = useId()
  const nameId = useId()
  const projectId = useId()
  const videoId = useId()
  const [projects, setProjects] = useState<KinoImportProjectDTO[]>([])
  const [sourceGameId, setSourceGameId] = useState('')
  const [videos, setVideos] = useState<KinoResourceDTO[]>([])
  const [sourceResourceId, setSourceResourceId] = useState('')
  const [name, setName] = useState('')
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [loadingVideos, setLoadingVideos] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const saveRef = useRef<HTMLButtonElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement) previousFocusRef.current = activeElement
    setProjects([])
    setSourceGameId('')
    setVideos([])
    setSourceResourceId('')
    setName('')
    setError(null)
    setLoadingProjects(true)
    void loadProjects(targetGameId).then(setProjects).catch((cause: unknown) => {
      setError(errorMessage(cause))
    }).finally(() => setLoadingProjects(false))
    queueMicrotask(() => nameRef.current?.focus())
    return () => previousFocusRef.current?.focus()
  }, [loadProjects, open, targetGameId])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose, open])

  if (!open) return null

  const selectedSource = videos.find((video) => video.resource_id === sourceResourceId)
  const selectedProject = projects.find((project) => project.game_id === sourceGameId)
  const onSelectProject = (nextSourceGameId: string): void => {
    setSourceGameId(nextSourceGameId)
    setVideos([])
    setSourceResourceId('')
    setError(null)
    if (!nextSourceGameId) return
    setLoadingVideos(true)
    const loadVideos = loadProjectVideos ?? ((gameId: string) => listExternalProjectVideos(client, gameId))
    void loadVideos(nextSourceGameId).then(setVideos).catch((cause: unknown) => {
      setError(errorMessage(cause))
    }).finally(() => setLoadingVideos(false))
  }
  const onSelectVideo = (resourceId: string): void => {
    setSourceResourceId(resourceId)
    const source = videos.find((video) => video.resource_id === resourceId)
    if (source) setName(source.name?.trim() || source.resource_id)
  }
  const submit = async (): Promise<void> => {
    if (!selectedSource) {
      setError(t('videoAssets.externalImport.selectVideoError'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onImport(selectedSource, name)
      onClose()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Tab') return
    if (event.shiftKey && document.activeElement === nameRef.current) {
      event.preventDefault()
      saveRef.current?.focus()
    } else if (!event.shiftKey && document.activeElement === saveRef.current) {
      event.preventDefault()
      nameRef.current?.focus()
    }
  }

  return (
    <div className="vei-dialog-backdrop" role="presentation" data-testid="video-external-import-backdrop">
      <section
        className="vei-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || loadingProjects || loadingVideos}
        data-testid="video-external-import-dialog"
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId}>{t('videoAssets.externalImport.title')}</h2>
        <button
          type="button"
          className="vei-dialog-close"
          aria-label={t('common.cancel')}
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
        <label htmlFor={nameId}>{t('videoAssets.externalImport.name')}</label>
        <input
          ref={nameRef}
          id={nameId}
          value={name}
          disabled={busy}
          data-testid="video-external-import-name"
          onChange={(event) => setName(event.target.value)}
        />
        <div className="vei-dialog-path" aria-label={t('videoAssets.externalImport.path')} data-testid="video-external-import-path">
          {t('videoAssets.externalImport.pathLibrary')} / {t('videoAssets.externalImport.pathVideo')} / {selectedSource?.name || selectedProject?.game_name || selectedProject?.name || t('videoAssets.externalImport.pathExternal')}
        </div>
        <label htmlFor={projectId}>{t('videoAssets.externalImport.sourceProject')}</label>
        <select
          id={projectId}
          value={sourceGameId}
          disabled={busy || loadingProjects}
          data-testid="video-external-import-project"
          onChange={(event) => onSelectProject(event.target.value)}
        >
          <option value="">{loadingProjects ? t('videoAssets.externalImport.loadingProjects') : t('videoAssets.externalImport.selectProject')}</option>
          {projects.map((project) => <option key={project.game_id} value={project.game_id}>{project.game_name || project.name || project.game_id}</option>)}
        </select>
        <label htmlFor={videoId}>{t('videoAssets.externalImport.sourceVideo')}</label>
        <select
          id={videoId}
          value={sourceResourceId}
          disabled={busy || !sourceGameId || loadingVideos}
          data-testid="video-external-import-video"
          onChange={(event) => onSelectVideo(event.target.value)}
        >
          <option value="">{loadingVideos ? t('videoAssets.externalImport.loadingVideos') : t('videoAssets.externalImport.selectVideo')}</option>
          {videos.map((video) => <option key={video.resource_id} value={video.resource_id}>{video.name || video.resource_id}</option>)}
        </select>
        {error ? <p role="alert" data-testid="video-external-import-error">{error}</p> : null}
        <div className="vei-dialog-actions">
          <button ref={cancelRef} type="button" disabled={busy} onClick={onClose}>{t('common.cancel')}</button>
          <button ref={saveRef} type="button" disabled={busy || loadingProjects || loadingVideos} onClick={() => void submit()}>
            {busy ? t('common.processing') : t('videoAssets.externalImport.save')}
          </button>
        </div>
      </section>
    </div>
  )
}
