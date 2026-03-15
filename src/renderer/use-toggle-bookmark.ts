import { useCallback } from 'react';
import { useDocumentStore } from './document-store';

/**
 * Returns { isBookmarked, toggleBookmark } for a given document ID.
 * Shared between the toolbar bookmark button and the context/dropdown menus.
 */
export function useToggleBookmark(docId: string) {
  // Select only the primitive boolean — avoids re-renders when unrelated doc fields change
  const isBookmarked = useDocumentStore(
    (s) => !!s.documents.find((d) => d.id === docId)?.metadata?.bookmarkedAt,
  );
  const updateDocumentInStore = useDocumentStore((s) => s.updateDocumentInStore);

  const toggleBookmark = useCallback(() => {
    const doc = useDocumentStore.getState().documents.find((d) => d.id === docId);
    if (!doc) return;
    const oldMetadata = doc.metadata;
    const newBookmarkedAt = isBookmarked ? null : new Date().toISOString();
    const newMetadata = { ...oldMetadata, bookmarkedAt: newBookmarkedAt };
    updateDocumentInStore(docId, { metadata: newMetadata });
    window.lychee
      .invoke('documents.update', {
        id: docId,
        metadata: { bookmarkedAt: newBookmarkedAt },
      })
      .catch(() => {
        updateDocumentInStore(docId, { metadata: oldMetadata });
      });
  }, [docId, isBookmarked, updateDocumentInStore]);

  return { isBookmarked, toggleBookmark };
}
