# DataApi in Main Process

This guide covers how to implement API handlers and services in the Main process.

## Architecture Layers

```
Handlers → Services → Database
```

- **Handlers**: Thin layer, extract params, call service, transform response
- **Services**: Business logic, validation, transaction coordination, data access via Drizzle ORM
- **Database**: Drizzle ORM + SQLite

## Transport Adapters

ApiServer is transport-agnostic. Adapters in `api/core/adapters/` bridge specific transports (IPC, HTTP) to ApiServer. Each adapter implements `Disposable` for automatic lifecycle cleanup. See `IpcAdapter.ts` JSDoc for design rationale and extension guide.

## Implementing Handlers

### Location
`src/main/data/api/handlers/`

### Handler Responsibilities
- Extract parameters from request
- Delegate to business service
- Transform response for IPC
- **NO business logic here**

### Example Handler

```typescript
// handlers/topic.ts
import type { ApiImplementation } from '@shared/data/api'
import { topicService } from '@data/services/TopicService'

export const topicHandlers: Partial<ApiImplementation> = {
  '/topics': {
    GET: async ({ query }) => {
      const { page = 1, limit = 20 } = query ?? {}
      return await topicService.list({ page, limit })
    },
    POST: async ({ body }) => {
      return await topicService.create(body)
    }
  },
  '/topics/:id': {
    GET: async ({ params }) => {
      return await topicService.getById(params.id)
    },
    PUT: async ({ params, body }) => {
      return await topicService.replace(params.id, body)
    },
    PATCH: async ({ params, body }) => {
      return await topicService.update(params.id, body)
    },
    DELETE: async ({ params }) => {
      await topicService.delete(params.id)
    }
  }
}
```

### Register Handlers

```typescript
// handlers/index.ts
import { topicHandlers } from './topic'
import { messageHandlers } from './message'

export const allHandlers: ApiImplementation = {
  ...topicHandlers,
  ...messageHandlers
}
```

## Implementing Services

### Location
`src/main/data/services/`

### Service Responsibilities
- Business validation
- Transaction coordination
- Domain workflows
- Data access via Drizzle ORM

### Example Service

```typescript
// services/TopicService.ts
import { eq, desc, sql } from 'drizzle-orm'
import { application } from '@application'
import { topicTable } from '@data/db/schemas/topic'
import { DataApiErrorFactory } from '@shared/data/api'

export class TopicService {
  private static instance: TopicService

  static getInstance(): TopicService {
    if (!this.instance) {
      this.instance = new TopicService()
    }
    return this.instance
  }

  private get db() {
    return application.get('DbService').getDb()
  }

  async list(options: { page: number; limit: number }) {
    const { page, limit } = options
    const offset = (page - 1) * limit

    const [items, countResult] = await Promise.all([
      this.db.select().from(topicTable)
        .orderBy(desc(topicTable.updatedAt))
        .limit(limit).offset(offset),
      this.db.select({ count: sql<number>`count(*)` }).from(topicTable)
    ])

    return { items, total: countResult[0].count, page, limit }
  }

  async getById(id: string) {
    const [topic] = await this.db.select().from(topicTable)
      .where(eq(topicTable.id, id)).limit(1)
    if (!topic) {
      throw DataApiErrorFactory.notFound('Topic', id)
    }
    return topic
  }

  async create(data: CreateTopicDto) {
    this.validateTopicData(data)
    const [topic] = await this.db.insert(topicTable).values(data).returning()
    return topic
  }

  async update(id: string, data: Partial<UpdateTopicDto>) {
    await this.getById(id) // Throws if not found
    const [topic] = await this.db.update(topicTable)
      .set(data).where(eq(topicTable.id, id)).returning()
    return topic
  }

  async delete(id: string) {
    await this.getById(id) // Throws if not found
    await this.db.delete(topicTable).where(eq(topicTable.id, id))
  }

  private validateTopicData(data: CreateTopicDto) {
    if (!data.name?.trim()) {
      throw DataApiErrorFactory.validation({ name: ['Name is required'] })
    }
  }
}

export const topicService = TopicService.getInstance()
```

