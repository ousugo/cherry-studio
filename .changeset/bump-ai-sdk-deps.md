---
'CherryStudio': patch
---

Bump AI SDK dependencies and fix provider API host formatting

- Bump `@ai-sdk/*` packages to latest versions
- Fix NewAPI provider missing `/v1beta` suffix for Gemini models
- Fix Azure provider adding unwanted `/openai` suffix for Anthropic endpoints
- Re-add `@ai-sdk/google` patch for `getModelPath` to handle model IDs with slashes
- Support `azure-openai` provider type in Claude Code agent service
