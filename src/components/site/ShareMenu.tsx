'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckIcon, CopyIcon, ShareIcon } from './Icons';

/**
 * Share this exact step, or put it in someone's article.
 *
 * The link already exists — the workbench keeps the URL in sync as you step —
 * so this is not a link builder. It is a place to see the whole link at once,
 * copy it, and get the iframe form of the same state, because the moment worth
 * sharing is a specific step and copying a URL out of the address bar loses
 * nothing but is easy to distrust.
 */

const EMBED_W = 760;
const EMBED_H = 560;

interface Shareable {
  link: string;
  embed: string;
  /** Where to pin the panel, in viewport coordinates. */
  at: { top: number; right: number };
}

export function ShareMenu({ title }: { title: string }) {
  // Read at the moment of opening rather than on every step. The address bar
  // is the source of truth — the workbench keeps it in sync — so there is no
  // second copy of this state to drift, and the header does not re-render as
  // you step through the trace.
  const [shareable, setShareable] = useState<Shareable | null>(null);
  const open = shareable !== null;
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  // The header clips its own corners with `overflow: hidden`, which would cut
  // an absolutely-positioned panel off after one line. A fixed panel is laid
  // out against the viewport instead, so nothing upstream can clip it — at the
  // cost of having to be told where the button is.
  const anchor = () => {
    const rect = button.current?.getBoundingClientRect();
    return {
      top: (rect?.bottom ?? 0) + 8,
      right: Math.max(12, window.innerWidth - (rect?.right ?? window.innerWidth)),
    };
  };

  const toggle = () => {
    if (open) {
      setShareable(null);
      return;
    }
    const link = window.location.href;
    const u = new URL(link);
    const src = `${u.origin}/embed${u.pathname.replace(/^\/a/, '')}${u.search}`;
    setShareable({
      at: anchor(),
      link,
      embed:
        `<iframe src="${src}" width="${EMBED_W}" height="${EMBED_H}" ` +
        `style="border:1px solid #2b3630;border-radius:12px;max-width:100%" ` +
        `loading="lazy" title="${title}"></iframe>`,
    });
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setShareable(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShareable(null);
    };
    // A fixed panel cannot follow the button on its own, so a resize re-measures
    // rather than closing — losing what you were about to copy because the
    // window changed size is the wrong trade. Scrolling needs no handler at
    // all: the header is sticky, so the button does not move.
    const onResize = () => setShareable((prev) => (prev ? { ...prev, at: anchor() } : prev));
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button
        ref={button}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        title="Share this step, or embed it"
        className="inline-flex items-center gap-1.5 rounded-[7px] border border-hairline bg-sunk px-2.5 py-1.5 font-mono text-[0.66rem] text-muted transition-colors hover:border-hairline-strong hover:text-ink-2"
      >
        <ShareIcon size={12} />
        share
      </button>

      {shareable && (
        <div
          role="dialog"
          aria-label="Share this step"
          style={{ top: shareable.at.top, right: shareable.at.right }}
          className="fixed z-50 max-h-[80vh] w-[min(30rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-hairline-strong bg-panel p-4 shadow-[var(--lift)]"
        >
          <p className="text-[0.82rem] leading-snug text-ink">
            This link opens on the step you are looking at, with the same input and the same
            variant switched on.
          </p>
          <p className="mt-1 text-[0.72rem] leading-snug text-faint">
            Pasted into a chat, it previews as a picture of that step — drawn by running the
            algorithm, not from a template.
          </p>

          <Field label="Link" value={shareable.link} />

          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`${title}\n${shareable.link}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-[7px] border border-hairline bg-sunk px-2.5 py-1.5 font-mono text-[0.66rem] text-muted transition-colors hover:text-ink-2"
            >
              WhatsApp
            </a>
            <a
              href={`https://t.me/share/url?url=${encodeURIComponent(shareable.link)}&text=${encodeURIComponent(title)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-[7px] border border-hairline bg-sunk px-2.5 py-1.5 font-mono text-[0.66rem] text-muted transition-colors hover:text-ink-2"
            >
              Telegram
            </a>
          </div>

          <div className="mt-4 border-t border-hairline pt-3">
            <p className="text-[0.82rem] leading-snug text-ink">Put it in a page</p>
            <p className="mt-1 text-[0.72rem] leading-snug text-faint">
              A working player, not a screenshot. In WordPress, Notion or Ghost you can paste the
              link above on its own line instead and it expands to this by itself.
            </p>
            <Field label="Embed" value={shareable.embed} mono />
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard refused (an insecure origin, or a browser policy). The text
      // is selectable and visible, so there is still a way through.
    }
  };

  return (
    <div className="mt-2.5">
      <label className="label">{label}</label>
      <div className="mt-1 flex gap-2">
        <input
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className={`min-w-0 flex-1 rounded-[7px] border border-hairline bg-sunk px-2.5 py-1.5 text-[0.7rem] text-ink-2 outline-none focus:border-accent-edge ${
            mono ? 'font-mono' : ''
          }`}
        />
        <button
          type="button"
          onClick={copy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[7px] border border-accent-edge bg-accent-dim px-2.5 py-1.5 font-mono text-[0.66rem] text-accent transition-colors hover:bg-accent hover:text-on-accent"
        >
          {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
    </div>
  );
}
