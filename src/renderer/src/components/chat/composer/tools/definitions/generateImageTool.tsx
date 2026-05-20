import { defineTool, registerTool, TopicType } from '@renderer/components/chat/composer/tools/types'
import { isGenerateImageModel } from '@renderer/config/models'
import { Image } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

const useGenerateImageToolController = (context) => {
  const { model, launcher, t } = context
  const [enabled, setEnabled] = useState(false)

  const handleToggle = useCallback(() => {
    setEnabled((prev) => !prev)
  }, [])

  useEffect(() => {
    return launcher.registerLaunchers([
      {
        id: 'generate-image',
        kind: 'command',
        sources: ['popover', 'root-panel'],
        order: 20,
        label: t('chat.input.generate_image'),
        description: '',
        icon: <Image size={18} />,
        active: enabled,
        disabled: !isGenerateImageModel(model),
        action: handleToggle
      }
    ])
  }, [enabled, handleToggle, launcher, model, t])

  return { enabled, handleToggle }
}

const GenerateImageComposerRuntime = ({ context }) => {
  useGenerateImageToolController(context)
  return null
}

const generateImageTool = defineTool({
  key: 'generate_image',
  label: (t) => t('chat.input.generate_image'),
  visibleInScopes: [TopicType.Chat],
  condition: ({ model }) => isGenerateImageModel(model),
  composer: {
    runtime: ({ context }) => <GenerateImageComposerRuntime context={context} />
  }
})

registerTool(generateImageTool)

export default generateImageTool
