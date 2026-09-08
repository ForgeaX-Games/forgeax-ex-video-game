import { useT } from '../../../../i18n'
import {
  ImageLikeParameters,
  type ImageGenerationParameterValue,
  type ImageLikeParametersProps,
} from './ImageParameters'

export type SceneParametersProps = Omit<ImageLikeParametersProps, 'title' | 'className'>

/** Image-like scene generation parameters; references are supplied by a slot. */
export function SceneParameters(props: SceneParametersProps): JSX.Element {
  const t = useT()
  return <ImageLikeParameters {...props} title={t('generation.parameters.scene.title')} className="generation-scene-parameters" />
}

export type SceneGenerationParameterValue = ImageGenerationParameterValue

