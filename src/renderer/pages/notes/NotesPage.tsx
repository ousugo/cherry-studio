import { loggerService } from '@logger'
import type { CodeEditorHandles } from '@renderer/components/CodeEditor'
import type { RichEditorRef } from '@renderer/components/RichEditor/types'
import { useCache } from '@renderer/data/hooks/useCache'
import { useDirectoryTree } from '@renderer/hooks/useDirectoryTree'
import { useNote } from '@renderer/hooks/useNote'
import { useActiveNode, useFileContent, useFileContentSync } from '@renderer/hooks/useNotesQuery'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { useShowWorkspace } from '@renderer/hooks/useShowWorkspace'
import { ipcApi } from '@renderer/ipc'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import {
  addDir,
  addNote,
  delNode,
  projectNotesTree,
  renameNode as renameEntry,
  resolveNotesPath,
  sortTree,
  uploadNotes
} from '@renderer/services/NotesService'
import {
  findNode,
  findNodeByPath,
  findParent,
  normalizePathValue,
  reorderTreeNodes,
  updateTreeNode
} from '@renderer/services/NotesTreeService'
import { toast } from '@renderer/services/toast'
import type { NotesSortType, NotesTreeNode } from '@renderer/types/note'
import type { Note } from '@shared/data/types/note'
import type { DirectoryTreeOptions } from '@shared/utils/file'
import { debounce } from 'es-toolkit/compat'
import { AnimatePresence, motion } from 'motion/react'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import HeaderNavbar from './HeaderNavbar'
import NotesEditor from './NotesEditor'
import NotesSidebar from './NotesSidebar'
import { getInitialNoteTitle } from './noteTitle'

const logger = loggerService.withContext('NotesPage')
const SAVE_FAILURE_TOAST_INTERVAL_MS = 5000

const NOTES_TREE_OPTIONS: DirectoryTreeOptions = {
  // Notes ships only `.md` files. Stats fuel `sortType: sort_updated_*` /
  // `sort_created_*`. We deliberately ignore `.gitignore` — the notes root
  // is the user's working directory, not a git-versioned repo.
  extensions: ['.md'],
  respectGitignore: false,
  includeHidden: false,
  withStats: true
}

type NoteMetadataSnapshot = Pick<Note, 'path' | 'isStarred' | 'isExpanded'>

function getNoteNameFromPath(path: string): string {
  return path.split('/').at(-1)?.replace(/\.md$/i, '') ?? path
}

