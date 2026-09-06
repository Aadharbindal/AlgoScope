/**
 * Hand-drawn icons. A whole icon package for eight glyphs would be more bytes
 * than the rest of the landing page, and these need to inherit currentColor
 * and sit on the same optical grid as the type.
 */

type P = { className?: string; size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

/** The shell prompt, drawn heavier than the utility icons — it is the mark. */
export const PromptMark = ({ className, size = 16 }: P) => (
  <svg {...base(size)} className={className} strokeWidth={2.4}>
    <path d="M5.5 6.5l5.5 5.5-5.5 5.5" />
    <path d="M13 17.5h5.5" />
  </svg>
);

export const TerminalIcon = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M5 8l4 4-4 4" />
    <path d="M13 16h6" />
  </svg>
);

export const BulbIcon = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M9 18h6" />
    <path d="M10 21h4" />
    <path d="M12 3a6 6 0 0 0-3.5 10.9c.4.3.6.7.6 1.1h5.8c0-.4.2-.8.6-1.1A6 6 0 0 0 12 3z" />
  </svg>
);

export const TargetIcon = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3.4" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </svg>
);

export const ChevronIcon = ({ className, size = 14 }: P) => (
  <svg {...base(size)} className={className} strokeWidth={2}>
    <path d="M6 9.5l6 6 6-6" />
  </svg>
);

export const ArrowRightIcon = ({ className, size = 16 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 12h15" />
    <path d="M13 6l6 6-6 6" />
  </svg>
);

export const ArrowLeftIcon = ({ className, size = 16 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M20 12H5" />
    <path d="M11 6l-6 6 6 6" />
  </svg>
);

export const PlayIcon = ({ className, size = 14 }: P) => (
  <svg {...base(size)} className={className} fill="currentColor" stroke="none">
    <path d="M7 4.5l12 7.5-12 7.5z" />
  </svg>
);

export const PauseIcon = ({ className, size = 14 }: P) => (
  <svg {...base(size)} className={className} fill="currentColor" stroke="none">
    <rect x="6.5" y="5" width="3.6" height="14" rx="1" />
    <rect x="13.9" y="5" width="3.6" height="14" rx="1" />
  </svg>
);

export const ExpandIcon = ({ className, size = 15 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M14 4h6v6" />
    <path d="M10 20H4v-6" />
    <path d="M20 4l-7 7" />
    <path d="M4 20l7-7" />
  </svg>
);

export const ChevronsLeftIcon = ({ className, size = 15 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M11.5 6l-6 6 6 6" />
    <path d="M18.5 6l-6 6 6 6" />
  </svg>
);

export const ChevronsRightIcon = ({ className, size = 15 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M5.5 6l6 6-6 6" />
    <path d="M12.5 6l6 6-6 6" />
  </svg>
);

export const SkipStartIcon = ({ className, size = 15 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M18 5.5v13L8 12z" />
    <path d="M6 5.5v13" />
  </svg>
);

export const SkipEndIcon = ({ className, size = 15 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6 5.5v13L16 12z" />
    <path d="M18 5.5v13" />
  </svg>
);

export const CheckIcon = ({ className, size = 15 }: P) => (
  <svg {...base(size)} className={className} strokeWidth={2}>
    <path d="M4 12.5l5 5 11-11" />
  </svg>
);

export const CheckCircleIcon = ({ className, size = 16 }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12.4l2.6 2.6L16 9.6" />
  </svg>
);

export const MoonIcon = ({ className, size = 14 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
  </svg>
);

export const SunIcon = ({ className, size = 14 }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

export const MonitorIcon = ({ className, size = 14 }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="4" width="18" height="12.5" rx="2" />
    <path d="M9 20.5h6M12 16.5v4" />
  </svg>
);

export const RestartIcon = ({ className, size = 15 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path d="M20 4v4.5h-4.5" />
  </svg>
);

export const ExternalLinkIcon = ({ className, size = 16 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M14 4h6v6" />
    <path d="M20 4l-8.5 8.5" />
    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </svg>
);

export const ShareIcon = ({ className, size = 16 }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="17.5" cy="5.5" r="2.5" />
    <circle cx="6.5" cy="12" r="2.5" />
    <circle cx="17.5" cy="18.5" r="2.5" />
    <path d="M8.8 10.8l6.4-3.9" />
    <path d="M8.8 13.2l6.4 3.9" />
  </svg>
);

export const CopyIcon = ({ className, size = 16 }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </svg>
);

export const LadderIcon = ({ className, size = 16 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M7 3v18" />
    <path d="M17 3v18" />
    <path d="M7 8h10" />
    <path d="M7 13h10" />
    <path d="M7 18h10" />
  </svg>
);
