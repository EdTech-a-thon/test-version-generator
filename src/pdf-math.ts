// Mathematics written on the line, for the PDF Export Adapter.
//
// Print typesets an equation with KaTeX; the PDF adapter draws text with a
// font and has no typesetter, so it writes an equation the way a test prints
// one on a single line: a fraction as `a⁄b`, parenthesised where a term needs
// it, roots, raised and lowered scripts, relations, operators and Greek letters
// as their symbols, a minus sign as a minus sign, and the commands that only
// size what follows — `\left`, `\big` — dropped. It is school notation, not all
// of LaTeX: a command it does not know prints as its name, and never with the
// backslash or the braces of its arguments, which is how a converted test came
// to print `dfrac{3x - 4}{2x - 5}` and `-2 le x le 4`.

/** A run of an equation: its text, its size relative to the text around it,
 *  and how far it is raised, in the same relative units. */
export type MathPiece = { text: string; scale: number; rise: number }

const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ',
  tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', ast: '∗', circ: '∘',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', lt: '<', gt: '>',
  approx: '≈', sim: '∼', equiv: '≡', propto: '∝',
  infty: '∞', to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒',
  Leftarrow: '⇐', leftrightarrow: '↔', Leftrightarrow: '⇔', mapsto: '↦',
  in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', cup: '∪', cap: '∩',
  emptyset: '∅', varnothing: '∅', forall: '∀', exists: '∃', neg: '¬',
  angle: '∠', triangle: '△', perp: '⊥', parallel: '∥', degree: '°',
  prime: '′', ldots: '…', cdots: '⋯', dots: '…', sum: '∑', prod: '∏',
  int: '∫', partial: '∂', nabla: '∇', lbrace: '{', rbrace: '}',
  langle: '⟨', rangle: '⟩', vert: '|', mid: '|', lvert: '|', rvert: '|',
  lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉',
}

// Commands that print as their own name, upright, as KaTeX sets them.
const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'log', 'ln', 'exp', 'lim', 'max', 'min', 'sup',
  'inf', 'det', 'gcd', 'deg', 'mod',
])

// Commands that only size or style what follows them.
const IGNORED = new Set([
  'left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr',
  'displaystyle', 'textstyle', 'limits', 'nolimits',
])

// Commands whose one argument is written as it is: words for the `text` ones,
// mathematics in a different face for the rest.
const WORDS = new Set(['text', 'textrm', 'textit', 'textbf', 'mbox'])
const FACES = new Set([
  'mathrm', 'mathit', 'mathbf', 'mathsf', 'mathtt', 'operatorname',
  'boldsymbol', 'mathbb', 'mathcal',
])

const SPACES: Record<string, string> = {
  ',': ' ', ':': ' ', ';': ' ', ' ': ' ', '!': '', quad: '  ', qquad: '    ',
}

const FRACTIONS = new Set(['frac', 'dfrac', 'tfrac', 'cfrac'])

const SCRIPT_SCALE = 0.75
const RAISE = 0.35
const LOWER = -0.2

/** The balanced `{…}` group opening `source` at `start`, or undefined. */
function group(source: string, start: number): { inner: string; end: number } | undefined {
  if (source[start] !== '{') return undefined
  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    if (character === '\\') {
      index += 1
      continue
    }
    if (character === '{') depth += 1
    if (character === '}') {
      depth -= 1
      if (depth === 0) return { inner: source.slice(start + 1, index), end: index + 1 }
    }
  }
  return { inner: source.slice(start + 1), end: source.length }
}

/** One argument of a command: a braced group, or the single character or
 *  command at `start`. */
function argument(source: string, start: number): { inner: string; end: number } {
  let index = start
  while (source[index] === ' ') index += 1
  const braced = group(source, index)
  if (braced) return braced
  const command = /^\\(?:[A-Za-z]+|.)/.exec(source.slice(index))
  if (command) return { inner: command[0], end: index + command[0].length }
  return { inner: source[index] ?? '', end: Math.min(source.length, index + 1) }
}