### Row → Entity Mapping

Each Entity Service provides a `rowToEntity` function that bridges a Drizzle row to its domain entity. Use `nullsToUndefined` (from `services/utils/rowMappers.ts`) for the SQLite NULL → TypeScript `undefined` translation.

**Standard skeleton:**

```ts
import { nullsToUndefined, timestampToISOOrUndefined } from './utils/rowMappers'

function rowToMCPServer(row: typeof mcpServerTable.$inferSelect): MCPServer {
  const clean = nullsToUndefined(row)
  return {
    ...clean,
    type: clean.type as MCPServer['type'], // narrow enum
    installSource: clean.installSource as MCPServer['installSource'],
    // MCPServer declares createdAt/updatedAt as optional — absence stays absent
    createdAt: timestampToISOOrUndefined(row.createdAt),
    updatedAt: timestampToISOOrUndefined(row.updatedAt)
  }
}
```

For services whose domain type declares `createdAt: string` (non-optional), append the "synthesize now" fallback at the call site:

```ts
createdAt: timestampToISOOrUndefined(row.createdAt) ?? new Date().toISOString(),
updatedAt: timestampToISOOrUndefined(row.updatedAt) ?? new Date().toISOString()
```

**Advanced skeleton — preserving `T | null` fields:**

When the domain type declares a field as `T | null` (e.g. `KnowledgeBaseSchema.embeddingModelId: z.string().nullable()`), bypass `clean` for that field and reference `row` directly. `nullsToUndefined` narrows all top-level `null`s to `undefined` and would break the `T | null` contract if the field came from `clean`.

```ts
function rowToKnowledgeBase(row: typeof knowledgeBaseTable.$inferSelect): KnowledgeBase {
  const clean = nullsToUndefined(row)
  return {
    ...clean,
    // Preserve `string | null` contract — bypass clean (which would narrow null → undefined)
    embeddingModelId: row.embeddingModelId,
    createdAt: timestampToISOOrUndefined(row.createdAt) ?? new Date().toISOString(),
    updatedAt: timestampToISOOrUndefined(row.updatedAt) ?? new Date().toISOString()
  }
}
```

Rule of thumb: **domain field typed `T | null` → use `row.x`; domain field typed `T?` or `T` → use `clean.x` (or `...clean`).**

**When `nullsToUndefined + spread` is NOT a fit:**

Some `rowToEntity` functions do too much to benefit from spread. Keep them hand-written when any of the following apply:

- **Field renaming**: `row.parameters → domain parameterSupport` (ModelService)
- **Non-`undefined` fallbacks**: `?? []`, `?? true`, `?? false`, `?? anotherField` — these need per-field logic anyway
- **Computed / merged fields**: `authType` derivation, `apiFeatures` merging from defaults (ProviderService)
- **Sensitive data sanitization**: `apiKeys` stripping — `...clean` would leak unsanitized values

**Conventions:**

1. **DB NULL ↔ domain `undefined` boundary.** Domain types under `@shared/data/types/*` use optional fields (`?:`) rather than `T | null`, aligning with the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) and keeping `null` from leaking to the renderer via IPC. `nullsToUndefined(row)` is the only place this translation happens.
2. **Batch vs single-field null handling.** For processing an entire row, always use `nullsToUndefined(row)` + spread — do NOT hand-write per-field `?? undefined`. For single values that are NOT from a row (DTO fields, computed values, function returns), inline `value ?? undefined` is enough — TypeScript narrows `T | null` to `T | undefined` automatically at the `??` expression. Do NOT wrap the single-field case in a helper.
3. **Date fields: two helpers, explicit fallback.** Two siblings cover the spectrum:
   - `timestampToISO(value: number | Date): string` — for inputs already narrowed to non-null (e.g. `.notNull()` columns, post-validation values)
   - `timestampToISOOrUndefined(value: number | Date | null | undefined): string | undefined` — for nullable columns; returns `undefined` on absence

   When the domain contract requires a non-null string but the column is still nullable, append `?? new Date().toISOString()` at the call site. Keeping the "synthesize now" semantics greppable lets a future PR sweep them out in one pass once `createUpdateTimestamps` gains `.notNull()` — at which point call sites migrate to `timestampToISO`.

