/**
 * Syntax highlighters ported verbatim from the approved prototype.
 *
 * Each returns *escaped* HTML: a string of `<span class="tk-…">` runs that is
 * safe to hand to `dangerouslySetInnerHTML`. The `tk-*` class names are the
 * contract between this module and CodeEditor.module.css, which styles them
 * through `:global()` because the markup is produced here as a string.
 *
 * Both highlighters append a trailing newline so the tokenised <pre> keeps a
 * full last line under the transparent textarea (the prototype relies on this
 * for scroll alignment).
 */

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape a string for interpolation into HTML. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

const esc = (value: string): string => escapeHtml(value);

/** Tokenise JSON: object keys, strings, numbers, literals, punctuation. */
export function hlJSON(src: string): string {
  const re =
    /("(?:\\.|[^"\\])*")([ \t]*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(src)) !== null) {
    out += esc(src.slice(last, m.index));
    if (m[1] !== undefined) {
      out +=
        m[2] !== undefined
          ? `<span class="tk-key">${esc(m[1])}</span><span class="tk-punc">${esc(m[2])}</span>`
          : `<span class="tk-str">${esc(m[1])}</span>`;
    } else if (m[3] !== undefined) {
      out += `<span class="tk-num">${esc(m[3])}</span>`;
    } else if (m[4] !== undefined) {
      out += `<span class="tk-bool">${esc(m[4])}</span>`;
    } else if (m[5] !== undefined) {
      out += `<span class="tk-punc">${esc(m[5])}</span>`;
    }
    last = re.lastIndex;
  }

  return out + esc(src.slice(last)) + '\n';
}

/** Tokenise JavaScript: comments, strings, keywords, numbers, call sites. */
export function hlJS(src: string): string {
  const re =
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)|\b(const|let|var|function|return|if|else|for|while|new|typeof|await|async|true|false|null|undefined|this)\b|\b(\d+(?:\.\d+)?)\b|([A-Za-z_$][\w$]*)(?=\s*\()/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(src)) !== null) {
    out += esc(src.slice(last, m.index));
    if (m[1] !== undefined) out += `<span class="tk-com">${esc(m[1])}</span>`;
    else if (m[2] !== undefined) out += `<span class="tk-str">${esc(m[2])}</span>`;
    else if (m[3] !== undefined) out += `<span class="tk-kw">${esc(m[3])}</span>`;
    else if (m[4] !== undefined) out += `<span class="tk-num">${esc(m[4])}</span>`;
    else if (m[5] !== undefined) out += `<span class="tk-fn">${esc(m[5])}</span>`;
    last = re.lastIndex;
  }

  return out + esc(src.slice(last)) + '\n';
}

/** Pick the highlighter for a language. */
export function highlight(src: string, language: 'json' | 'js'): string {
  return language === 'js' ? hlJS(src) : hlJSON(src);
}
