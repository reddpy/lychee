import { createContext, useContext } from "react";

type NoteContextValue = {
  documentId: string;
  title: string;
};

export const NoteContext = createContext<NoteContextValue | null>(null);

export function useNoteContext(): NoteContextValue {
  const ctx = useContext(NoteContext);
  if (!ctx) throw new Error("useNoteContext must be used inside NoteContext.Provider");
  return ctx;
}
