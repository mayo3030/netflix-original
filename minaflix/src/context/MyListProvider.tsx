import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadStore, newFolderId, pruneStore, saveStore, toSaved, type Folder, type ListStore, type SavedItem } from '../storage/myList';
import type { Title } from '../types';

type MyListValue = {
  folders: Folder[];
  items: Record<string, SavedItem>;
  isSaved: (id: string) => boolean;
  foldersFor: (id: string) => string[];
  toggleSaved: (title: Title) => void;
  setInFolder: (title: Title, folderId: string, present: boolean) => void;
  createFolder: (name: string) => string | null;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
};

const MyListContext = createContext<MyListValue | null>(null);

function ensureWatchLater(folders: Folder[]): Folder[] {
  if (folders.some((folder) => folder.id === 'watch-later')) return folders;
  return [{ id: 'watch-later', name: 'Watch later', nameAr: 'للمشاهدة لاحقاً', custom: false, itemIds: [] }, ...folders];
}

export function MyListProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<ListStore>(() => loadStore());

  useEffect(() => {
    saveStore(store);
  }, [store]);

  const toggleSaved = useCallback((title: Title) => {
    setStore((prev) => {
      const saved = prev.folders.some((folder) => folder.itemIds.includes(title.id));
      if (saved) {
        return pruneStore({
          version: 1,
          folders: prev.folders.map((folder) => ({
            ...folder,
            itemIds: folder.itemIds.filter((id) => id !== title.id),
          })),
          items: prev.items,
        });
      }
      const folders = ensureWatchLater(prev.folders).map((folder) => (
        folder.id === 'watch-later' && !folder.itemIds.includes(title.id)
          ? { ...folder, itemIds: [title.id, ...folder.itemIds] }
          : folder
      ));
      return pruneStore({
        version: 1,
        folders,
        items: { ...prev.items, [title.id]: toSaved(title) },
      });
    });
  }, []);

  const setInFolder = useCallback((title: Title, folderId: string, present: boolean) => {
    setStore((prev) => {
      const folders = prev.folders.map((folder) => {
        if (folder.id !== folderId) return folder;
        const has = folder.itemIds.includes(title.id);
        if (present && !has) return { ...folder, itemIds: [title.id, ...folder.itemIds] };
        if (!present && has) return { ...folder, itemIds: folder.itemIds.filter((id) => id !== title.id) };
        return folder;
      });
      return pruneStore({
        version: 1,
        folders,
        items: { ...prev.items, [title.id]: toSaved(title) },
      });
    });
  }, []);

  const createFolder = useCallback((name: string) => {
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed) return null;
    const id = newFolderId();
    setStore((prev) => ({
      ...prev,
      folders: [...prev.folders, { id, name: trimmed, nameAr: trimmed, custom: true, itemIds: [] }],
    }));
    return id;
  }, []);

  const renameFolder = useCallback((id: string, name: string) => {
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed) return;
    setStore((prev) => ({
      ...prev,
      folders: prev.folders.map((folder) => (
        folder.id === id ? { ...folder, name: trimmed, nameAr: trimmed, custom: true } : folder
      )),
    }));
  }, []);

  const deleteFolder = useCallback((id: string) => {
    setStore((prev) => pruneStore({
      ...prev,
      folders: prev.folders.filter((folder) => folder.id !== id),
    }));
  }, []);

  const savedIds = useMemo(() => new Set(store.folders.flatMap((folder) => folder.itemIds)), [store.folders]);

  const isSaved = useCallback((id: string) => savedIds.has(id), [savedIds]);

  const foldersFor = useCallback((id: string) => (
    store.folders.filter((folder) => folder.itemIds.includes(id)).map((folder) => folder.id)
  ), [store.folders]);

  const value = useMemo<MyListValue>(() => ({
    folders: store.folders,
    items: store.items,
    isSaved,
    foldersFor,
    toggleSaved,
    setInFolder,
    createFolder,
    renameFolder,
    deleteFolder,
  }), [store.folders, store.items, isSaved, foldersFor, toggleSaved, setInFolder, createFolder, renameFolder, deleteFolder]);

  return <MyListContext.Provider value={value}>{children}</MyListContext.Provider>;
}

export function useMyList(): MyListValue {
  const value = useContext(MyListContext);
  if (!value) throw new Error('useMyList must be used within MyListProvider');
  return value;
}