For function signature details and design-decision history (e.g. why shallow-not-recursive, why not `dnull`), see [services/utils/README.md](../../../src/main/data/services/utils/README.md).

### Service with Transaction

```typescript
async createTopicWithMessage(data: CreateTopicWithMessageDto) {
  const db = application.get('DbService').getDb()

  return await db.transaction(async (tx) => {
    const [topic] = await tx.insert(topicTable).values(data.topic).returning()

    const [message] = await tx.insert(messageTable).values({
      ...data.message,
      topicId: topic.id
    }).returning()

    return { topic, message }
  })
}
```

## Repository Pattern (Strongly Discouraged)

> **⚠️ Do NOT create Repository files by default.** Services handle both business logic and data access directly via Drizzle ORM. This is an intentional design decision.
>
> Only create a separate Repository when you are **1000% certain** it is absolutely necessary — e.g., extremely complex multi-table queries with joins/CTEs that would make the Service unreadable, AND the query logic is reused across multiple services.
>
> If in doubt, keep it in the Service. The overhead of an extra architectural layer is not justified for this project's scale (Electron desktop app + SQLite).

### Registry Services (Supplementary)

> In rare cases where a handler needs to merge **read-only preset data**
> (shipped JSON/TS) with database data, a Registry Service may be introduced.
> This is uncommon — the vast majority of services are Entity Services.

Registry Services:
- **Do NOT own a database table** and **do NOT access the database directly**
- Obtain DB data by calling the owning Entity Service
- Named `{Domain}RegistryService` (e.g., `ProviderRegistryService`)
- Primary data source is static preset data (JSON files, TS constants)
- All methods are read-only (no inserts, updates, or deletes)

See [Layered Preset Pattern](./best-practice-layered-preset-pattern.md) for the general architecture.

## Error Handling

### Using DataApiErrorFactory

```typescript
import { DataApiErrorFactory } from '@shared/data/api'

// Not found
throw DataApiErrorFactory.notFound('Topic', id)

// Validation error
throw DataApiErrorFactory.validation({
  name: ['Name is required', 'Name must be at least 3 characters'],
  email: ['Invalid email format']
})

// Database error
try {
  await db.insert(table).values(data)
} catch (error) {
  throw DataApiErrorFactory.database(error, 'insert topic')
}

// Invalid operation
throw DataApiErrorFactory.invalidOperation(
  'delete root message',
  'cascade=true required'
)

// Conflict
throw DataApiErrorFactory.conflict('Topic name already exists')

// Timeout
throw DataApiErrorFactory.timeout('fetch topics', 3000)
```

## Adding New Endpoints

### Step-by-Step

1. **Define schema** in `packages/shared/data/api/schemas/`

```typescript
// schemas/topic.ts
export interface TopicSchemas {
  '/topics': {
    GET: { response: PaginatedResponse<Topic> }
    POST: { body: CreateTopicDto; response: Topic }
  }
}
```

2. **Register schema** in `schemas/index.ts`

```typescript
export type ApiSchemas = AssertValidSchemas<TopicSchemas & MessageSchemas>
```

3. **Create service** in `services/`

4. **Implement handler** in `handlers/`

5. **Register handler** in `handlers/index.ts`

## Best Practices

1. **Keep handlers thin**: Only extract params and call services
2. **Put logic in services**: All business rules and data access belong in services
3. **Do NOT create separate Repository files**: Services own data access directly via Drizzle ORM
4. **Always use `.returning()`**: Get inserted/updated data without re-querying
5. **Support transactions**: Accept optional `tx` parameter in service methods
6. **Validate in services**: Business validation belongs in the service layer
7. **Use error factory**: Consistent error creation with `DataApiErrorFactory`
8. **Use `nullsToUndefined` in `rowToEntity`**: Canonical SQLite NULL → `undefined` translation; shallow, not recursive (see [Row → Entity Mapping](#row--entity-mapping))