const NotesPage: FC = () => {
  const editorRef = useRef<RichEditorRef>(null)
  const codeEditorRef = useRef<CodeEditorHandles>(null)
  const { t } = useTranslation()
  const { showWorkspace } = useShowWorkspace()
  const [activeFilePath, setActiveFilePath] = useCache('notes.active_file_path')
  const { notesPath, updateNotesPath, sortType, updateSortType } = useNotesSettings()
  const { noteByPath, patchNode, removePath, rewritePath } = useNote(notesPath)

  // `useDirectoryTree` owns the FS scan + chokidar watcher behind a single
  // `File_TreeCreate` IPC. Whenever the watcher observes add / unlink / rename
  // events, `root` (mutated in place) + `version` (tick) drive the
  // projection effect below to refresh `notesTree`.
  const {
    root: treeRoot,
    version: treeVersion,
    treeId,
    error: treeError
  } = useDirectoryTree(notesPath || undefined, NOTES_TREE_OPTIONS)

  // Surface tree-create failures (missing ripgrep, EACCES on the notes
  // folder, deleted root). Without this, the user sees a silently-empty
  // tree with no toast and no log a non-developer would notice.
  useEffect(() => {
    if (!treeError) return
    logger.error('Failed to load notes directory tree', treeError, { notesPath, treeId })
    toast.error(t('notes.tree_load_failed'))
  }, [treeError, notesPath, treeId, t])

  // 混合策略：useLiveQuery用于笔记树，React Query用于文件内容
  const [notesTree, setNotesTree] = useState<NotesTreeNode[]>([])
  const noteByPathRef = useRef(noteByPath)
  const { activeNode } = useActiveNode(notesTree, activeFilePath)
  const { invalidateFileContent, primeFileContent } = useFileContentSync()
  const { data: loadedContent, error: currentContentError } = useFileContent(activeFilePath)
  const currentContent = loadedContent ?? ''
  const contentLoadError = activeFilePath ? currentContentError : undefined

  const [tokenCount, setTokenCount] = useState(0)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const lastContentRef = useRef<string>('')
  const lastFilePathRef = useRef<string | undefined>(undefined)
  const lastSaveFailureToastAtRef = useRef(0)
  const isRenamingRef = useRef(false)
  const isCreatingNoteRef = useRef(false)
  const newNotePathsRef = useRef<Set<string>>(new Set())
  const savedNewNoteContentRef = useRef<Map<string, string>>(new Map())
  const persistedContentByPathRef = useRef<Map<string, string>>(new Map())
  const initialTitleFallbackPathsRef = useRef<Set<string>>(new Set())
  const initialTitleSavePromisesRef = useRef<Map<string, Promise<boolean>>>(new Map())
  const initialTitleFinalizePromisesRef = useRef<Map<string, Promise<boolean>>>(new Map())
  const initialTitleRenamesRef = useRef<Set<string>>(new Set())
  const initialTitleRenamePromisesRef = useRef<Map<string, Promise<string | undefined>>>(new Map())
  const activeNodeSnapshotRef = useRef<NotesTreeNode | null>(activeNode)
  const pendingRenamedActivePathRef = useRef<string | undefined>(undefined)
  const renameSessionFinalPathRef = useRef<string | undefined>(undefined)
  const renameSessionPersistedContentRef = useRef<string | undefined>(undefined)
  const [activeDocumentId, setActiveDocumentId] = useState(activeFilePath)
  const pendingScrollRef = useRef<{ lineNumber: number; lineContent?: string } | null>(null)

  const activeFilePathRef = useRef<string | undefined>(activeFilePath)
  const currentContentRef = useRef(currentContent)
  const contentLoadErrorRef = useRef<Error | undefined>(contentLoadError as Error | undefined)
  const applyInitialNoteTitleRef = useRef<
    (content: string, filePath: string, allowIncompleteFirstLine?: boolean) => Promise<void>
  >(async () => {})
  const displayedActiveNode = activeNode ?? (isRenamingRef.current ? activeNodeSnapshotRef.current : null)

  const mergeTreeState = useCallback((nodes: NotesTreeNode[]): NotesTreeNode[] => {
    return nodes.map((node) => {
      const normalizedPath = normalizePathValue(node.externalPath)
      const currentNote = noteByPathRef.current.get(normalizedPath)
      const merged: NotesTreeNode = {
        ...node,
        externalPath: normalizedPath,
        isStarred: currentNote?.isStarred ?? false
      }

      if (node.type === 'folder') {
        merged.expanded = currentNote?.isExpanded ?? false
        merged.children = node.children ? mergeTreeState(node.children) : []
      }

      return merged
    })
  }, [])

  // Project the FS tree (from `useDirectoryTree`) into the legacy
  // `NotesTreeNode[]` shape every time the FS changes — watcher events
  // bump `treeVersion`, the user toggling sort changes `sortType`, and
  // the initial mount triggers when `treeRoot` first becomes non-null.
  useEffect(() => {
    if (!treeRoot || !notesPath) {
      setNotesTree([])
      return
    }
    const projected = projectNotesTree(treeRoot, notesPath)
    const sorted = sortTree(projected, sortType)
    setNotesTree(mergeTreeState(sorted))
    // `treeVersion` participates so that watcher-driven mutations re-derive
    // the projection even though `treeRoot` is the same object identity.
  }, [treeRoot, treeVersion, notesPath, sortType, mergeTreeState])

  // Re-merge tree state when note metadata changes
  useEffect(() => {
    noteByPathRef.current = noteByPath
    if (notesTree.length > 0) {
      setNotesTree((prev) => mergeTreeState(prev))
    }
  }, [mergeTreeState, noteByPath, notesTree.length])

  useEffect(() => {
    const textContent = editorRef.current?.getContent() || currentContent
    const plainText = textContent.replace(/<[^>]*>/g, '')
    setTokenCount(plainText.length)
  }, [currentContent])

  // 保存当前笔记内容
  const saveCurrentNote = useCallback(
    async (content: string, filePath?: string): Promise<boolean> => {
      const targetPath = filePath || activeFilePath
      if (!targetPath) return true
      const persistedContent = persistedContentByPathRef.current.get(targetPath)
      if (persistedContent !== undefined && content.trim() === persistedContent.trim()) {
        await applyInitialNoteTitleRef.current(content, targetPath)
        return true
      }
      if (contentLoadErrorRef.current && targetPath === activeFilePathRef.current) {
        logger.warn('Skipped note save because current file content failed to load', { targetPath })
        toast.error(t('notes.save_blocked_load_failed'))
        return false
      }

      try {
        await window.api.file.write(targetPath, content)
        persistedContentByPathRef.current.set(targetPath, content)
        if (targetPath === activeFilePathRef.current) {
          currentContentRef.current = content
        }
        const latestNewNoteContent = newNotePathsRef.current.has(targetPath)
          ? savedNewNoteContentRef.current.get(targetPath)
          : undefined
        if (newNotePathsRef.current.has(targetPath) && latestNewNoteContent === undefined) {
          savedNewNoteContentRef.current.set(targetPath, content)
        }
        await applyInitialNoteTitleRef.current(latestNewNoteContent ?? content, targetPath)
        // A successful initial-title rename switches the active path and
        // primes its cache. Only revalidate when the note stayed put.
        if (activeFilePathRef.current === targetPath) {
          invalidateFileContent(targetPath)
        }
        return true
      } catch (error) {
        logger.error('Failed to save note:', error as Error)
        const now = Date.now()
        if (now - lastSaveFailureToastAtRef.current > SAVE_FAILURE_TOAST_INTERVAL_MS) {
          lastSaveFailureToastAtRef.current = now
          toast.error(t('notes.save_failed'))
        }
        return false
      }
    },
    [activeFilePath, invalidateFileContent, t]
  )

  // `useDirectoryTree` owns the FS scan + watcher pipeline now. We keep a
  // hook-stable identity for `refreshTree` so all the rollback paths /
  // optimistic-update recovery branches below can hold it in their
  // dependency arrays unchanged — the actual tree refresh happens
  // automatically via the projection effect every time the watcher
  // observes a mutation.
  const refreshTree = useCallback(async (): Promise<void> => {
    /* no-op — see comment above */
  }, [])

  const saveCurrentNoteRef = useRef(saveCurrentNote)
  // Stable debounce instance constructed once. Reads the latest
  // `saveCurrentNote` via `saveCurrentNoteRef` so a SWR revalidation that
  // changes `saveCurrentNote`'s identity does NOT rebuild the debouncer —
  // rebuilding would fire any pending timer through a stale closure and
  // skip the write when the new SWR `currentContent` matches `content`.
  const debouncedSaveRef =
    useRef<ReturnType<typeof debounce<(content: string, filePath: string | undefined) => void>>>(undefined)
  if (!debouncedSaveRef.current) {
    debouncedSaveRef.current = debounce((content: string, filePath: string | undefined) => {
      void saveCurrentNoteRef.current(content, filePath)
    }, 800) // 800ms 防抖延迟
  }
  const invalidateFileContentRef = useRef(invalidateFileContent)

  const handleMarkdownChange = useCallback(
    (newMarkdown: string) => {
      if (contentLoadError) {
        logger.warn('Ignored note edit because current file content failed to load', { activeFilePath })
        toast.error(t('notes.save_blocked_load_failed'))
        return
      }
      // 记录最新内容和文件路径，用于兜底保存
      lastContentRef.current = newMarkdown
      lastFilePathRef.current = activeFilePath
      // A rename owns the active file path until its move/rollback settles.
      // Keep the latest editor value for that session, but never let a new
      // debounce recreate the source path after the file has moved.
      if (isRenamingRef.current && renameSessionFinalPathRef.current) {
        debouncedSaveRef.current?.cancel()
        return
      }
      const isNewNote = activeFilePath && newNotePathsRef.current.has(activeFilePath)
      if (isNewNote) {
        savedNewNoteContentRef.current.set(activeFilePath, newMarkdown)
      }
      if (isNewNote && getInitialNoteTitle(newMarkdown)) {
        if (initialTitleSavePromisesRef.current.has(activeFilePath)) return
        debouncedSaveRef.current?.cancel()
        const savePromise = saveCurrentNoteRef.current(newMarkdown, activeFilePath)
        initialTitleSavePromisesRef.current.set(activeFilePath, savePromise)
        void savePromise.finally(() => {
          if (initialTitleSavePromisesRef.current.get(activeFilePath) === savePromise) {
            initialTitleSavePromisesRef.current.delete(activeFilePath)
          }
        })
        return
      }
      // 捕获当前文件路径，避免在防抖执行时文件路径已改变的竞态条件
      debouncedSaveRef.current?.(newMarkdown, activeFilePath)
    },
    [activeFilePath, contentLoadError, t]
  )

  useEffect(() => {
    activeFilePathRef.current = activeFilePath
  }, [activeFilePath])

  useEffect(() => {
    currentContentRef.current = currentContent
  }, [currentContent])

  useEffect(() => {
    if (activeFilePath && loadedContent !== undefined) {
      persistedContentByPathRef.current.set(activeFilePath, loadedContent)
    }
  }, [activeFilePath, loadedContent])

  useEffect(() => {
    contentLoadErrorRef.current = contentLoadError as Error | undefined
  }, [contentLoadError])

  useEffect(() => {
    if (contentLoadError) {
      logger.error('Failed to load note content:', contentLoadError)
      toast.error(t('notes.load_failed'))
    }
  }, [contentLoadError, t])

  useEffect(() => {
    saveCurrentNoteRef.current = saveCurrentNote
  }, [saveCurrentNote])

  useEffect(() => {
    invalidateFileContentRef.current = invalidateFileContent
  }, [invalidateFileContent])

  useEffect(() => {
    async function initialize() {
      if (!notesPath) {
        // 首次启动，获取默认路径
        const info = await ipcApi.request('app.get_info')
        const defaultPath = info.notesPath
        updateNotesPath(defaultPath)
        return
      }

      // 验证路径是否有效（处理跨平台恢复场景）
      try {
        const resolved = await resolveNotesPath(notesPath)
        if (!resolved.isFallback) {
          return
        }
        const defaultPath = resolved.path

        logger.warn('Invalid notes path detected, resetting to default', {
          previousPath: notesPath,
          defaultPath
        })

        // 重置为默认路径
        updateNotesPath(defaultPath)

        // 检查默认路径下是否有笔记文件
        try {
          const entries = await window.api.file.listDirectory(defaultPath, {
            recursive: false,
            includeFiles: true,
            includeDirectories: true
          })
          if (!entries || entries.length === 0) {
            // 默认目录为空，提示用户需要迁移文件
            toast.warning({
              title: t('notes.crossPlatformRestoreWarning', { path: defaultPath }),
              timeout: 10000
            })
          }
        } catch (error) {
          // 目录不存在或读取失败，会由 FileStorage 自动创建
          logger.debug('Default notes directory will be created', { error })
        }
      } catch (error) {
        logger.error('Failed to validate notes path:', error as Error)
      }
    }

    void initialize()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesPath])

  // 处理树同步时的状态管理
  useEffect(() => {
    if (notesTree.length === 0) return
    // 如果有activeFilePath但找不到对应节点，清空选择
    // 但要排除正在同步树结构、重命名或创建笔记的情况，避免在这些操作中误清空
    const shouldClearPath = activeFilePath && !activeNode && !isRenamingRef.current && !isCreatingNoteRef.current

    if (shouldClearPath) {
      logger.warn('Clearing activeFilePath - node not found in tree', {
        activeFilePath,
        reason: 'Node not found in current tree'
      })
      setActiveFilePath(undefined)
      setActiveDocumentId(undefined)
    }
  }, [notesTree, activeFilePath, activeNode, setActiveFilePath])

  // Clear create/rename suppression once the new node appears in the tree.
  // Replaces a 500ms timer that could race chokidar on slow filesystems
  // (iCloud Drive, NFS, virtualized FS) and silently deselect a fresh note.
  useEffect(() => {
    if (activeNode) {
      activeNodeSnapshotRef.current = activeNode
      const pendingRenamedPath = pendingRenamedActivePathRef.current
      const renamedNodeIsReady =
        isRenamingRef.current &&
        pendingRenamedPath !== undefined &&
        normalizePathValue(activeNode.externalPath) === normalizePathValue(pendingRenamedPath)

      if (renamedNodeIsReady) {
        const finalPath = renameSessionFinalPathRef.current
        const latestContent =
          finalPath && normalizePathValue(lastFilePathRef.current ?? '') === normalizePathValue(finalPath)
            ? lastContentRef.current
            : undefined
        const persistedContent = renameSessionPersistedContentRef.current
        pendingRenamedActivePathRef.current = undefined
        renameSessionFinalPathRef.current = undefined
        renameSessionPersistedContentRef.current = undefined
        isRenamingRef.current = false

        if (finalPath && latestContent !== undefined && latestContent !== persistedContent) {
          void window.api.file
            .write(finalPath, latestContent)
            .then(async () => {
              persistedContentByPathRef.current.set(finalPath, latestContent)
              currentContentRef.current = latestContent
              await primeFileContent(finalPath, latestContent)
            })
            .catch((error) => {
              logger.error('Failed to save note content after tree confirmed rename:', error as Error)
              toast.error(t('notes.save_failed'))
            })
        }
      }
      isCreatingNoteRef.current = false
    }
  }, [activeNode, primeFileContent, t])

  // Active-file content invalidation when the watcher reports a `change`
  // on the file the user is currently viewing — pipes through
  // `useDirectoryTree`'s mutation stream is overkill (it would re-project
  // the entire tree on every keystroke save), so we listen to the same
  // chokidar events via a tiny `File_TreeMutation` side-subscriber instead.
  // The unlink → clear-active-file path is implicit: when the file leaves
  // the tree, the `shouldClearPath` guard above clears `activeFilePath`.
  useEffect(() => {
    if (!notesPath || !treeId) return
    const unsubscribe = window.api.tree.onMutation((payload) => {
      // File_TreeMutation is a shared channel — ignore payloads from other trees.
      if (payload.treeId !== treeId) return
      // Best-effort: any `updated` event for the active file triggers a
      // content-cache invalidation so the renderer re-reads from disk.
      if (payload.event.type !== 'updated') return
      const activePath = activeFilePathRef.current
      if (!activePath) return
      const normalized = normalizePathValue(payload.event.path)
      if (normalizePathValue(activePath) === normalized) {
        if (isRenamingRef.current || initialTitleRenamesRef.current.has(normalized)) return
        invalidateFileContentRef.current?.(normalized)
      }
    })
    return () => {
      unsubscribe()
    }
  }, [notesPath, treeId])

  // Emergency-save the in-flight edit if the page unmounts while the
  // debounced writer hasn't flushed.
  useEffect(() => {
    return () => {
      if (lastContentRef.current && lastFilePathRef.current && lastContentRef.current !== currentContentRef.current) {
        const saveFn = saveCurrentNoteRef.current
        if (saveFn) {
          saveFn(lastContentRef.current, lastFilePathRef.current).catch((error) => {
            logger.error('Emergency save failed:', error as Error)
          })
        }
      }
      debouncedSaveRef.current?.cancel()
    }
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !currentContent) return
    // 获取编辑器当前内容
    const editorMarkdown = editor.getMarkdown()

    // 只有当编辑器内容与期望内容不一致时才更新
    // 这样既能处理初始化，也能处理后续的内容同步，还能避免光标跳动
    if (editorMarkdown !== currentContent) {
      editor.setMarkdown(currentContent)
    }
  }, [currentContent, activeFilePath])

  // Execute pending scroll after file switch
  useEffect(() => {
    if (!pendingScrollRef.current || !currentContent) return

    const { lineNumber, lineContent } = pendingScrollRef.current
    pendingScrollRef.current = null

    // Wait for DOM to update before scrolling
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const codeEditor = codeEditorRef.current
        const richEditor = editorRef.current

        try {
          if (codeEditor?.scrollToLine) {
            codeEditor.scrollToLine(lineNumber, { highlight: true })
          } else if (richEditor?.scrollToLine) {
            richEditor.scrollToLine(lineNumber, { highlight: true, lineContent })
          }
        } catch (error) {
          logger.error('Failed to execute pending scroll:', error as Error)
        }
      })
    })
  }, [activeFilePath, currentContent])

  // 切换文件时的清理工作
  useEffect(() => {
    return () => {
      // 保存之前文件的内容
      if (lastContentRef.current && lastFilePathRef.current) {
        saveCurrentNote(lastContentRef.current, lastFilePathRef.current).catch((error) => {
          logger.error('Emergency save before file switch failed:', error as Error)
        })
      }

      // 取消防抖保存并清理状态
      debouncedSaveRef.current?.cancel()
      lastContentRef.current = ''
      lastFilePathRef.current = undefined
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilePath])

  // 获取目标文件夹路径（选中文件夹或根目录）
  const getTargetFolderPath = useCallback(
    (targetFolderId?: string) => {
      const folderId = targetFolderId || selectedFolderId
      if (folderId) {
        const selectedNode = findNode(notesTree, folderId)
        if (selectedNode && selectedNode.type === 'folder') {
          return selectedNode.externalPath
        }
      }
      return notesPath // 默认返回根目录
    },
    [selectedFolderId, notesTree, notesPath]
  )

  const persistMetadataPatch = useCallback(
    (node: NotesTreeNode, patch: Parameters<typeof patchNode>[1]) => {
      void patchNode(node, patch).catch((error) => {
        logger.error('Failed to persist note patch:', error as Error)
        toast.error(t('notes.metadata_update_failed'))
        void refreshTree().catch((refreshError) => {
          logger.error('Failed to refresh notes tree after metadata patch failure:', refreshError as Error)
        })
      })
    },
    [patchNode, refreshTree, t]
  )

  const getMetadataSnapshot = useCallback((path: string, recursive: boolean): NoteMetadataSnapshot[] => {
    const normalizedPath = normalizePathValue(path)
    const prefix = `${normalizedPath}/`

    return [...noteByPathRef.current.values()]
      .filter((note) => note.path === normalizedPath || (recursive && note.path.startsWith(prefix)))
      .map((note) => ({
        path: note.path,
        isStarred: note.isStarred,
        isExpanded: note.isExpanded
      }))
  }, [])

  const restoreMetadataSnapshot = useCallback(
    async (snapshot: NoteMetadataSnapshot[]) => {
      await Promise.all(
        snapshot.map((note) =>
          patchNode(
            {
              externalPath: note.path,
              type: note.isExpanded ? 'folder' : 'file'
            },
            {
              isStarred: note.isStarred,
              isExpanded: note.isExpanded
            }
          )
        )
      )
    },
    [patchNode]
  )

  const rollbackFileMove = useCallback(async (fromPath: string, toPath: string, nodeType: NotesTreeNode['type']) => {
    if (nodeType === 'folder') {
      await window.api.file.moveDir(fromPath, toPath)
      return
    }
    await window.api.file.move(fromPath, toPath)
  }, [])

  const syncMetadataAfterFileOperation = useCallback(
    async (operation: () => Promise<void>, rollback?: () => Promise<void>) => {
      try {
        await operation()
        return true
      } catch (error) {
        logger.error('Failed to sync note metadata after file operation:', error as Error)
        if (rollback) {
          try {
            await rollback()
          } catch (rollbackError) {
            logger.error('Failed to rollback note file operation after metadata sync failure:', rollbackError as Error)
          }
        }
        toast.error(t('notes.metadata_sync_failed'))
        await refreshTree()
        return false
      }
    },
    [refreshTree, t]
  )

  const setFolderExpandedByPath = useCallback(
    (folderPath: string, expanded: boolean) => {
      const folderNode = findNodeByPath(notesTree, normalizePathValue(folderPath))
      if (folderNode?.type !== 'folder') {
        return
      }

      setNotesTree((prev) => updateTreeNode(prev, folderNode.id, (current) => ({ ...current, expanded })))
      persistMetadataPatch(folderNode, { isExpanded: expanded })
    },
    [notesTree, persistMetadataPatch]
  )

  // 创建文件夹
  const handleCreateFolder = useCallback(
    async (name: string, targetFolderId?: string) => {
      try {
        const targetPath = getTargetFolderPath(targetFolderId)
        if (!targetPath) {
          throw new Error('No folder path selected')
        }
        await addDir(name, targetPath)
        setFolderExpandedByPath(targetPath, true)
        await refreshTree()
      } catch (error) {
        logger.error('Failed to create folder:', error as Error)
        toast.error(t('notes.create_folder_failed'))
      }
    },
    [getTargetFolderPath, refreshTree, setFolderExpandedByPath, t]
  )

  // 创建笔记
  const handleCreateNote = useCallback(
    async (name: string, targetFolderId?: string) => {
      try {
        isCreatingNoteRef.current = true

        const targetPath = getTargetFolderPath(targetFolderId)
        if (!targetPath) {
          throw new Error('No folder path selected')
        }
        const { path: notePath } = await addNote(name, '', targetPath)
        newNotePathsRef.current.add(notePath)
        persistedContentByPathRef.current.set(notePath, '')
        setFolderExpandedByPath(targetPath, true)
        setActiveDocumentId(notePath)
        setActiveFilePath(notePath)
        setSelectedFolderId(null)

        await refreshTree()
        // Success: flag stays true until the watcher reports the new node
        // and the [activeNode] effect above clears it.
      } catch (error) {
        // Write failed → file will never appear → clear the flag now so
        // shouldClearPath isn't permanently suppressed.
        isCreatingNoteRef.current = false
        logger.error('Failed to create note:', error as Error)
        toast.error(t('notes.create_note_failed'))
      }
    },
    [getTargetFolderPath, refreshTree, setActiveFilePath, setFolderExpandedByPath, t]
  )

  const handleToggleExpanded = useCallback(
    (nodeId: string) => {
      const targetNode = findNode(notesTree, nodeId)
      if (!targetNode || targetNode.type !== 'folder') {
        return
      }

      const nextExpanded = !targetNode.expanded
      setNotesTree((prev) => updateTreeNode(prev, nodeId, (current) => ({ ...current, expanded: nextExpanded })))
      persistMetadataPatch(targetNode, { isExpanded: nextExpanded })
    },
    [notesTree, persistMetadataPatch]
  )

  const handleToggleStar = useCallback(
    (nodeId: string) => {
      const node = findNode(notesTree, nodeId)
      if (!node) {
        return
      }

      const nextStarred = !node.isStarred
      setNotesTree((prev) => updateTreeNode(prev, nodeId, (current) => ({ ...current, isStarred: nextStarred })))
      persistMetadataPatch(node, { isStarred: nextStarred })
    },
    [notesTree, persistMetadataPatch]
  )

  const finalizeInitialNoteTitle = useCallback(
    (filePath: string): Promise<boolean> => {
      const pendingFinalize = initialTitleFinalizePromisesRef.current.get(filePath)
      if (pendingFinalize) return pendingFinalize

      const finalizePromise = (async (): Promise<boolean> => {
        const pendingInitialSave = initialTitleSavePromisesRef.current.get(filePath)
        if (pendingInitialSave) await pendingInitialSave
        if (!newNotePathsRef.current.has(filePath)) return true

        const content =
          codeEditorRef.current?.getContent?.() ?? editorRef.current?.getMarkdown?.() ?? currentContentRef.current
        debouncedSaveRef.current?.cancel()
        try {
          await window.api.file.write(filePath, content)
          persistedContentByPathRef.current.set(filePath, content)
          currentContentRef.current = content
          savedNewNoteContentRef.current.set(filePath, content)
          initialTitleFallbackPathsRef.current.add(filePath)
          await applyInitialNoteTitleRef.current(content, filePath, true)
          return true
        } catch (error) {
          logger.error('Failed to finalize initial note title:', error as Error)
          toast.error(t('notes.save_failed'))
          return false
        }
      })()
      initialTitleFinalizePromisesRef.current.set(filePath, finalizePromise)
      void finalizePromise.finally(() => {
        if (initialTitleFinalizePromisesRef.current.get(filePath) === finalizePromise) {
          initialTitleFinalizePromisesRef.current.delete(filePath)
        }
      })
      return finalizePromise
    },
    [t]
  )

  // 选择节点
  const handleSelectNode = useCallback(
    async (node: NotesTreeNode) => {
      if (node.type === 'file') {
        try {
          const currentPath = activeFilePathRef.current
          if (currentPath && currentPath !== node.externalPath && newNotePathsRef.current.has(currentPath)) {
            const finalized = await finalizeInitialNoteTitle(currentPath)
            if (!finalized) return
          }
          setActiveDocumentId(node.id)
          setActiveFilePath(node.externalPath)
          invalidateFileContent(node.externalPath)
          // 清除文件夹选择状态
          setSelectedFolderId(null)
        } catch (error) {
          logger.error('Failed to load note:', error as Error)
        }
      } else if (node.type === 'folder') {
        setSelectedFolderId(node.id)
        handleToggleExpanded(node.id)
      }
    },
    [finalizeInitialNoteTitle, handleToggleExpanded, invalidateFileContent, setActiveFilePath]
  )

  // 删除节点
  const handleDeleteNode = useCallback(
    async (nodeId: string) => {
      try {
        const nodeToDelete = findNode(notesTree, nodeId)
        if (!nodeToDelete) return

        const metadataSnapshot = getMetadataSnapshot(nodeToDelete.externalPath, nodeToDelete.type === 'folder')
        await removePath(nodeToDelete.externalPath, nodeToDelete.type === 'folder')

        try {
          await delNode(nodeToDelete)
        } catch (fileError) {
          await restoreMetadataSnapshot(metadataSnapshot)
          throw fileError
        }

        const normalizedActivePath = activeFilePath ? normalizePathValue(activeFilePath) : undefined
        const normalizedDeletePath = normalizePathValue(nodeToDelete.externalPath)
        const deletedPathPrefix = `${normalizedDeletePath}/`
        for (const newNotePath of newNotePathsRef.current) {
          const normalizedNewNotePath = normalizePathValue(newNotePath)
          if (
            normalizedNewNotePath === normalizedDeletePath ||
            (nodeToDelete.type === 'folder' && normalizedNewNotePath.startsWith(deletedPathPrefix))
          ) {
            newNotePathsRef.current.delete(newNotePath)
            savedNewNoteContentRef.current.delete(newNotePath)
            initialTitleRenamesRef.current.delete(newNotePath)
            initialTitleFallbackPathsRef.current.delete(newNotePath)
            initialTitleSavePromisesRef.current.delete(newNotePath)
            persistedContentByPathRef.current.delete(newNotePath)
          }
        }
        const isActiveNode = normalizedActivePath === normalizedDeletePath
        const isActiveDescendant =
          nodeToDelete.type === 'folder' &&
          normalizedActivePath &&
          normalizedActivePath.startsWith(`${normalizedDeletePath}/`)

        if (isActiveNode || isActiveDescendant) {
          setActiveDocumentId(undefined)
          setActiveFilePath(undefined)
          editorRef.current?.clear()
        }

        await refreshTree()
      } catch (error) {
        logger.error('Failed to delete node:', error as Error)
        if (error instanceof Error && error.message) {
          toast.error(t('notes.delete_failed'))
        }
      }
    },
    [
      activeFilePath,
      getMetadataSnapshot,
      notesTree,
      refreshTree,
      removePath,
      restoreMetadataSnapshot,
      setActiveFilePath,
      t
    ]
  )

  // 重命名节点
  const handleRenameNode = useCallback(
    async (nodeId: string, newName: string, isAutomatic = false) => {
      let activePathInRenameSession: string | undefined
      let actualActivePathAfterRename: string | undefined

      const readLatestSessionContent = () => {
        if (lastFilePathRef.current === activePathInRenameSession) {
          return lastContentRef.current
        }
        return codeEditorRef.current?.getContent?.() ?? editorRef.current?.getMarkdown?.() ?? currentContentRef.current
      }

      const persistLatestSessionContent = async (finalPath: string) => {
        debouncedSaveRef.current?.cancel()
        const content = readLatestSessionContent()
        await window.api.file.write(finalPath, content)
        persistedContentByPathRef.current.set(finalPath, content)
        currentContentRef.current = content
        await primeFileContent(finalPath, content)
        renameSessionFinalPathRef.current = finalPath
        renameSessionPersistedContentRef.current = content
        return content
      }

      try {
        let node = findNode(notesTree, nodeId)
        if (!node) return false

        if (!isAutomatic) {
          const requestedPath = node.externalPath
          newNotePathsRef.current.delete(requestedPath)
          savedNewNoteContentRef.current.delete(requestedPath)
          initialTitleFallbackPathsRef.current.delete(requestedPath)
          initialTitleSavePromisesRef.current.delete(requestedPath)
          const pendingAutomaticRename = initialTitleRenamePromisesRef.current.get(requestedPath)
          if (pendingAutomaticRename) {
            const automaticallyRenamedPath = await pendingAutomaticRename
            if (automaticallyRenamedPath) {
              node = {
                ...node,
                id: automaticallyRenamedPath,
                name: getNoteNameFromPath(automaticallyRenamedPath),
                externalPath: automaticallyRenamedPath
              }
            }
          }
        }

        isRenamingRef.current = true
        pendingRenamedActivePathRef.current = undefined
        renameSessionFinalPathRef.current = undefined
        renameSessionPersistedContentRef.current = undefined

        if (node.name === newName) {
          isRenamingRef.current = false
          return true
        }

        const oldPath = node.externalPath
        const currentActivePath = activeFilePathRef.current
        if (activeNode) {
          activeNodeSnapshotRef.current = activeNode
        }

        let nextActivePath: string | undefined
        let latestContent: string | undefined

        if (node.type === 'file' && currentActivePath === oldPath) {
          activePathInRenameSession = currentActivePath
          actualActivePathAfterRename = currentActivePath
          renameSessionFinalPathRef.current = currentActivePath
          debouncedSaveRef.current?.cancel()
          latestContent =
            codeEditorRef.current?.getContent?.() ?? editorRef.current?.getMarkdown?.() ?? currentContentRef.current
        } else if (node.type === 'folder' && currentActivePath && currentActivePath.startsWith(`${oldPath}/`)) {
          activePathInRenameSession = currentActivePath
          actualActivePathAfterRename = currentActivePath
          renameSessionFinalPathRef.current = currentActivePath
          debouncedSaveRef.current?.cancel()
          latestContent =
            codeEditorRef.current?.getContent?.() ?? editorRef.current?.getMarkdown?.() ?? currentContentRef.current
        }

        if (currentActivePath && latestContent !== undefined && latestContent !== currentContentRef.current) {
          await window.api.file.write(currentActivePath, latestContent)
          persistedContentByPathRef.current.set(currentActivePath, latestContent)
          currentContentRef.current = latestContent
        }

        const renamed = await renameEntry(node, newName)

        if (node.type === 'file' && currentActivePath === oldPath) {
          nextActivePath = renamed.path
        } else if (node.type === 'folder' && currentActivePath && currentActivePath.startsWith(`${oldPath}/`)) {
          const suffix = currentActivePath.slice(oldPath.length)
          nextActivePath = `${renamed.path}${suffix}`
        }
        pendingRenamedActivePathRef.current = nextActivePath
        actualActivePathAfterRename = nextActivePath ?? actualActivePathAfterRename
        renameSessionFinalPathRef.current = nextActivePath ?? renameSessionFinalPathRef.current

        let rollbackSucceeded = false
        const metadataSynced = await syncMetadataAfterFileOperation(
          () => rewritePath(oldPath, renamed.path, node.type === 'folder'),
          async () => {
            await rollbackFileMove(renamed.path, oldPath, node.type)
            rollbackSucceeded = true
          }
        )
        if (!metadataSynced) {
          if (nextActivePath && currentActivePath) {
            if (rollbackSucceeded) {
              actualActivePathAfterRename = currentActivePath
              await persistLatestSessionContent(currentActivePath)
              // The file is back on its original path, but the watcher may
              // still be between the remove and re-add events. Keep the
              // snapshot until the old active node is visible again.
              pendingRenamedActivePathRef.current = currentActivePath
            } else {
              // Rollback failed, so the file remains at the renamed path.
              // Follow the actual file to keep the editor usable even though
              // metadata repair will still be needed.
              await persistLatestSessionContent(nextActivePath)
              activeFilePathRef.current = nextActivePath
              setActiveFilePath(nextActivePath)
            }
          } else {
            pendingRenamedActivePathRef.current = undefined
            renameSessionFinalPathRef.current = undefined
            renameSessionPersistedContentRef.current = undefined
            isRenamingRef.current = false
          }
          return false
        }

        // Update the tree mirror only after the file move and metadata
        // rewrite have both committed. This keeps rollback on the old path
        // and avoids a long-lived tree/active-path mismatch.
        if (treeId) {
          await window.api.tree
            .rename(treeId, oldPath, renamed.path)
            .catch((err) => logger.warn('Failed to notify tree of rename', err as Error))
        }

        newNotePathsRef.current.delete(oldPath)
        savedNewNoteContentRef.current.delete(oldPath)
        initialTitleFallbackPathsRef.current.delete(oldPath)
        initialTitleSavePromisesRef.current.delete(oldPath)
        const persistedContent = persistedContentByPathRef.current.get(oldPath)
        persistedContentByPathRef.current.delete(oldPath)
        if (persistedContent !== undefined) {
          persistedContentByPathRef.current.set(renamed.path, persistedContent)
        }

        if (nextActivePath) {
          await persistLatestSessionContent(nextActivePath)
          lastFilePathRef.current = nextActivePath
          activeFilePathRef.current = nextActivePath
          setActiveFilePath(nextActivePath)
        }

        await refreshTree()
        if (!nextActivePath) {
          renameSessionFinalPathRef.current = undefined
          renameSessionPersistedContentRef.current = undefined
          isRenamingRef.current = false
        }
        // Success: flag stays true until the watcher reports the renamed
        // node and the [activeNode] effect above clears it.
        return true
      } catch (error) {
        if (activePathInRenameSession && actualActivePathAfterRename) {
          await persistLatestSessionContent(actualActivePathAfterRename).catch((saveError) =>
            logger.error('Failed to save note content after rename failure:', saveError as Error)
          )
        }
        // Rename failed → clear the flag now so subsequent tree updates
        // aren't suppressed.
        pendingRenamedActivePathRef.current = undefined
        renameSessionFinalPathRef.current = undefined
        renameSessionPersistedContentRef.current = undefined
        isRenamingRef.current = false
        logger.error('Failed to rename node:', error as Error)
        toast.error(
          error instanceof Error && error.message.startsWith('Target name already exists')
            ? t('notes.target_name_exists')
            : t('notes.rename_failed')
        )
        return false
      }
    },
    [
      activeNode,
      notesTree,
      primeFileContent,
      refreshTree,
      rewritePath,
      rollbackFileMove,
      setActiveFilePath,
      syncMetadataAfterFileOperation,
      t,
      treeId
    ]
  )

  const applyInitialNoteTitle = useCallback(
    (content: string, filePath: string, allowIncompleteFirstLine = false): Promise<void> => {
      if (!newNotePathsRef.current.has(filePath)) return Promise.resolve()
      const pendingRename = initialTitleRenamePromisesRef.current.get(filePath)
      if (pendingRename) return pendingRename.then(() => undefined)

      const title = getInitialNoteTitle(content, allowIncompleteFirstLine)
      if (!title) return Promise.resolve()

      const node = findNodeByPath(notesTree, normalizePathValue(filePath))
      if (!node || node.type !== 'file') return Promise.resolve()
      if (node.name === title) {
        newNotePathsRef.current.delete(filePath)
        savedNewNoteContentRef.current.delete(filePath)
        initialTitleFallbackPathsRef.current.delete(filePath)
        return Promise.resolve()
      }

      const renamePromise = (async (): Promise<string | undefined> => {
        initialTitleRenamesRef.current.add(filePath)
        try {
          const renamed = await handleRenameNode(node.id, title, true)
          if (!renamed) {
            newNotePathsRef.current.delete(filePath)
            savedNewNoteContentRef.current.delete(filePath)
            initialTitleFallbackPathsRef.current.delete(filePath)
            initialTitleSavePromisesRef.current.delete(filePath)
            return undefined
          }
          return activeFilePathRef.current
        } finally {
          initialTitleRenamesRef.current.delete(filePath)
          initialTitleRenamePromisesRef.current.delete(filePath)
          const latestContent = savedNewNoteContentRef.current.get(filePath)
          if (latestContent !== undefined && latestContent !== content) {
            void applyInitialNoteTitleRef.current(latestContent, filePath, allowIncompleteFirstLine)
          }
        }
      })()
      initialTitleRenamePromisesRef.current.set(filePath, renamePromise)
      return renamePromise.then(() => undefined)
    },
    [handleRenameNode, notesTree]
  )

  const handleEditorBlur = useCallback(() => {
    const filePath = activeFilePathRef.current
    if (!filePath || !newNotePathsRef.current.has(filePath)) return
    void finalizeInitialNoteTitle(filePath)
  }, [finalizeInitialNoteTitle])

  useEffect(() => {
    applyInitialNoteTitleRef.current = applyInitialNoteTitle
    savedNewNoteContentRef.current.forEach((content, filePath) => {
      void applyInitialNoteTitle(content, filePath, initialTitleFallbackPathsRef.current.has(filePath))
    })
  }, [applyInitialNoteTitle])

  // 处理文件上传
  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      try {
        if (!files || files.length === 0) {
          toast.warning(t('notes.no_file_selected'))
          return
        }

        const targetFolderPath = getTargetFolderPath()
        if (!targetFolderPath) {
          throw new Error('No folder path selected')
        }

        // Validate uploadNotes function is available
        if (typeof uploadNotes !== 'function') {
          logger.error('uploadNotes function is not available', { uploadNotes })
          toast.error(t('notes.upload_failed'))
          return
        }

        let result: Awaited<ReturnType<typeof uploadNotes>>
        try {
          result = await uploadNotes(files, targetFolderPath)
        } catch (uploadError) {
          logger.error('Upload operation failed:', uploadError as Error)
          throw uploadError
        }

        // Validate result object
        if (!result || typeof result !== 'object') {
          logger.error('Invalid upload result:', { result })
          toast.error(t('notes.upload_failed'))
          return
        }

        // 检查上传结果
        if (result.fileCount === 0) {
          if (result.failedFiles > 0) {
            toast.error(t('notes.upload_all_failed', { failed: result.failedFiles }))
            return
          }
          toast.warning(t('notes.no_valid_files'))
          return
        }

        // 排序并显示上传结果
        setFolderExpandedByPath(targetFolderPath, true)
        await refreshTree()

        if (result.failedFiles > 0) {
          toast.warning(t('notes.upload_partial_failed', { uploaded: result.fileCount, failed: result.failedFiles }))
          return
        }

        toast.success(t('notes.upload_success'))
      } catch (error) {
        logger.error('Failed to handle file upload:', error as Error)
        toast.error(t('notes.upload_failed'))
      }
    },
    [getTargetFolderPath, refreshTree, setFolderExpandedByPath, t]
  )

  // 处理节点移动
  const handleMoveNode = useCallback(
    async (sourceNodeId: string, targetNodeId: string, position: 'before' | 'after' | 'inside') => {
      if (!notesPath) {
        return
      }

      try {
        const sourceNode = findNode(notesTree, sourceNodeId)
        const targetNode = findNode(notesTree, targetNodeId)

        if (!sourceNode || !targetNode) {
          return
        }

        if (position === 'inside' && targetNode.type !== 'folder') {
          return
        }

        const rootPath = normalizePathValue(notesPath)
        const sourceParentNode = findParent(notesTree, sourceNodeId)
        const targetParentNode = position === 'inside' ? targetNode : findParent(notesTree, targetNodeId)

        const sourceParentPath = sourceParentNode ? sourceParentNode.externalPath : rootPath
        const targetParentPath =
          position === 'inside' ? targetNode.externalPath : targetParentNode ? targetParentNode.externalPath : rootPath

        const normalizedSourceParent = normalizePathValue(sourceParentPath)
        const normalizedTargetParent = normalizePathValue(targetParentPath)

        const isManualReorder = position !== 'inside' && normalizedSourceParent === normalizedTargetParent

        if (isManualReorder) {
          // For manual reordering within the same parent, we can optimize by only updating the affected parent
          setNotesTree((prev) =>
            reorderTreeNodes(prev, sourceNodeId, targetNodeId, position === 'before' ? 'before' : 'after')
          )
          return
        }

        const { safeName } = await window.api.file.checkFileName(
          normalizedTargetParent,
          sourceNode.name,
          sourceNode.type === 'file'
        )

        const destinationPath =
          sourceNode.type === 'file'
            ? `${normalizedTargetParent}/${safeName}.md`
            : `${normalizedTargetParent}/${safeName}`

        if (destinationPath === sourceNode.externalPath) {
          return
        }

        if (sourceNode.type === 'file') {
          await window.api.file.move(sourceNode.externalPath, destinationPath)
        } else {
          await window.api.file.moveDir(sourceNode.externalPath, destinationPath)
        }

        const metadataSynced = await syncMetadataAfterFileOperation(
          () => rewritePath(sourceNode.externalPath, destinationPath, sourceNode.type === 'folder'),
          () => rollbackFileMove(destinationPath, sourceNode.externalPath, sourceNode.type)
        )
        if (!metadataSynced) {
          return
        }
        setFolderExpandedByPath(normalizedTargetParent, true)

        const normalizedActivePath = activeFilePath ? normalizePathValue(activeFilePath) : undefined
        let nextActivePath: string | undefined
        if (normalizedActivePath) {
          if (normalizedActivePath === sourceNode.externalPath) {
            // Cancel debounced save to prevent saving to old path
            debouncedSaveRef.current?.cancel()
            nextActivePath = destinationPath
          } else if (sourceNode.type === 'folder' && normalizedActivePath.startsWith(`${sourceNode.externalPath}/`)) {
            const suffix = normalizedActivePath.slice(sourceNode.externalPath.length)
            // Cancel debounced save to prevent saving to old path
            debouncedSaveRef.current?.cancel()
            nextActivePath = `${destinationPath}${suffix}`
          }
        }

        if (nextActivePath) {
          lastFilePathRef.current = nextActivePath
          setActiveFilePath(nextActivePath)
        }

        await refreshTree()
      } catch (error) {
        logger.error('Failed to move nodes:', error as Error)
        toast.error(t('notes.move_failed'))
      }
    },
    [
      activeFilePath,
      notesPath,
      notesTree,
      refreshTree,
      rewritePath,
      rollbackFileMove,
      setActiveFilePath,
      setFolderExpandedByPath,
      syncMetadataAfterFileOperation,
      t
    ]
  )

  // 处理节点排序
  const handleSortNodes = useCallback(
    async (newSortType: NotesSortType) => {
      updateSortType(newSortType)
      setNotesTree((prev) => mergeTreeState(sortTree(prev, newSortType)))
    },
    [mergeTreeState, updateSortType]
  )

  const handleExpandPath = useCallback(
    (treePath: string) => {
      if (!treePath) {
        return
      }

      const segments = treePath.split('/').filter(Boolean)
      if (segments.length === 0) {
        return
      }

      let nextTree = notesTree
      const pathsToAdd: string[] = []

      segments.forEach((_, index) => {
        const currentPath = '/' + segments.slice(0, index + 1).join('/')
        const node = findNodeByPath(nextTree, currentPath)
        if (node && node.type === 'folder' && !node.expanded) {
          pathsToAdd.push(node.externalPath)
          nextTree = updateTreeNode(nextTree, node.id, (current) => ({ ...current, expanded: true }))
        }
      })

      if (pathsToAdd.length > 0) {
        setNotesTree(nextTree)
        pathsToAdd.forEach((path) => {
          const node = findNodeByPath(notesTree, path)
          if (node?.type === 'folder') {
            persistMetadataPatch(node, { isExpanded: true })
          }
        })
      }
    },
    [notesTree, persistMetadataPatch]
  )

  const getCurrentNoteContent = useCallback(() => {
    const sourceContent = codeEditorRef.current?.getContent?.()
    if (sourceContent !== undefined) {
      return sourceContent
    }

    const richContent = editorRef.current?.getMarkdown?.()
    return richContent ?? currentContent
  }, [currentContent])

  // Listen for external requests to locate a specific line in a note
  useEffect(() => {
    const handleLocateNoteLine = ({
      noteId,
      lineNumber,
      lineContent
    }: {
      noteId: string
      lineNumber: number
      lineContent?: string
    }) => {
      const targetNode = findNode(notesTree, noteId)

      if (!targetNode || targetNode.type !== 'file') {
        logger.warn('Target note not found or not a file', { noteId })
        return
      }

      const needsSwitchFile = targetNode.externalPath !== activeFilePath

      if (needsSwitchFile) {
        // switch to target note first then scroll to line
        pendingScrollRef.current = { lineNumber, lineContent }
        setActiveDocumentId(targetNode.id)
        setActiveFilePath(targetNode.externalPath)
        invalidateFileContent(targetNode.externalPath)
      } else {
        const richEditor = editorRef.current
        const codeEditor = codeEditorRef.current

        try {
          if (codeEditor?.scrollToLine) {
            codeEditor.scrollToLine(lineNumber, { highlight: true })
          } else if (richEditor?.scrollToLine) {
            richEditor.scrollToLine(lineNumber, { highlight: true, lineContent })
          }
        } catch (error) {
          logger.error('Failed to scroll to line:', error as Error)
        }
      }
    }

    const unsubscribe = EventEmitter.on(EVENT_NAMES.LOCATE_NOTE_LINE, handleLocateNoteLine)
    return () => {
      unsubscribe()
    }
  }, [activeNode?.id, activeFilePath, notesTree, invalidateFileContent, setActiveFilePath])

  return (
    <div id="notes-page" className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div id="content-container" className="flex h-full min-h-0 flex-1 flex-row overflow-hidden">
        <AnimatePresence initial={false}>
          {showWorkspace && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 250, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              style={{ height: '100%', overflow: 'hidden', flexShrink: 0 }}>
              <NotesSidebar
                notesTree={notesTree}
                activeFilePath={activeFilePath}
                sortType={sortType}
                selectedFolderId={selectedFolderId}
                onSelectNode={handleSelectNode}
                onCreateFolder={handleCreateFolder}
                onCreateNote={handleCreateNote}
                onDeleteNode={handleDeleteNode}
                onRenameNode={handleRenameNode}
                onToggleExpanded={handleToggleExpanded}
                onToggleStar={handleToggleStar}
                onMoveNode={handleMoveNode}
                onSortNodes={handleSortNodes}
                onUploadFiles={handleUploadFiles}
              />
            </motion.div>
          )}
        </AnimatePresence>
        <div className="relative flex min-h-0 min-w-0 max-w-full flex-1 flex-col justify-between overflow-hidden">
          <HeaderNavbar
            notesTree={notesTree}
            activeFilePath={activeFilePath}
            activeNodeOverride={displayedActiveNode ?? undefined}
            getCurrentNoteContent={getCurrentNoteContent}
            onToggleStar={handleToggleStar}
            onExpandPath={handleExpandPath}
            onRenameNode={handleRenameNode}
          />
          <NotesEditor
            activeNodeId={displayedActiveNode?.id}
            documentId={activeDocumentId}
            currentContent={currentContent}
            contentLoadError={contentLoadError as Error | undefined}
            tokenCount={tokenCount}
            onMarkdownChange={handleMarkdownChange}
            onBlur={handleEditorBlur}
            editorRef={editorRef}
            codeEditorRef={codeEditorRef}
          />
        </div>
      </div>
    </div>
  )
}

export default NotesPage
