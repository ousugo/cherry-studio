import { mergeAttributes, Node } from '@tiptap/core'
import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNode } from 'react'

import { ComposerToken } from './ComposerToken'
import type { ComposerDraftToken } from './tokens'
import { normalizeComposerTokenAttrs } from './tokens'

export const COMPOSER_TOKEN_NODE_NAME = 'composerToken'

export type ComposerTokenRenderer = (
  token: ComposerDraftToken,
  props: { selected: boolean; nodeViewProps: NodeViewProps }
) => ReactNode

interface ComposerTokenNodeOptions {
  renderToken?: ComposerTokenRenderer
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    composerToken: {
      insertComposerToken: (token: ComposerDraftToken) => ReturnType
    }
  }
}

function ComposerTokenNodeView(props: NodeViewProps & { renderToken?: ComposerTokenRenderer }) {
  const token = normalizeComposerTokenAttrs(props.node.attrs)
  const rendered = props.renderToken?.(token, { selected: props.selected, nodeViewProps: props }) ?? (
    <ComposerToken token={token} selected={props.selected} />
  )

  return (
    <NodeViewWrapper
      as="span"
      className="inline-flex align-baseline"
      contentEditable={false}
      data-composer-token-node="">
      {rendered}
    </NodeViewWrapper>
  )
}

export const ComposerTokenNode = Node.create<ComposerTokenNodeOptions>({
  name: COMPOSER_TOKEN_NODE_NAME,

  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,

  addOptions() {
    return {
      renderToken: undefined
    }
  },

  addAttributes() {
    return {
      id: { default: null },
      kind: { default: 'reference' },
      label: { default: '' },
      icon: { default: null },
      description: { default: null },
      promptText: { default: null },
      payload: { default: null }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-composer-token]' }]
  },

  renderHTML({ HTMLAttributes }) {
    const safeAttributes = { ...HTMLAttributes }
    delete safeAttributes.payload

    return [
      'span',
      mergeAttributes(safeAttributes, {
        'data-composer-token': '',
        'data-token-id': HTMLAttributes.id,
        'data-token-kind': HTMLAttributes.kind,
        contenteditable: 'false'
      })
    ]
  },

  renderText({ node }) {
    const token = normalizeComposerTokenAttrs(node.attrs)
    return token.promptText ?? ''
  },

  addCommands() {
    return {
      insertComposerToken:
        (token) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: token
          })
        }
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer((props) => <ComposerTokenNodeView {...props} renderToken={this.options.renderToken} />)
  }
})
