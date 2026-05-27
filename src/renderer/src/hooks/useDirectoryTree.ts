import { loggerService } from '@logger'
import {
  type CreateTreeIpcResult,
  type DirectoryTreeOptions,
  rootFromSerialized,
  TreeDir,
  type TreeDirRoot,
  TreeFile,
  type TreeMutationEvent,
  type TreeMutationPushPayload,
  type TreeNode
} from '@shared/file/types'
import { debounce } from 'lodash'
import { useCallback, useEffect, useRef, useState } from 'react'

const logger = loggerService.withContext('useDirectoryTree')

/**
 * Delay each `tree.dispose` so high-frequency mount/unmount churn (e.g. user
 * toggling the artifact pane) doesn't tear down the warm `DirectoryTreeBuilder`
 * on the main side. Within this window the main-side `TreeRegistry` keeps the
 * shared builder alive (refcount stays > 0 because the next mount lands before
 * dispose fires), so a remount hits the cached snapshot instead of paying a
 * fresh ripgrep + stat sweep.
 */
const TREE_DISPOSE_DEBOUNCE_MS = 5_000

export interface UseDirectoryTreeResult {
  readonly root: TreeDirRoot | null
  readonly isLoading: boolean
  readonly error: Error | null
  /** Monotonic counter that ticks whenever the mirror mutates. */
  readonly version: number
  /**
   * Identifier of the live tree on the main side. Consumers that subscribe to
   * the shared `Tree_Mutation` channel directly should filter incoming
   * payloads by this id. `null` until the first `Tree_Create` resolves.
   */
  readonly treeId: string | null
  /** O(1) lookup keyed by absolute path. Stable across mutations. */
  getNode(absPath: string): TreeNode | null
}

interface MirrorState {
  readonly root: TreeDirRoot
  readonly nodes: Map<string, TreeNode>
}

function indexTree(root: TreeDirRoot): Map<string, TreeNode> {
  const map = new Map<string, TreeNode>()
  root.walk((n) => {
    map.set(n.path, n)
  })
  return map
}

function applyMutation(state: MirrorState, event: TreeMutationEvent): boolean {
  if (event.type === 'added') {
    if (state.nodes.has(event.path)) return false
    const parent = state.nodes.get(event.parentPath)
    if (!parent || !(parent instanceof TreeDir)) return false
    const node =
      event.kind === 'directory'
        ? new TreeDir({ path: event.path, stats: event.stats })
        : new TreeFile({ path: event.path, stats: event.stats })
    parent.attachChild(node)
    state.nodes.set(event.path, node)
    return true
  }
  if (event.type === 'removed') {
    const node = state.nodes.get(event.path)
    if (!node) return false
    if (node instanceof TreeDir) {
      const drop: string[] = []
      node.walk((n) => {
        if (n !== node) drop.push(n.path)
      })
      for (const p of drop) state.nodes.delete(p)
    }
    state.nodes.delete(event.path)
    node.remove()
    return true
  }
  // updated
  const node = state.nodes.get(event.path)
  if (!node) return false
  node.stats = event.stats
  return true
}

export function useDirectoryTree(rootPath: string | undefined, options?: DirectoryTreeOptions): UseDirectoryTreeResult {
  const [root, setRoot] = useState<TreeDirRoot | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [version, setVersion] = useState(0)
  const [treeId, setTreeId] = useState<string | null>(null)
  const mirrorRef = useRef<MirrorState | null>(null)
  const optionsRef = useRef<DirectoryTreeOptions | undefined>(options)
  optionsRef.current = options

  useEffect(() => {
    if (!rootPath) {
      setRoot(null)
      setError(null)
      setIsLoading(false)
      setTreeId(null)
      mirrorRef.current = null
      return
    }

    let cancelled = false
    let unsubscribeMutations: (() => void) | null = null
    let createdTreeId: string | null = null

    setIsLoading(true)
    setError(null)

    const scheduleDispose = debounce((treeId: string): void => {
      Promise.resolve(window.api.tree.dispose(treeId)).catch((err) => {
        logger.error(`Failed to dispose tree ${treeId}`, err as Error)
      })
    }, TREE_DISPOSE_DEBOUNCE_MS)

    void (async () => {
      try {
        const result: CreateTreeIpcResult = await window.api.tree.create(rootPath, optionsRef.current)
        if (cancelled) {
          scheduleDispose(result.treeId)
          return
        }

        createdTreeId = result.treeId

        const snapshotRoot = rootFromSerialized(result.snapshot)
        const nodes = indexTree(snapshotRoot)
        mirrorRef.current = { root: snapshotRoot, nodes }
        setRoot(snapshotRoot)
        setTreeId(result.treeId)
        setIsLoading(false)

        unsubscribeMutations = window.api.tree.onMutation((payload: TreeMutationPushPayload) => {
          if (payload.treeId !== result.treeId) return
          const mirror = mirrorRef.current
          if (!mirror) return
          const changed = applyMutation(mirror, payload.event)
          if (changed) setVersion((v) => v + 1)
        })
      } catch (err) {
        if (cancelled) return
        const normalized = err instanceof Error ? err : new Error(String(err))
        logger.error(`Failed to create directory tree for ${rootPath}`, normalized)
        setError(normalized)
        setIsLoading(false)
      }
    })()

    return () => {
      cancelled = true
      unsubscribeMutations?.()
      if (createdTreeId) scheduleDispose(createdTreeId)
      mirrorRef.current = null
      setTreeId(null)
    }
    // Re-create only on rootPath change. Options are sampled at mount time
    // via optionsRef; later option changes do NOT trigger a rebuild — pass a
    // new rootPath if you need different scan options.
  }, [rootPath])

  const getNode = useCallback((absPath: string): TreeNode | null => {
    return mirrorRef.current?.nodes.get(absPath) ?? null
  }, [])

  return { root, isLoading, error, version, treeId, getNode }
}
