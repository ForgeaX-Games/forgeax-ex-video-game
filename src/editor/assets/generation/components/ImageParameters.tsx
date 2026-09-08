import { useT } from '../../../../i18n'
import type { ReactNode } from 'react'
import type { KinoImageGenerationParams, KinoImageSize } from '@/runtime/core/schema/kino-image-schema'
import {
  GenerationOptionGroup,
  GenerationParameterField,
  GenerationParametersLayout,
  GenerationSelectField,
  type GenerationParameterOption,
} from './GenerationParameters'
import type { GenerationInteractionProps } from './interaction'

export type ImageGenerationParameterValue = Pick<KinoImageGenerationParams, 'model' | 'size'>

export interface ImageParametersProps extends GenerationInteractionProps {
  value: ImageGenerationParameterValue
  modelOptions?: readonly string[]
  modelDisabled?: boolean
  onChange: (value: ImageGenerationParameterValue) => void
  children?: ReactNode
}

export interface ImageLikeParametersProps extends GenerationInteractionProps {
  value: ImageGenerationParameterValue
  modelOptions?: readonly string[]
  onChange: (value: ImageGenerationParameterValue) => void
  title: string
  children?: ReactNode
  className?: string
  modelDisabled?: boolean
}

const SIZE_VALUES: readonly KinoImageSize[] = [
  '2560x1440',
  '1440x2560',
  '2496x1664',
  '1664x2496',
]

export function ImageParameters({
  value,
  modelOptions = [],
  modelDisabled = false,
  onChange,
  children,
  interaction,
}: ImageParametersProps): JSX.Element {
  const t = useT()
  return (
    <ImageLikeParameters
      value={value}
      modelOptions={modelOptions}
      onChange={onChange}
      title={t('generation.parameters.image.title')}
      interaction={interaction}
      modelDisabled={modelDisabled}
      className="generation-image-parameters"
    >
      {children}
    </ImageLikeParameters>
  )
}

export function ImageLikeParameters({
  value,
  modelOptions = [],
  onChange,
  title,
  children,
  interaction,
  className,
  modelDisabled = false,
}: ImageLikeParametersProps): JSX.Element {
  const t = useT()
  const sizeOptions: readonly GenerationParameterOption<KinoImageSize>[] = SIZE_VALUES.map((size) => ({
    value: size,
    label: sizeLabel(size),
  }))
  const models: readonly GenerationParameterOption<string>[] = modelOptions.length > 0
    ? modelOptions.map((model) => ({ value: model, label: model }))
    : [{ value: '', label: t('imageGeneration.serverDefaultModel') }]
  return (
    <GenerationParametersLayout title={title} interaction={interaction} className={className}>
      <GenerationParameterField label={t('imageGeneration.model')} interaction={interaction}>
        <GenerationSelectField
          label={t('imageGeneration.model')}
          value={value.model ?? ''}
          options={models}
          interaction={interaction}
          disabled={modelDisabled}
          onChange={(model) => onChange({ ...value, model: model || undefined })}
        />
      </GenerationParameterField>
      <GenerationParameterField label={t('imageGeneration.size')} interaction={interaction}>
        <GenerationOptionGroup
          label={t('imageGeneration.size')}
          value={value.size}
          options={sizeOptions}
          interaction={interaction}
          onChange={(size) => onChange({ ...value, size })}
        />
      </GenerationParameterField>
      {children}
    </GenerationParametersLayout>
  )
}

function sizeLabel(size: KinoImageSize): string {
  const labels: Record<KinoImageSize, string> = {
    '2560x1440': '16:9',
    '1440x2560': '9:16',
    '2496x1664': '3:2',
    '1664x2496': '2:3',
  }
  return `${labels[size]} ${size.replace('x', '×')}`
}
