import { useT } from '../../../../i18n'
import {
  ImageLikeParameters,
  type ImageGenerationParameterValue,
  type ImageLikeParametersProps,
} from './ImageParameters'

export type ControlParametersProps = Omit<ImageLikeParametersProps, 'title' | 'className'>

/** Controls are image-like generated assets; no additional transport fields are invented here. */
export function ControlParameters(props: ControlParametersProps): JSX.Element {
  const t = useT()
  return <ImageLikeParameters {...props} title={t('generation.parameters.control.title')} className="generation-control-parameters" />
}

export type ControlGenerationParameterValue = ImageGenerationParameterValue

