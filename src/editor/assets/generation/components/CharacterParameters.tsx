import { useT } from '../../../../i18n'
import {
  ImageLikeParameters,
  type ImageGenerationParameterValue,
  type ImageLikeParametersProps,
} from './ImageParameters'

export type CharacterParametersProps = Omit<ImageLikeParametersProps, 'title' | 'className'>

/** Image-like character generation parameters; references are supplied by a slot. */
export function CharacterParameters(props: CharacterParametersProps): JSX.Element {
  const t = useT()
  return <ImageLikeParameters {...props} title={t('generation.parameters.character.title')} className="generation-character-parameters" />
}

export type CharacterGenerationParameterValue = ImageGenerationParameterValue

