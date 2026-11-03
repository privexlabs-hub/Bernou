/** Props that make an element accept dropped files. */
export function useFileDrop(onFiles: (files: FileList) => void) {
  return {
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer.files.length > 0) onFiles(e.dataTransfer.files);
    },
  };
}
