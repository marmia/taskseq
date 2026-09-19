declare module "@dragdroptouch/drag-drop-touch" {
  type DragDropTouchOptions = {
    forceListen?: boolean;
  };

  export function enableDragDropTouch(
    dragRoot?: Document | HTMLElement,
    dropRoot?: Document | HTMLElement,
    options?: DragDropTouchOptions,
  ): void;
}
