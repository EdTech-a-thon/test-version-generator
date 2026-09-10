import { useEffect, useState } from 'react'
import { Upload } from 'lucide-react'

/**
 * Dropping a Question Bank File anywhere on the site imports it.
 *
 * The listeners are on the window in the capture phase, so a Question Bank
 * File dropped over the editor is taken before Milkdown sees it. Everything
 * else — a pasted image dragged into a question, an internal authoring drag —
 * is left strictly alone: nothing is intercepted unless the pointer is
 * carrying a file this app can actually import.
 */

const IMPORTABLE_TYPES = new Set(['application/pdf', 'application/json'])

function importable(file: File): boolean {
  return IMPORTABLE_TYPES.has(file.type) || /\.(pdf|json)$/i.test(file.name)
}

/** Read from a `dragover`, where the files themselves are not yet readable and
 *  only the declared item types are. A file whose type the OS did not declare
 *  is not claimed, so an unrelated drag keeps its normal behaviour. */
function carriesImportableFile(transfer: DataTransfer | null): boolean {
  if (!transfer) return false
  if (!Array.from(transfer.types).includes('Files')) return false
  return Array.from(transfer.items).some(
    (item) => item.kind === 'file' && IMPORTABLE_TYPES.has(item.type),
  )
}

export function BankFileDropTarget({ onFile }: { onFile: (file: File) => void }) {
  const [over, setOver] = useState(false)
  useEffect(() => {
    const claim = (event: DragEvent) => {
      if (!carriesImportableFile(event.dataTransfer)) return false
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      return true
    }
    const onDragOver = (event: DragEvent) => {
      if (claim(event)) setOver(true)
    }
    const onDragLeave = (event: DragEvent) => {
      // Only the drag actually leaving the window clears the overlay; moving
      // between elements inside it fires `dragleave` constantly.
      if (event.relatedTarget === null) setOver(false)
    }
    const onDrop = (event: DragEvent) => {
      if (!claim(event)) {
        setOver(false)
        return
      }
      setOver(false)
      const file = Array.from(event.dataTransfer?.files ?? []).find(importable)
      if (file) onFile(file)
    }
    const onDragEnd = () => setOver(false)
    window.addEventListener('dragover', onDragOver, true)
    window.addEventListener('dragleave', onDragLeave, true)
    window.addEventListener('drop', onDrop, true)
    window.addEventListener('dragend', onDragEnd, true)
    return () => {
      window.removeEventListener('dragover', onDragOver, true)
      window.removeEventListener('dragleave', onDragLeave, true)
      window.removeEventListener('drop', onDrop, true)
      window.removeEventListener('dragend', onDragEnd, true)
    }
  }, [onFile])
  if (!over) return null
  return (
    <div className="bank-drop-overlay" role="presentation">
      <div className="bank-drop-card">
        <Upload aria-hidden="true" />
        <strong>Drop to import a Question Bank</strong>
        <span>A Question Bank PDF or JSON file</span>
      </div>
    </div>
  )
}
