import HorizontalScrollContainer from '@renderer/components/HorizontalScrollContainer'
import CustomTag from '@renderer/components/Tags/CustomTag'
import { getProviderDisplayName, useProviders } from '@renderer/hooks/useProvider'
import type { Model } from '@shared/data/types/model'
import type { FC } from 'react'

const MentionModelsInput: FC<{
  selectedModels: Model[]
  onRemoveModel: (model: Model) => void
}> = ({ selectedModels, onRemoveModel }) => {
  const { providers } = useProviders()

  const getProviderName = (model: Model) => {
    const provider = providers.find((p) => p.id === model?.providerId)
    return provider ? getProviderDisplayName(provider) : ''
  }

  return (
    <div className="w-full px-[15px] py-[5px]">
      <HorizontalScrollContainer dependencies={[selectedModels]} expandable>
        {selectedModels.map((model) => (
          <CustomTag
            icon={<i className="iconfont icon-at" />}
            color="#1677ff"
            key={model.id}
            closable
            onClose={() => onRemoveModel(model)}>
            {model.name} ({getProviderName(model)})
          </CustomTag>
        ))}
      </HorizontalScrollContainer>
    </div>
  )
}

export default MentionModelsInput
