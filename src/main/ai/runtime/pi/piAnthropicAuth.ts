import type { ProviderConfig } from '@earendil-works/pi-coding-agent'

type PiStreamSimple = NonNullable<ProviderConfig['streamSimple']>

/**
 * Adapt pi's Anthropic SDK auth to a Messages-compatible provider whose API key
 * header differs from Anthropic's `x-api-key` default.
 */
export function withAnthropicApiKeyHeaderStream(
  config: ProviderConfig,
  apiKeyHeader: string,
  apiStreamSimple: PiStreamSimple
): ProviderConfig {
  const streamSimple: PiStreamSimple = (model, context, options) => {
    const headers = {
      ...options?.headers,
      [apiKeyHeader]: options?.apiKey ?? '',
      authorization: null,
      'x-api-key': null
    } as unknown as NonNullable<typeof options>['headers']

    return apiStreamSimple(model, context, { ...options, headers })
  }

  return { ...config, streamSimple }
}
