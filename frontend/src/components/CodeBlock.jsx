import { useMemo, useState } from 'react';

/**
 * Lightweight, dependency-free syntax highlighter for documentation snippets.
 *
 * Rules are anchored (`^`) and evaluated at the current scan position. Tokens
 * are emitted as React elements (never innerHTML), so arbitrary source text
 * cannot inject markup.
 *  
 * 
 */

const JS_KEYWORDS =
  /^\b(?:import|export|from|const|let|var|function|return|if|else|for|while|switch|case|break|continue|new|class|extends|super|this|async|await|try|catch|finally|throw|typeof|instanceof|of|in|default|null|undefined|true|false|require|process)\b/;

function rulesFor(language) {
  switch (language) {
    case 'js':
    case 'jsx':
    case 'javascript':
    case 'node':
      return [
        { re: /^\/\/[^\n]*/, cls: 'cm' },
        { re: /^\/\*[\s\S]*?\*\//, cls: 'cm' },
        { re: /^"(?:[^"\\]|\\.)*"/, cls: 'str' },
        { re: /^'(?:[^'\\]|\\.)*'/, cls: 'str' },
        { re: /^`(?:[^`\\]|\\.)*`/, cls: 'str' },
        { re: /^\d+(?:\.\d+)?/, cls: 'num' },
        { re: JS_KEYWORDS, cls: 'kw' },
      ];
    case 'json':
      return [
        { re: /^"(?:[^"\\]|\\.)*"(?=\s*:)/, cls: 'key' },
        { re: /^"(?:[^"\\]|\\.)*"/, cls: 'str' },
        { re: /^\b(?:true|false|null)\b/, cls: 'kw' },
        { re: /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, cls: 'num' },
      ];
    case 'bash':
    case 'sh':
    case 'shell':
      return [
        { re: /^#[^\n]*/, cls: 'cm' },
        { re: /^"(?:[^"\\]|\\.)*"/, cls: 'str' },
        { re: /^'[^']*'/, cls: 'str' },
        {
          re: /^\b(?:npm|npx|node|cd|cp|mv|git|docker|podman|curl|export|echo|sudo|mkdir|cat|rm|chmod|source|open)\b/,
          cls: 'kw',
        },
        { re: /^\b\d+\b/, cls: 'num' },
        { re: /^[A-Z_][A-Z0-9_]*(?==)/, cls: 'key' },
      ];
    case 'env':
      return [
        { re: /^#[^\n]*/, cls: 'cm' },
        { re: /^[A-Za-z_][A-Za-z0-9_]*(?==)/, cls: 'key' },
        { re: /^=/, cls: 'op' },
        { re: /^[^\n]+/, cls: 'str' },
      ];
    case 'http':
      return [
        { re: /^(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/, cls: 'kw' },
        { re: /^HTTP\/[0-9.]+/, cls: 'num' },
        { re: /^[A-Za-z][A-Za-z0-9-]*(?=:)/, cls: 'key' },
        { re: /^"[^"]*"/, cls: 'str' },
      ];
    default:
      return [];
  }
}

function tokenize(code, language) {
  const rules = rulesFor(language);
  const tokens = [];
  let i = 0;

  while (i < code.length) {
    let matched = null;
    let matchedRule = null;

    if (rules.length > 0) {
      const slice = code.slice(i);
      for (const rule of rules) {
        const m = rule.re.exec(slice);
        if (m && m.index === 0 && m[0].length > 0) {
          matched = m[0];
          matchedRule = rule;
          break;
        }
      }
    }

    if (matched !== null) {
      tokens.push({ t: matched, c: matchedRule.cls });
      i += matched.length;
    } else {
      const last = tokens[tokens.length - 1];
      if (last && last.c === null) {
        last.t += code[i];
      } else {
        tokens.push({ t: code[i], c: null });
      }
      i += 1;
    }
  }

  return tokens;
}

export default function CodeBlock({ code, language = 'text', title }) {
  const text = typeof code === 'string' ? code.replace(/\n$/, '') : '';
  const tokens = useMemo(() => tokenize(text, language), [text, language]);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — silently ignore.
    }
  }

  return (
    <div className="docsCode">
      <div className="docsCodeBar">
        <span className="docsCodeLang">{title || language}</span>
        <button
          type="button"
          className={`docsCodeCopy ${copied ? 'isCopied' : ''}`}
          onClick={handleCopy}
          aria-label="Copy code to clipboard"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre className="docsCodePre">
        <code>
          {tokens.map((tk, idx) => (
            <span key={idx} className={tk.c ? `tok-${tk.c}` : undefined}>
              {tk.t}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
