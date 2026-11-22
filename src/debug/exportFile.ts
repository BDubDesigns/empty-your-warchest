export type ExportResult = 'shared' | 'downloaded' | 'cancelled';

/** Opens the phone's share sheet for the file (Save to Files, Drive, etc.). */
export async function shareFile(file: File): Promise<ExportResult> {
  try {
    await navigator.share({ files: [file], title: file.name });
    return 'shared';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    throw error;
  }
}

export function canShareFile(file: File): boolean {
  return 'canShare' in navigator && navigator.canShare({ files: [file] });
}

/** Saves the file through the browser's normal download. */
export function downloadFile(file: File): ExportResult {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
  return 'downloaded';
}
