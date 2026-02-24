import * as React from 'react';
import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../ui/popover';
import { useThemeStore } from '../../renderer/theme-store';

type EmojiSelectPayload = {
  native: string;
  id?: string;
  shortcodes?: string;
  unified?: string;
};

export type NoteEmojiPickerProps = {
  docId: string;
  currentEmoji: string | null;
  onSelect: (native: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactNode;
};

export function NoteEmojiPicker({
  docId,
  currentEmoji,
  onSelect,
  open,
  onOpenChange,
  trigger,
}: NoteEmojiPickerProps) {
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);

  const handleEmojiSelect = React.useCallback(
    (payload: EmojiSelectPayload) => {
      if (payload?.native) {
        onSelect(payload.native);
        onOpenChange(false);
      }
    },
    [onSelect, onOpenChange],
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        className="w-auto max-w-[352px] p-0 border-0"
        align="start"
        side="right"
        sideOffset={8}
        onClick={(e) => e.stopPropagation()}
      >
        <Picker
          data={data}
          onEmojiSelect={handleEmojiSelect}
          theme={resolvedTheme}
          previewPosition="none"
          skinTonePosition="none"
          perLine={8}
          emojiSize={24}
          emojiButtonSize={36}
        />
      </PopoverContent>
    </Popover>
  );
}