/** Whether a term needs parentheses to stay one term once a fraction is
 *  written on a line: `(3x − 4)⁄(2x − 5)`, but `x⁄2`, `(a + b)⁄c`, `f(x)⁄2`
 *  and `√(x + 1)⁄2`. */
function needsParentheses(pieces: readonly MathPiece[]): boolean {
  const written = pieces.map((piece) => piece.text).join('').trim()
  // A name, number or radical, applied to at most one group.
  const applied = written.replace(/^[\p{L}\p{N}.′√]+/u, '')
  if (applied === '') return false
  return !(applied.startsWith('(') && applied.endsWith(')') && balancedWithin(applied))
}

// `(a)(b)` starts and ends with a parenthesis but is not one group.
function balancedWithin(written: string): boolean {
  let depth = 0
  for (let index = 0; index < written.length; index += 1) {
    if (written[index] === '(') depth += 1
    if (written[index] === ')') depth -= 1
    if (depth === 0 && index < written.length - 1) return false
  }
  return true
}

/** The equation `source`, as runs of text to write on a line. */
export function mathPieces(source: string, scale = 1, rise = 0): MathPiece[] {
  const pieces: MathPiece[] = []
  const push = (text: string) => {
    if (text) pieces.push({ text, scale, rise })
  }
  const nested = (inner: string, innerScale = scale, innerRise = rise) => {
    pieces.push(...mathPieces(inner, innerScale, innerRise))
  }
  const term = (inner: string) => {
    const written = mathPieces(inner, scale, rise)
    if (needsParentheses(written)) {
      push('(')
      pieces.push(...written)
      push(')')
    } else pieces.push(...written)
  }

  let index = 0
  while (index < source.length) {
    const character = source[index]!

    if (character === '\\') {
      const command = /^\\([A-Za-z]+|.)/.exec(source.slice(index))
      const name = command?.[1] ?? ''
      index += command ? command[0].length : 1
      if (FRACTIONS.has(name)) {
        const numerator = argument(source, index)
        const denominator = argument(source, numerator.end)
        term(numerator.inner)
        push('⁄')
        term(denominator.inner)
        index = denominator.end
      } else if (name === 'sqrt') {
        // An index — `\sqrt[3]{x}` — is raised before the radical.
        const degree = source[index] === '[' ? /^\[([^\]]*)\]/.exec(source.slice(index)) : null
        if (degree) {
          nested(degree[1]!, scale * SCRIPT_SCALE, rise + scale * RAISE)
          index += degree[0].length
        }
        const radicand = argument(source, index)
        push('√')
        term(radicand.inner)
        index = radicand.end
      } else if (WORDS.has(name)) {
        const words = argument(source, index)
        push(words.inner)
        index = words.end
      } else if (FACES.has(name)) {
        const face = argument(source, index)
        nested(face.inner)
        index = face.end
      } else if (IGNORED.has(name)) {
        // `\left.` and `\right.` stand for no delimiter at all.
        if (source[index] === '.') index += 1
      } else if (name in SPACES) {
        push(SPACES[name]!)
      } else if (FUNCTIONS.has(name)) {
        push(name)
      } else if (SYMBOLS[name]) {
        push(SYMBOLS[name]!)
      } else {
        // An escaped character — `\{`, `\%`, `\$` — is that character, and an
        // unknown command prints as its name.
        push(name)
      }
      continue
    }

    if (character === '^' || character === '_') {
      const script = argument(source, index + 1)
      nested(
        script.inner,
        scale * SCRIPT_SCALE,
        rise + scale * (character === '^' ? RAISE : LOWER),
      )
      index = script.end
      continue
    }

    if (character === '{') {
      const braced = group(source, index)!
      nested(braced.inner)
      index = braced.end
      continue
    }

    if (character === '}') {
      index += 1
      continue
    }

    if (character === '~') {
      push(' ')
      index += 1
      continue
    }

    push(character === '-' ? '−' : character === "'" ? '′' : character)
    index += 1
  }
  return pieces
}

/** The equation `source` as the plain text it is written as. */
export function mathText(source: string): string {
  return mathPieces(source).map((piece) => piece.text).join('')
}
