import { DEFAULT_ASSISTANT_ID, DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

import { CHERRYAI_DEFAULT_UNIQUE_MODEL_ID } from './cherryai'

export const DEFAULT_ASSISTANT_NAME = 'Default Assistant' as const
export const DEFAULT_ASSISTANT_EMOJI = '😀' as const
export const DEFAULT_ASSISTANT_PROMPT = '' as const
export const DEFAULT_ASSISTANT_MODEL_ID = CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
export const DEFAULT_ASSISTANT_SEED = {
  id: DEFAULT_ASSISTANT_ID,
  name: DEFAULT_ASSISTANT_NAME,
  emoji: DEFAULT_ASSISTANT_EMOJI,
  prompt: DEFAULT_ASSISTANT_PROMPT,
  description: '',
  modelId: DEFAULT_ASSISTANT_MODEL_ID,
  settings: DEFAULT_ASSISTANT_SETTINGS
} as const
