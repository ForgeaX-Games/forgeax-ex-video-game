import { useT } from '../../../../i18n'
import { useId, type CSSProperties, type ReactNode } from 'react'
import type {
  KinoVideoGenerationMode,
  KinoVideoGenerationParams,
  KinoVideoSize,
} from '@/runtime/core/schema/kino-schema'
import {
  KINO_VIDEO_MAX_DURATION_SECONDS,
  KINO_VIDEO_MIN_DURATION_SECONDS,
  KINO_VIDEO_RESOLUTIONS,
  KINO_VIDEO_SIZES,
} from '@/runtime/core/schema/kino-schema'
import {
  GenerationOptionGroup,
  GenerationParameterField,
  GenerationParametersLayout,
  GenerationSelectField,
  GenerationToggleField,
  type GenerationParameterOption,
} from './GenerationParameters'
import {
  useResolvedGenerationInteraction,
  type GenerationInteractionProps,
} from './interaction'

export type VideoGenerationParameterValue = Partial<Pick<
  KinoVideoGenerationParams,
  'mode' | 'model' | 'resolution' | 'durationSeconds' | 'size' | 'generateAudio'
>>

export interface VideoParametersProps extends GenerationInteractionProps {
  value: VideoGenerationParameterValue
  modelOptions?: readonly string[]
  onChange: (value: VideoGenerationParameterValue) => void
  children?: ReactNode
  showMode?: boolean
  showAudio?: boolean
}

const MODE_KEYS: readonly {
  value: KinoVideoGenerationMode
  labelKey: string
}[] = [
  { value: 't2v', labelKey: 'videoAssets.generate.mode.t2v' },
  { value: 'firstref', labelKey: 'videoAssets.generate.mode.firstref' },
  { value: 'strict', labelKey: 'videoAssets.generate.mode.strict' },
]

export function VideoParameters({
  value,
  modelOptions = [],
  onChange,
  children,
  showMode = true,
  showAudio = true,
  interaction,
}: VideoParametersProps): JSX.Element {
  const t = useT()
  const modeOptions: readonly GenerationParameterOption<KinoVideoGenerationMode>[] = MODE_KEYS.map((option) => ({
    value: option.value,
    label: t(option.labelKey),
  }))
  const sizeOptions = KINO_VIDEO_SIZES.map((size) => ({ value: size, label: t(sizeKey(size)) }))
  const resolutionOptions = KINO_VIDEO_RESOLUTIONS.map((resolution) => ({
    value: resolution,
    label: t(`generation.parameters.resolution.${resolution}`),
  }))
  const models: readonly GenerationParameterOption<string>[] = modelOptions.length > 0
    ? modelOptions.map((model) => ({ value: model, label: model }))
    : [{ value: '', label: t('videoAssets.generate.modelServerDefault') }]

  return (
    <GenerationParametersLayout title={t('generation.parameters.video.title')} interaction={interaction} className="generation-video-parameters">
      {showMode ? <GenerationParameterField label={t('videoAssets.generate.modeLabel')} interaction={interaction}>
        <GenerationOptionGroup
          label={t('videoAssets.generate.modeLabel')}
          value={value.mode}
          options={modeOptions}
          interaction={interaction}
          onChange={(mode) => onChange({ ...value, mode })}
        />
      </GenerationParameterField> : null}
      <GenerationParameterField label={t('videoAssets.generate.model')} interaction={interaction}>
        <GenerationSelectField
          label={t('videoAssets.generate.model')}
          value={value.model ?? ''}
          options={models}
          interaction={interaction}
          onChange={(model) => onChange({ ...value, model: model || undefined })}
        />
      </GenerationParameterField>
      <GenerationParameterField label={t('videoAssets.generate.resolution')} interaction={interaction}>
        <GenerationOptionGroup
          label={t('videoAssets.generate.resolution')}
          value={value.resolution}
          options={resolutionOptions}
          interaction={interaction}
          onChange={(resolution) => onChange({ ...value, resolution })}
        />
      </GenerationParameterField>
      <GenerationParameterField label={t('videoAssets.generate.durationShort')} interaction={interaction}>
        <VideoDurationField
          value={value.durationSeconds}
          onChange={(durationSeconds) => onChange({ ...value, durationSeconds })}
          interaction={interaction}
        />
      </GenerationParameterField>
      <GenerationParameterField label={t('videoAssets.generate.ratio')} interaction={interaction}>
        <GenerationSelectField
          label={t('videoAssets.generate.ratio')}
          value={value.size}
          options={sizeOptions}
          interaction={interaction}
          onChange={(size) => onChange({ ...value, size })}
        />
      </GenerationParameterField>
      {showAudio ? <GenerationParameterField label={t('videoAssets.generate.audio')} interaction={interaction}>
        <GenerationToggleField
          label={t('videoAssets.generate.audio')}
          description={t('videoAssets.generate.audioHint')}
          checked={value.generateAudio}
          onChange={(generateAudio) => onChange({ ...value, generateAudio })}
          interaction={interaction}
        />
      </GenerationParameterField> : null}
      {children}
    </GenerationParametersLayout>
  )
}

