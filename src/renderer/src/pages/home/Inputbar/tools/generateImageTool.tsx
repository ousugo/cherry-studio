import { isGenerateImageModel } from '@renderer/config/models'
import GenerateImageButton from '@renderer/pages/home/Inputbar/tools/components/GenerateImageButton'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import { Image } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

const GenerateImageTool = ({ context }) => {
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

  return <GenerateImageButton enabled={enabled} model={model} onEnableGenerateImage={handleToggle} />
}

const generateImageTool = defineTool({
  key: 'generate_image',
  label: (t) => t('chat.input.generate_image'),
  visibleInScopes: [TopicType.Chat],
  condition: ({ model }) => isGenerateImageModel(model),
  render: (context) => <GenerateImageTool context={context} />
})

registerTool(generateImageTool)

export default generateImageTool
