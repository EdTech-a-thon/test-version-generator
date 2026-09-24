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
 *
 * A drop over an element marked `data-import-bank-id` — a Question Bank's
 * page, or the editor's open bank — names that bank, so the import defaults
 * to adding into it. The overlay lets the pointer through so the element under
 * it can be read.
 */

/** Where a drop lands: the bank marked under the pointer, if any. */
function bankUnder(target: EventTarget | null): { id: string; name: string } | null {
  const element = target instanceof Element ? target.closest<HTMLElement>('[data-import-bank-id]') : null
  const id = element?.dataset.importBankId
  return id ? { id, name: element.dataset.importBankName ?? '' } : null
}

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

export function BankFileDropTarget({
  onFile,
}: {
  onFile: (file: File, targetBankId?: string) => void
}) {
  const [over, setOver] = useState(false)
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null)
  useEffect(() => {
    const claim = (event: DragEvent) => {
      if (!carriesImportableFile(event.dataTransfer)) return false
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      return true
    }
    const onDragOver = (event: DragEvent) => {
      if (!claim(event)) return
      setOver(true)
      const next = bankUnder(event.target)
      setTarget((current) => current?.id === next?.id && current?.name === next?.name ? current : next)
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
      if (file) onFile(file, bankUnder(event.target)?.id)
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
        {target ? <>
          <strong>Drop to add to {target.name || 'this Question Bank'}</strong>
          <span>Its Questions are added to this bank, and any Exams come too</span>
        </> : <>
          <strong>Drop to import a Question Bank</strong>
          <span>A Question Bank or Exam PDF, or a JSON file</span>
        </>}
      </div>
    </div>
  )
}
