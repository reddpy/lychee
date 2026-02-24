import type { LucideIcon } from "lucide-react";
import { FileText } from "lucide-react";

export type AIAction = {
  id: string;
  label: string;
  icon: LucideIcon;
  systemPrompt: string;
  /** Build the user message from the note text. */
  buildUserMessage: (noteText: string) => string;
};

export const AI_ACTIONS: AIAction[] = [
  {
    id: "summarize",
    label: "Summarize",
    icon: FileText,
    systemPrompt:
      "You are a note summarizing assistant. You will be reading the note and then providing information that reads in between the lines that require not further inference. Just output only key points and make it short and concise. The output shouldn't be longer than the actual note. Use markdown formatting.",
    buildUserMessage: (noteText) => `Please analyze this note:\n\n${noteText}`,
  },
  // Future actions go here:
  // { id: 'keyPoints', ... }
  // { id: 'explain', ... }
];
