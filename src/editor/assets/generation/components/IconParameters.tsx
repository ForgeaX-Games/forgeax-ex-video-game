import { useT } from '../../../../i18n'
import {
  ImageLikeParameters,
  type ImageGenerationParameterValue,
  type ImageLikeParametersProps,
} from './ImageParameters'

export type IconParametersProps = Omit<ImageLikeParametersProps, 'title' | 'className'>

/** Image-like icon generation parameters; no icon-only transport fields exist. */
export function IconParameters(props: IconParametersProps): JSX.Element {
  const t = useT()
  return <ImageLikeParameters {...props} title={t('generation.parameters.icon.title')} className="generation-icon-parameters" />
}

export type IconGenerationParameterValue = ImageGenerationParameterValue

