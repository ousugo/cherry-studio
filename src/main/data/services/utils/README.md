# Data Service Utils

This directory holds **shared utility functions used by the data-service layer**. These utilities have a well-defined responsibility boundary and are not project-wide utilities.

Before using, read the [Row → Entity Mapping](../../../../../docs/references/data/data-api-in-main.md#row--entity-mapping) section of `data-api-in-main.md` to understand the service-layer paradigm and conventions (what `rowToEntity` looks like, when to use `nullsToUndefined`, etc.). The section below captures the design-decision history behind these utilities.

## File Index

### `rowMappers.ts` — Row → Entity mapping utilities

Serves each Service's `rowToEntity` function, performing the boundary translation from a SQLite row to a domain entity.

**Exports:**

#### `nullsToUndefined<T>(obj: T): { [K in keyof T]: null extends T[K] ? Exclude<T[K], null> | undefined : T[K] }`

Shallowly replaces top-level `null` values in the object with `undefined`, preserving all other values.

**Design boundaries:**

- **Shallow**: iterates top-level fields only; does not recurse into nested objects or arrays
- **Replace, not delete**: the returned object keeps every original field (value becomes `undefined`); it does not produce a `Partial<T>`
- **SQLite-column-boundary only**: designed for column NULL → TS undefined translation; `null` should not appear inside JSON payloads (if it does, fix the Zod schema instead)
- **Precise typing**: only fields whose type includes `null` are narrowed to `Exclude<T, null> | undefined`; `notNull()` columns pass through unchanged. This matches runtime reality — a `notNull()` column cannot produce `undefined` at this boundary.

**Example:**

```ts
import { nullsToUndefined } from './rowMappers'

const row = { id: 'x', name: 'MCP-1', description: null, timeout: null }
const clean = nullsToUndefined(row)
// clean = { id: 'x', name: 'MCP-1', description: undefined, timeout: undefined }
// type: { id: string; name: string; description: string | undefined; timeout: number | undefined }
```

#### `timestampToISO(value: number | Date): string`

Convert a guaranteed-present timestamp (millisecond epoch) to an ISO string. Use when the input type is already narrowed to `number | Date` — typically for `.notNull()` columns or post-validation values.

**Why the signature rejects `null | undefined`:** `new Date(null).toISOString()` silently returns the Unix epoch (`"1970-01-01T00:00:00.000Z"`). Letting the type system refuse `null | undefined` at the call site turns a silent bug into a compile error.

**Behavioral note on `0`:** `0` is a legitimate timestamp (Unix epoch); this helper passes it through. This differs from `timestampToISOOrUndefined` which treats `0` as falsy.

#### `timestampToISOOrUndefined(value: number | Date | null | undefined): string | undefined`

Convert a DB timestamp to an ISO string, preserving absence as `undefined`. Use at call sites where the input may actually be `null` (nullable columns not yet tightened with `.notNull()`).

**Behavioral note on `0`:** the helper treats `0` as falsy (matching the prior `row.x ? ... : undefined` idiom). Zero is not a valid business timestamp in this codebase.

**Picking between the two helpers:**

| Scenario | Call-site pattern |
| --- | --- |
| Input type is already `number` / `Date` (e.g. `.notNull()` column, post-validation) | `timestampToISO(row.x)` |
| Domain field typed `createdAt?: string` (truly optional) | `timestampToISOOrUndefined(row.createdAt)` |
| Domain field typed `createdAt: string` (guaranteed present) — but DB column is still nullable | `timestampToISOOrUndefined(row.createdAt) ?? new Date().toISOString()` |

Writing the `?? new Date().toISOString()` fallback at the call site (rather than inside a helper) has two benefits:

1. **Greppable**: when a future PR adds `.notNull()` to `createUpdateTimestamps`, every fallback becomes unreachable and can be swept in a single pass — typically replaced with `timestampToISO(row.x)`
2. **Honest**: the synthesized-now semantics is visible exactly where it is relied upon, not hidden inside a utility name

**Example:**

```ts
import { timestampToISO, timestampToISOOrUndefined } from './rowMappers'

timestampToISO(1700000000000)                                           // "2023-11-14T22:13:20.000Z"
timestampToISO(0)                                                       // "1970-01-01T00:00:00.000Z" (passes through)

timestampToISOOrUndefined(1700000000000)                                // "2023-11-14T22:13:20.000Z"
timestampToISOOrUndefined(null)                                         // undefined
timestampToISOOrUndefined(null) ?? new Date().toISOString()             // current time as ISO string
```

## Criteria for Adding a New Utility

Before adding a new utility to this directory, confirm:

1. **Has at least two real consumers** (history: `stripNulls` qualified because `MiniAppService` had made a copy-paste duplicate)
2. **Do not extract simple single-field operations**: operations like `value ?? undefined` are already well-covered by TypeScript itself — do not wrap them
3. **Does not duplicate an existing third-party library** (e.g. lodash) — unless we have specific boundary constraints
4. **Add a new entry to the "File Index" above** documenting responsibility, signature, boundaries, and an example

## Rejected Alternatives

The following approaches to the "SQLite NULL ↔ TypeScript optional" bridge were evaluated and rejected. **Do not re-propose them** unless you have new evidence that invalidates the reason given; if so, cite the data explicitly.

| Approach | Reason for rejection |
| --- | --- |
| Change domain types to `T \| null`, removing the bridge layer | Violates Google TS Style Guide; leaks `null` into the renderer; complicates IPC serialization; requires rewriting all of `shared/types` |
| Use a Drizzle custom column type with `fromDriver(null) → undefined` | Conflicts with Drizzle's type inference; high invasiveness; only saves one `nullsToUndefined` call |
| Adopt the `dnull` third-party library | Inactive maintenance (weekly 686 downloads, maintenance: inactive); recursive deep conversion is an over-match that swallows legitimate `null` values |
| Turn `nullsToUndefined` into a recursive version | Column level is the only source of physical `null`; recursion would swallow legitimate business `null` inside JSON payloads; wasted CPU on large payloads |
| Use `.notNull()` + empty-string default to eliminate `null` at schema level | Explicitly flagged as an anti-pattern by the Drizzle community ([discussion #1086](https://github.com/drizzle-team/drizzle-orm/discussions/1086)) — "masks the real problem" |
| Extract a single-field `nullToUndefined<T>(value)` helper | TS `??` already narrows types at the expression level; function wrapping adds no runtime or type benefit |
