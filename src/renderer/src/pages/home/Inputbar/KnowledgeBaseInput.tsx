import { FileSearchOutlined } from '@ant-design/icons'
import HorizontalScrollContainer from '@renderer/components/HorizontalScrollContainer'
import CustomTag from '@renderer/components/Tags/CustomTag'
import type { KnowledgeBase } from '@renderer/types'
import type { FC } from 'react'

const KnowledgeBaseInput: FC<{
  selectedKnowledgeBases: KnowledgeBase[]
  onRemoveKnowledgeBase: (knowledgeBase: KnowledgeBase) => void
}> = ({ selectedKnowledgeBases, onRemoveKnowledgeBase }) => {
  return (
    <div className="w-full px-3.75 py-1.25">
      <HorizontalScrollContainer dependencies={[selectedKnowledgeBases]} expandable>
        {selectedKnowledgeBases.map((knowledgeBase) => (
          <CustomTag
            icon={<FileSearchOutlined />}
            color="#3d9d0f"
            key={knowledgeBase.id}
            closable
            onClose={() => onRemoveKnowledgeBase(knowledgeBase)}>
            {knowledgeBase.name}
          </CustomTag>
        ))}
      </HorizontalScrollContainer>
    </div>
  )
}

export default KnowledgeBaseInput
