import { useEffect, useRef } from 'react';

/**
 * Southern-sky backdrop for the app — a fixed, behind-everything layer
 * (z-index: -1, pointer-events: none) so page content sits on top untouched.
 *
 * variant 'full'    — landing / sign-in: bright stars, Milky Way, the Southern
 *                     Cross with the Pointers, aurora, occasional shooting star.
 * variant 'ambient' — chat: dimmer stars and Milky Way, no constellation or
 *                     aurora, so the conversation stays readable over it.
 */

type Variant = 'full' | 'ambient';

const CRUX = [
  { left: '64.5%', top: '53%', d: 9, c: '#cfe0ff', g: 18, t: 6, delay: 0, label: 'Acrux' },
  { left: '56%', top: '35%', d: 7, c: '#cfe0ff', g: 15, t: 5.4, delay: 0.6, label: 'Mimosa' },
  { left: '68%', top: '13%', d: 7, c: '#ffd2a1', g: 16, t: 6.8, delay: 1.1, label: 'Gacrux' },
  { left: '75%', top: '30%', d: 4.5, c: '#cfe0ff', g: 10, t: 4.6, delay: 0.3, label: 'Delta' },
  { left: '63.5%', top: '40%', d: 3.4, c: '#cfe0ff', g: 7, t: 4, delay: 1.6, label: '' },
  { left: '40%', top: '57%', d: 9, c: '#eef3ff', g: 19, t: 5.8, delay: 0.9, label: 'Rigil Kent.' },
  { left: '45.5%', top: '50%', d: 7, c: '#eef3ff', g: 15, t: 5.2, delay: 0.2, label: 'Hadar' },
];

