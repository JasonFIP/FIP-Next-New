import { useState } from 'react';

/** Bottom-left "how to use" popover. Self-contained; uses the app's palette vars. */
export default function InfoButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 60 }}
        />
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="How to use Dairy Brain"
        aria-expanded={open}
        style={{
          position: 'fixed',
          left: 22,
          bottom: 22,
          zIndex: 62,
          width: 42,
          height: 42,
          borderRadius: '50%',
          cursor: 'pointer',
          background: 'rgba(11,17,34,0.62)',
          border: '1px solid var(--line-2, rgba(242,240,230,0.16))',
          color: 'var(--star-dim, #c9c6b8)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          display: 'grid',
          placeItems: 'center',
          fontFamily: 'Georgia, serif',
          fontStyle: 'italic',
          fontSize: 20,
        }}
      >
        i
      </button>

      {open && (
        <aside
          role="dialog"
          aria-label="How to use Dairy Brain"
          style={{
            position: 'fixed',
            left: 22,
            bottom: 74,
            zIndex: 63,
            width: 'min(380px, calc(100vw - 44px))',
            background: 'rgba(8,13,28,0.92)',
            border: '1px solid var(--line-2, rgba(242,240,230,0.16))',
            borderRadius: 16,
            padding: '22px 22px 20px',
            backdropFilter: 'blur(20px) saturate(1.2)',
            WebkitBackdropFilter: 'blur(20px) saturate(1.2)',
            boxShadow: '0 30px 70px -30px rgba(0,0,0,0.92)',
            textAlign: 'left',
            color: 'var(--star, #f2f0e6)',
          }}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            style={{
              position: 'absolute',
              top: 14,
              right: 16,
              background: 'none',
              border: 'none',
              color: 'var(--star-dim, #c9c6b8)',
              fontSize: 18,
              lineHeight: 1,
              cursor: 'pointer',
            }}
          >
            ×
          </button>
          <h2
            style={{
              fontFamily: 'Georgia, serif',
              fontWeight: 500,
              fontSize: '1.18rem',
              margin: '0 0 6px',
              color: '#fbfaf4',
            }}
          >
            How Dairy Brain helps
          </h2>
          <p
            style={{
              fontSize: '0.86rem',
              color: 'var(--star-dim, #c9c6b8)',
              lineHeight: 1.5,
              margin: '0 0 16px',
            }}
          >
            Grounded dairy-nutrition advice for your herd, built on the Agvance
            knowledge base. Ask in plain language — it answers with cited sources.
          </p>
          <div
            style={{
              fontSize: 10,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'var(--horizon, #e8b962)',
              opacity: 0.85,
              marginBottom: 9,
            }}
          >
            What you can ask
          </div>
          <ul
            style={{
              listStyle: 'none',
              margin: '0 0 16px',
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 9,
            }}
          >
            {[
              "Review your herd's diet and where it's falling short",
              'Cost out feed components and compare options',
              'Build a mineral plan for your system and season',
              "Understand your cows' nutritional requirements for your setup",
            ].map((t) => (
              <li
                key={t}
                style={{
                  display: 'flex',
                  gap: 10,
                  fontSize: '0.85rem',
                  color: '#dfe3ee',
                  lineHeight: 1.4,
                }}
              >
                <span
                  style={{
                    color: 'rgba(207,224,255,0.6)',
                    fontSize: '0.72rem',
                    lineHeight: 1.5,
                    flex: 'none',
                  }}
                >
                  ✦
                </span>
                {t}
              </li>
            ))}
          </ul>
          <p
            style={{
              fontSize: '0.78rem',
              color: 'var(--star-dim, #c9c6b8)',
              lineHeight: 1.5,
              borderTop: '1px solid var(--line, rgba(242,240,230,0.08))',
              paddingTop: 14,
              margin: 0,
            }}
          >
            Every answer is drawn from the Agvance knowledge base. This is general
            nutritional guidance — confirm against on-farm testing and your own
            judgement before changing what you feed.
          </p>
        </aside>
      )}
    </>
  );
}
