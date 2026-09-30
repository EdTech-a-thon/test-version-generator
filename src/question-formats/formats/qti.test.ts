import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { inspectImportValue } from '../../package-import'
import { readQuestionFile } from '..'
import { blocksText } from '../rich-text'

const fixtures = fileURLToPath(new URL('../fixtures/qti/', import.meta.url))
const fixture = (path: string) => new Uint8Array(readFileSync(join(fixtures, path)))
const encode = (text: string) => new TextEncoder().encode(text)
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (character) => character.charCodeAt(0),
)

/** A file read, then checked by the import every Test Parrot file goes through. */
async function read(name: string, bytes: Uint8Array) {
  const reading = await readQuestionFile({ name, bytes })
  const proposal = await inspectImportValue(reading.record)
  return { reading, proposal, questions: reading.record.bank.questions }
}

const text = (document: { content: unknown[] } | undefined) =>
  document ? blocksText(document.content as never) : ''

async function zip(files: Record<string, Uint8Array | string>) {
  const archive = new JSZip()
  for (const [path, content] of Object.entries(files)) archive.file(path, content)
  return archive.generateAsync({ type: 'uint8array' })
}

/** A fixture folder zipped, the way Canvas downloads it. */
function folder(path: string, skip: (file: string) => boolean = () => false) {
  const files: Record<string, Uint8Array> = {}
  const walk = (at: string) => {
    for (const name of readdirSync(join(fixtures, path, at))) {
      const relative = at ? `${at}/${name}` : name
      if (statSync(join(fixtures, path, relative)).isDirectory()) walk(relative)
      else if (!skip(relative)) files[relative] = fixture(`${path}/${relative}`)
    }
  }
  walk('')
  return zip(files)
}

describe('Canvas classic quiz export', () => {
  test('reads every question type, once, with its picture', async () => {
    const { reading, proposal, questions } = await read('unit-1-science-quiz-export.zip', await folder('canvas-export'))
    expect(reading.format).toBe('qti')
    expect(proposal).toBeTruthy()
    expect(reading.record.bank.name).toBe('Unit 1 Science Quiz')
    // Eleven questions and a text-only passage; the non_cc copy is not read again.
    expect(reading.found).toBe(11)
    expect(questions.map((question) => question.type)).toEqual([
      'multiple-choice', 'true-false', 'short-answer', 'short-answer', 'multiple-choice', 'short-answer',
      'matching', 'short-answer', 'short-answer', 'short-answer',
    ])
    const [choice, trueFalse, shortAnswer, blanks, multiple, dropdowns, matching, numeric, essay, upload] = questions

    expect(text(choice!.stem)).toBe('Which gas do plants take in?')
    expect(choice!.choices!.map((each) => [text(each.content), each.correct])).toEqual([
      ['Oxygen', false], ['Carbon dioxide', true], ['Helium', false],
    ])
    const picture = choice!.stem.content.find((node) => (node as { type: string }).type === 'block-image') as { asset: string }
    expect(reading.record.media.map((asset) => asset.id)).toEqual([picture.asset])

    expect(trueFalse!.choices!.map((each) => each.correct)).toEqual([false, true])
    expect(text(shortAnswer!.suggestedAnswer)).toBe('Au / au')
    expect(text(blanks!.stem)).toBe('Roses are [color1], violets are [color2].')
    expect(text(blanks!.suggestedAnswer)).toBe('color1: red / crimson\ncolor2: blue')
    expect(multiple!.choices!.map((each) => text(each.content))).toEqual(['Whale', 'Shark', 'Bat'])
    expect(reading.issues.find((issue) => issue.code === 'multiple-answer')?.message).toContain('(a, c)')
    expect(text(dropdowns!.suggestedAnswer)).toBe('temp: 100')

    expect(matching!.prompts!.map((prompt) => text(prompt.content))).toEqual(['France', 'Japan'])
    const answerOf = (index: number) =>
      text(matching!.wordBank!.find((answer) => answer.id === matching!.prompts![index]!.answer)?.content)
    expect([answerOf(0), answerOf(1)]).toEqual(['Paris', 'Tokyo'])
    expect(matching!.wordBank!.map((answer) => text(answer.content))).toEqual(['Paris', 'Tokyo', 'Lima'])

    expect(text(numeric!.suggestedAnswer)).toBe('9.81 (± 0.01)')
    expect(text(essay!.stem)).toBe('Describe the water cycle.')
    expect(text(upload!.stem)).toBe('Upload your lab report.')

    const codes = reading.issues.map((issue) => [issue.severity, issue.code])
    expect(codes).toContainEqual(['info', 'not-a-question'])
    expect(codes).toContainEqual(['error', 'unsupported-type'])
    expect(reading.issues.find((issue) => issue.code === 'unsupported-type')?.message).toBe(
      'Question 11: Test Parrot has no “calculated_question” questions, so it was left out.',
    )
  })

  test('reads the quiz alone, as a bare .xml', async () => {
    const { reading, questions } = await read('g8f3c2a.xml', fixture('canvas-export/g8f3c2a/g8f3c2a.xml'))
    expect(reading.format).toBe('qti')
    expect(questions).toHaveLength(10)
    // Its picture is in the package, not here: left out, and said so.
    expect(reading.issues.some((issue) => issue.code === 'picture-missing' && issue.message.startsWith('Question 1:'))).toBe(true)
  })
})

