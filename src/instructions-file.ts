/**
 * The instructions go to an AI as a file, not a paste: at over 45,000
 * characters they are longer than some chat boxes take — Gemini's keeps the
 * first 32,000 and drops the rest without saying so, image tag list and all —
 * while every assistant reads an attached text file whole.
 */

/** What the instructions file is called: after the test it converts, when
 *  there is one, so a teacher with two imports waiting can tell them apart. */
export function instructionsFilename(sourceName?: string): string {
  const stem = sourceName?.replace(/\.(pdf|docx|png|jpe?g)$/i, '').trim()
  return stem ? `${stem} (instructions).txt` : 'Test Parrot instructions.txt'
}

/** The message to send with the attachments, since some assistants will not
 *  send attachments alone. It is copied as the AI opens, ready to paste. */
export const INSTRUCTIONS_NOTE =
  'Follow the attached Test Parrot instructions to convert my attached test into the .parrot.json file they describe.'

/** Saves the instructions as a text file in the browser's downloads. */
export function downloadInstructions(instructions: string, sourceName?: string): void {
  const url = URL.createObjectURL(new Blob([instructions], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = instructionsFilename(sourceName)
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