interface VideoDurationFieldProps extends GenerationInteractionProps {
  value: number | undefined
  onChange: (value: number) => void
}

function VideoDurationField({
  value,
  onChange,
  interaction,
}: VideoDurationFieldProps): JSX.Element {
  const t = useT()
  const inputId = useId()
  const { state } = useResolvedGenerationInteraction(interaction)
  const disabled = state.disabled || state.readOnly || state.busy
  const duration = clampDuration(value ?? KINO_VIDEO_MIN_DURATION_SECONDS)
  const progress = (
    (duration - KINO_VIDEO_MIN_DURATION_SECONDS)
    / (KINO_VIDEO_MAX_DURATION_SECONDS - KINO_VIDEO_MIN_DURATION_SECONDS)
  ) * 100
  const sliderStyle = {
    '--vgen-duration-progress': `${progress}%`,
  } as CSSProperties

  return (
    <div className="vgen-duration-control">
      <div className="vgen-duration-scale" aria-hidden="true">
        <span>{KINO_VIDEO_MIN_DURATION_SECONDS}{t('videoAssets.generate.secondsUnit')}</span>
        <span>{duration}{t('videoAssets.generate.secondsUnit')}</span>
        <span>{KINO_VIDEO_MAX_DURATION_SECONDS}{t('videoAssets.generate.secondsUnit')}</span>
      </div>
      <input
        id={inputId}
        className="vgen-duration-slider"
        type="range"
        aria-label={t('videoAssets.generate.durationSlider')}
        min={KINO_VIDEO_MIN_DURATION_SECONDS}
        max={KINO_VIDEO_MAX_DURATION_SECONDS}
        step={1}
        value={duration}
        style={sliderStyle}
        disabled={disabled}
        onChange={(event) => onChange(clampDuration(Number(event.target.value)))}
      />
      <div className="vgen-duration-editor">
        <label className="vgen-duration-value" htmlFor={`${inputId}-number`}>
          <input
            id={`${inputId}-number`}
            className="vgen-custom-duration"
            type="number"
            aria-label={t('videoAssets.generate.duration')}
            min={KINO_VIDEO_MIN_DURATION_SECONDS}
            max={KINO_VIDEO_MAX_DURATION_SECONDS}
            step={1}
            value={duration}
            disabled={disabled}
            onChange={(event) => onChange(clampDuration(Number(event.target.value)))}
          />
          <span>{t('videoAssets.generate.secondsUnit')}</span>
        </label>
        <div className="vgen-duration-stepper">
          <button
            type="button"
            aria-label={t('videoAssets.generate.increaseDuration')}
            disabled={disabled || duration >= KINO_VIDEO_MAX_DURATION_SECONDS}
            onClick={() => onChange(clampDuration(duration + 1))}
          >
            <span />
          </button>
          <button
            type="button"
            aria-label={t('videoAssets.generate.decreaseDuration')}
            disabled={disabled || duration <= KINO_VIDEO_MIN_DURATION_SECONDS}
            onClick={() => onChange(clampDuration(duration - 1))}
          >
            <span />
          </button>
        </div>
      </div>
    </div>
  )
}

function clampDuration(value: number): number {
  if (!Number.isFinite(value)) return KINO_VIDEO_MIN_DURATION_SECONDS
  return Math.min(
    KINO_VIDEO_MAX_DURATION_SECONDS,
    Math.max(KINO_VIDEO_MIN_DURATION_SECONDS, Math.round(value)),
  )
}

function sizeKey(size: KinoVideoSize): string {
  const keys: Record<KinoVideoSize, string> = {
    '2560x1440': 'videoAssets.generate.ratio16x9',
    '1440x2560': 'videoAssets.generate.ratio9x16',
    '2496x1664': 'videoAssets.generate.ratio3x2',
    '1664x2496': 'videoAssets.generate.ratio2x3',
  }
  return keys[size]
}