describe('QTI 2.1 and 2.2 items', () => {
  test('a choice item, its prompt and picture', async () => {
    const { reading, questions } = await read('choice.xml', fixture('qti21-choice.xml'))
    expect(reading.format).toBe('qti')
    expect(questions).toHaveLength(1)
    expect(text(questions[0]!.stem)).toBe('Look at the sign in the picture.\nWhat does the sign ask you to do?')
    expect(questions[0]!.choices!.map((each) => [text(each.content), each.correct])).toEqual([
      ['Cut the grass.', false], ['Stay off the grass.', true], ['Water the grass.', false],
    ])
    // A bare item file has no picture to bring in.
    expect(reading.issues.map((issue) => issue.code)).toContain('picture-missing')
  })

  test('matching, text entry and ordering', async () => {
    const match = await read('match.xml', fixture('qti21-match.xml'))
    expect(match.reading.format).toBe('qti')
    const [matching] = match.questions
    expect(text(matching!.stem)).toBe('Match each book to its author.')
    expect(matching!.prompts!.map((prompt) => text(prompt.content))).toEqual(['Hamlet', 'Emma'])
    const answerOf = (index: number) =>
      text(matching!.wordBank!.find((answer) => answer.id === matching!.prompts![index]!.answer)?.content)
    expect([answerOf(0), answerOf(1)]).toEqual(['William Shakespeare', 'Jane Austen'])
    expect(matching!.wordBank!.map((answer) => text(answer.content))).toContain('Charles Dickens')

    const entry = await read('entry.xml', fixture('qti21-text-entry.xml'))
    expect(text(entry.questions[0]!.stem)).toBe('The capital of Canada is _____.')
    expect(text(entry.questions[0]!.suggestedAnswer)).toBe('Ottawa')

    const order = await read('order.xml', fixture('qti21-order.xml'))
    expect(order.questions[0]!.type).toBe('short-answer')
    expect(text(order.questions[0]!.suggestedAnswer).split(/\n+/)).toEqual([
      'Ask a question', 'Test the hypothesis', 'Draw a conclusion',
    ])
  })

  test('a package: its test names the bank, and pictures come from inside it', async () => {
    const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1" identifier="MANIFEST-1">
  <organizations/>
  <resources>
    <resource identifier="test" type="imsqti_test_xmlv2p1" href="test.xml"><file href="test.xml"/></resource>
    <resource identifier="choice" type="imsqti_item_xmlv2p1" href="items/choice.xml"><file href="items/choice.xml"/><file href="items/images/sign.png"/></resource>
    <resource identifier="match" type="imsqti_item_xmlv2p1" href="items/match.xml"><file href="items/match.xml"/></resource>
  </resources>
</manifest>`
    const testXml = `<?xml version="1.0" encoding="UTF-8"?>
<assessmentTest xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1" identifier="t1" title="English reading check">
  <testPart identifier="p1" navigationMode="linear" submissionMode="individual">
    <assessmentSection identifier="s1" title="Section" visible="true">
      <assessmentItemRef identifier="choice" href="items/choice.xml"/>
      <assessmentItemRef identifier="match" href="items/match.xml"/>
    </assessmentSection>
  </testPart>
</assessmentTest>`
    const { reading, questions } = await read('reading-check.zip', await zip({
      'imsmanifest.xml': manifest,
      'test.xml': testXml,
      'items/choice.xml': fixture('qti21-choice.xml'),
      'items/match.xml': fixture('qti21-match.xml'),
      'items/images/sign.png': PNG,
    }))
    expect(reading.format).toBe('qti')
    expect(reading.record.bank.name).toBe('English reading check')
    expect(questions.map((question) => question.type)).toEqual(['multiple-choice', 'matching'])
    expect(reading.record.media).toHaveLength(1)
    expect(reading.issues.filter((issue) => issue.code === 'picture-missing')).toEqual([])
  })
})

describe('QTI 3.0 items', () => {
  test('a multiple-response choice item', async () => {
    const { reading, questions } = await read('primes.xml', fixture('qti30-choice.xml'))
    expect(reading.format).toBe('qti')
    expect(text(questions[0]!.stem)).toBe('Which of these numbers are prime?\nSelect all that apply.')
    expect(questions[0]!.choices!.map((each) => text(each.content))).toEqual(['2', '4', '7'])
    expect(reading.issues.find((issue) => issue.code === 'multiple-answer')?.message).toContain('(a, c)')
  })

  test('a text entry and a drop-down in one sentence', async () => {
    const { reading, questions } = await read('rivers.xml', fixture('qti30-text-entry.xml'))
    expect(reading.format).toBe('qti')
    expect(text(questions[0]!.stem)).toBe('London stands on the [Blank 1], and Paris on the [Blank 2].')
    expect(text(questions[0]!.suggestedAnswer)).toBe('Blank 1: Thames / River Thames\nBlank 2: Seine')
  })
})

describe('QTI detection and safety', () => {
  test('a Blackboard pool .dat is left to Blackboard’s reader', async () => {
    const dat = `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop><assessment title="Pool"><section><item title="Q">
<itemmetadata><bbmd_questiontype>Essay</bbmd_questiontype></itemmetadata>
<presentation><flow class="Block"><flow class="QUESTION_BLOCK"><flow class="FORMATTED_TEXT_BLOCK"><material><mat_extension><mat_formattedtext type="HTML">Why?</mat_formattedtext></mat_extension></material></flow></flow></flow></presentation>
</item></section></assessment></questestinterop>`
    const { reading } = await read('res00001.dat', encode(dat))
    expect(reading.format).toBe('bb-package')
  })

  test('Moodle XML is not QTI', async () => {
    const reading = await readQuestionFile({ name: 'quiz.xml', bytes: encode('<?xml version="1.0"?><quiz><question type="essay"><questiontext><text>Why?</text></questiontext></question></quiz>') }).catch(() => null)
    expect(reading?.format ?? null).not.toBe('qti')
  })

  test('an external entity is never expanded, and a script does not survive', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE questestinterop [ <!ENTITY secret SYSTEM "file:///etc/passwd"> ]>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2">
  <assessment ident="a1" title="Hostile">
    <section ident="root_section">
      <item ident="i1" title="Question">
        <presentation>
          <material><mattext texttype="text/html">&lt;p&gt;Why &amp;secret;?&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src="x.png" onerror="alert(2)"&gt;&lt;/p&gt;</mattext></material>
          <response_str ident="response1" rcardinality="Single"><render_fib/></response_str>
        </presentation>
      </item>
      <item ident="i2" title="Question">
        <presentation><material><mattext>Say &secret;</mattext></material><response_str ident="r" rcardinality="Single"><render_fib/></response_str></presentation>
      </item>
    </section>
  </assessment>
</questestinterop>`
    const { reading, questions } = await read('hostile.xml', encode(xml))
    expect(reading.format).toBe('qti')
    expect(questions).toHaveLength(2)
    const json = JSON.stringify(questions)
    expect(json).not.toContain('root:')
    expect(json).not.toContain('alert')
    expect(json).not.toContain('onerror')
    expect(text(questions[0]!.stem)).toBe('Why &secret;?')
  })
})