export default function SkyBackground({ variant = 'full' }: { variant?: Variant }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const full = variant === 'full';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dim = full ? 1 : 0.55;
    const rand = (a: number, b: number) => a + Math.random() * (b - a);

    let W = 0;
    let H = 0;
    let dpr = 1;
    let stars: any[] = [];
    let band: any[] = [];
    let raf = 0;

    function build() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas!.width = window.innerWidth * dpr;
      H = canvas!.height = window.innerHeight * dpr;
      canvas!.style.width = window.innerWidth + 'px';
      canvas!.style.height = window.innerHeight + 'px';
      const area = window.innerWidth * window.innerHeight;

      const n = Math.min(full ? 760 : 440, Math.round(area / (full ? 1500 : 2400)));
      stars = [];
      for (let i = 0; i < n; i++) {
        const bright = Math.random();
        stars.push({
          x: Math.random() * W,
          y: Math.random() * H,
          r: (bright > 0.94 ? rand(1.4, 2.3) : rand(0.5, 1.25)) * dpr,
          a: rand(0.4, bright > 0.9 ? 1.0 : 0.82) * dim,
          tw: rand(0.6, 1.4),
          ph: rand(0, Math.PI * 2),
          warm: Math.random() > 0.85,
        });
      }

      band = [];
      const m = Math.min(full ? 900 : 480, Math.round(area / (full ? 1300 : 2200)));
      for (let i = 0; i < m; i++) {
        const t = Math.random();
        const cx = t * W;
        const cy = H * 0.92 - t * H * 0.86;
        const spread =
          (Math.random() + Math.random() + Math.random() - 1.5) * 0.12 * Math.min(W, H);
        const cloud = Math.random() < 0.045;
        band.push({
          x: cx + spread * 0.9,
          y: cy + spread,
          r: cloud ? rand(3, 7) * dpr : rand(0.4, 1.15) * dpr,
          a: (cloud ? rand(0.03, 0.09) : rand(0.18, 0.7)) * dim,
          tw: rand(0.5, 1.2),
          ph: rand(0, Math.PI * 2),
        });
      }
    }

    function draw(time: number) {
      ctx!.clearRect(0, 0, W, H);
      for (const s of band) {
        const a = reduce ? s.a : s.a * (0.78 + 0.22 * Math.sin(time * 0.001 * s.tw + s.ph));
        ctx!.globalAlpha = a;
        ctx!.fillStyle = '#d2dbf5';
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, s.r, 0, 7);
        ctx!.fill();
      }
      for (const s of stars) {
        const a = reduce ? s.a : s.a * (0.62 + 0.38 * Math.sin(time * 0.001 * s.tw + s.ph));
        ctx!.globalAlpha = a;
        ctx!.fillStyle = s.warm ? '#ffe7c9' : '#f6f8ff';
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, s.r, 0, 7);
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    }

    build();
    raf = requestAnimationFrame(draw);

    let rt: any;
    const onResize = () => {
      clearTimeout(rt);
      rt = setTimeout(build, 180);
    };
    window.addEventListener('resize', onResize);

    // Occasional shooting star (full variant only).
    let meteorTimer: any;
    function meteor() {
      const m = document.createElement('div');
      const startX = rand(window.innerWidth * 0.45, window.innerWidth * 0.95);
      const startY = rand(window.innerHeight * 0.05, window.innerHeight * 0.4);
      m.style.cssText =
        'position:fixed;left:' +
        startX +
        'px;top:' +
        startY +
        'px;width:2px;height:2px;border-radius:50%;background:#fff;' +
        'box-shadow:0 0 6px 1px #cfe0ff;pointer-events:none;z-index:-1;opacity:0;';
      const tail = document.createElement('div');
      tail.style.cssText =
        'position:absolute;right:1px;top:50%;transform:translateY(-50%);width:120px;height:1px;' +
        'background:linear-gradient(90deg,transparent,rgba(207,224,255,0.8));';
      m.appendChild(tail);
      document.body.appendChild(m);
      const dx = -rand(220, 420);
      const dy = rand(120, 240);
      m.animate(
        [
          { transform: 'translate(0,0) rotate(150deg)', opacity: 0 },
          { opacity: 1, offset: 0.15 },
          { transform: `translate(${dx}px,${dy}px) rotate(150deg)`, opacity: 0 },
        ],
        { duration: rand(900, 1500), easing: 'ease-out' }
      ).onfinish = () => m.remove();
    }
    function scheduleMeteor() {
      meteorTimer = setTimeout(() => {
        meteor();
        scheduleMeteor();
      }, rand(6000, 13000));
    }
    if (full && !reduce) meteorTimer = setTimeout(scheduleMeteor, 3000);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      clearTimeout(rt);
      clearTimeout(meteorTimer);
    };
  }, [full]);

  return (
    <div className="sky-root" aria-hidden="true">
      <canvas ref={canvasRef} className="sky-canvas" />
      <div className="sky-mw" />
      <div className="sky-mw sky-mw-core" />
      <div className="sky-coalsack" />
      {full && <div className="sky-aurora" />}
      {full && (
        <div className="sky-crux">
          <svg className="sky-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
            <line x1="68" y1="13" x2="64.5" y2="53" />
            <line x1="56" y1="35" x2="75" y2="30" />
          </svg>
          {CRUX.map((s, i) => (
            <span
              key={i}
              className="sky-star"
              style={{
                left: s.left,
                top: s.top,
                width: s.d,
                height: s.d,
                background: `radial-gradient(circle at center, #fff 0%, ${s.c} 38%, rgba(255,255,255,0) 72%)`,
                boxShadow: `0 0 ${s.g}px 1px ${s.c}`,
                animationDuration: `${s.t}s`,
                animationDelay: `${s.delay}s`,
              }}
            >
              {s.label ? <i className="sky-label">{s.label}</i> : null}
            </span>
          ))}
        </div>
      )}

      <style jsx>{`
        .sky-root {
          position: fixed;
          inset: 0;
          z-index: -1;
          pointer-events: none;
          overflow: hidden;
          background:
            radial-gradient(ellipse 120% 70% at 66% 8%, rgba(52, 68, 116, 0.34), transparent 60%),
            radial-gradient(ellipse 90% 70% at 50% 118%, rgba(9, 15, 28, 0.5), transparent 62%),
            linear-gradient(180deg, #081021 0%, #05080f 58%, #04060d 100%);
        }
        .sky-canvas {
          position: absolute;
          inset: 0;
        }
        .sky-mw {
          position: absolute;
          inset: -25%;
          background: linear-gradient(
            118deg,
            transparent 32%,
            rgba(150, 164, 210, 0.1) 41%,
            rgba(202, 214, 247, 0.28) 50%,
            rgba(150, 164, 210, 0.1) 59%,
            transparent 68%
          );
          filter: blur(9px);
          mix-blend-mode: screen;
        }
        .sky-mw-core {
          background: linear-gradient(
            118deg,
            transparent 44%,
            rgba(226, 232, 255, 0.2) 50%,
            transparent 56%
          );
          filter: blur(4px);
        }
        .sky-coalsack {
          position: absolute;
          width: 17vw;
          height: 13vw;
          left: 55%;
          top: 40%;
          background: radial-gradient(ellipse at center, rgba(4, 6, 13, 0.82), transparent 70%);
          filter: blur(13px);
        }
        .sky-aurora {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          height: 40vh;
          background:
            radial-gradient(80% 120% at 35% 100%, rgba(63, 174, 142, 0.16), transparent 70%),
            radial-gradient(70% 120% at 72% 100%, rgba(74, 150, 196, 0.12), transparent 72%);
          filter: blur(26px);
          animation: skyAurora 16s ease-in-out infinite alternate;
        }
        .sky-crux {
          position: absolute;
          inset: 12vh 0 auto 0;
          height: 60vh;
        }
        .sky-lines {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
        }
        .sky-lines :global(line) {
          stroke: rgba(207, 224, 255, 0.26);
          stroke-width: 0.18;
        }
        .sky-star {
          position: absolute;
          border-radius: 50%;
          transform: translate(-50%, -50%);
          animation-name: skyTwinkle;
          animation-iteration-count: infinite;
          animation-timing-function: ease-in-out;
        }
        .sky-label {
          position: absolute;
          left: 50%;
          top: 130%;
          transform: translateX(-50%);
          font-size: 9.5px;
          font-style: normal;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: rgba(233, 240, 255, 0.5);
          white-space: nowrap;
          font-weight: 500;
        }
        @keyframes skyTwinkle {
          0%,
          100% {
            opacity: 0.95;
          }
          45% {
            opacity: 0.7;
          }
          70% {
            opacity: 1;
          }
        }
        @keyframes skyAurora {
          0% {
            transform: translateX(-3%) scaleY(0.96);
            opacity: 0.85;
          }
          100% {
            transform: translateX(4%) scaleY(1.06);
            opacity: 1;
          }
        }
        @media (max-width: 560px) {
          .sky-crux {
            height: 44vh;
          }
          .sky-label {
            font-size: 8px;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .sky-star,
          .sky-aurora {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
