import * as React from 'react';
import { Reorder, useDragControls } from 'framer-motion';

import type { SidebarSectionId } from '../../renderer/sidebar-section-order';
import { cn } from '../../lib/utils';

export type SidebarSectionDndProps = {
  id: SidebarSectionId;
  isReordering: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  children: React.ReactNode;
};

export function SidebarSectionDnd({
  id,
  isReordering,
  onDragStart,
  onDragEnd,
  children,
}: SidebarSectionDndProps) {
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const dragControls = useDragControls();
  const didDragRef = React.useRef(false);
  const [isDragging, setIsDragging] = React.useState(false);

  React.useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const handle = wrapper.querySelector<HTMLElement>('[data-section-handle="true"]');
    if (!handle) return;

    const onPointerDown = (e: PointerEvent) => {
      didDragRef.current = false;
      dragControls.start(e);
    };
    // Suppress the synthetic click that fires after a drag-release on the handle.
    const onClickCapture = (e: MouseEvent) => {
      if (didDragRef.current) {
        e.stopPropagation();
        e.preventDefault();
        didDragRef.current = false;
      }
    };
    handle.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('click', onClickCapture, true);
    return () => {
      handle.removeEventListener('pointerdown', onPointerDown);
      handle.removeEventListener('click', onClickCapture, true);
    };
  }, [dragControls]);

  return (
    <Reorder.Item
      as="div"
      ref={wrapperRef}
      value={id}
      layout="position"
      transition={{ layout: { duration: isReordering ? 0.25 : 0 } }}
      dragListener={false}
      dragControls={dragControls}
      onDragStart={() => {
        didDragRef.current = true;
        setIsDragging(true);
        onDragStart();
      }}
      onDragEnd={() => {
        setIsDragging(false);
        onDragEnd();
      }}
      className={cn(
        'relative flex flex-col',
        isDragging && 'z-10 opacity-60',
      )}
      data-section-id={id}
    >
      {children}
    </Reorder.Item>
  );
}
