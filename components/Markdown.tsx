 /**
 * Themed markdown renderer.
 *
 * Models emit markdown (**bold**, ## headings, - lists). The chat was showing
 * that markup raw; this renders it, styled to the southern-sky theme so it
 * matches without touching globals.css. Used by the chat message view and the
 * draft views in the inbox + review queue.
 *
 * Core markdown only (no rehype-raw) — model output is markdown, never HTML,
 * so there's nothing unsafe to render. Colours inherit from the parent, so the
 * same component reads correctly on any background it's dropped into.
 */

import ReactMarkdown from 'react-markdown';
import type { CSSProperties } from 'react';

const heading: CSSProperties = {
  color: 'var(--star)',
  fontWeight: 600,
  margin: '1em 0 0.4em',
  lineHeight: 1.3,
};

export default function Markdown({ children }: { children: string }) {
  return (
    <div style={{ lineHeight: 1.6 }}>
      <ReactMarkdown
        components={{
          p: (props) => <p style={{ margin: '0 0 0.7em' }} {...props} />,
          strong: (props) => (
            <strong style={{ fontWeight: 600, color: 'var(--star)' }} {...props} />
          ),
          em: (props) => <em {...props} />,
          h1: (props) => <h3 style={{ ...heading, fontSize: '1.1rem' }} {...props} />,
          h2: (props) => <h3 style={{ ...heading, fontSize: '1.02rem' }} {...props} />,
          h3: (props) => <h4 style={{ ...heading, fontSize: '0.95rem' }} {...props} />,
          h4: (props) => <h4 style={{ ...heading, fontSize: '0.9rem' }} {...props} />,
          ul: (props) => (
            <ul style={{ margin: '0 0 0.7em', paddingLeft: '1.3em' }} {...props} />
          ),
          ol: (props) => (
            <ol style={{ margin: '0 0 0.7em', paddingLeft: '1.3em' }} {...props} />
          ),
          li: (props) => <li style={{ margin: '0.25em 0' }} {...props} />,
          a: (props) => (
            <a
              style={{ color: 'var(--horizon)', textDecoration: 'underline' }}
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            />
          ),
          code: (props) => (
            <code
              style={{
                fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
                background: 'rgba(0,0,0,0.3)',
                padding: '0.1em 0.35em',
                borderRadius: 4,
                fontSize: '0.88em',
              }}
              {...props}
            />
          ),
          pre: (props) => (
            <pre
              style={{
                background: 'rgba(0,0,0,0.3)',
                padding: '12px 14px',
                borderRadius: 8,
                overflowX: 'auto',
                margin: '0 0 0.7em',
                fontSize: '0.85em',
              }}
              {...props}
            />
          ),
          blockquote: (props) => (
            <blockquote
              style={{
                borderLeft: '3px solid var(--line-2)',
                paddingLeft: '0.9em',
                margin: '0 0 0.7em',
                color: 'var(--muted)',
              }}
              {...props}
            />
          ),
          hr: () => (
            <hr
              style={{
                border: 'none',
                borderTop: '1px solid var(--line)',
                margin: '1em 0',
              }}
            />
          ),
          table: (props) => (
            <table
              style={{
                borderCollapse: 'collapse',
                width: '100%',
                margin: '0 0 0.7em',
                fontSize: '0.9em',
              }}
              {...props}
            />
          ),
          th: (props) => (
            <th
              style={{
                border: '1px solid var(--line-2)',
                padding: '6px 10px',
                textAlign: 'left',
                color: 'var(--star)',
              }}
              {...props}
            />
          ),
          td: (props) => (
            <td
              style={{ border: '1px solid var(--line)', padding: '6px 10px' }}
              {...props}
            />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
