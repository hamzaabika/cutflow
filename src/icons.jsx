// Cutflow icon set — original line icons drawn for this app (2026 redesign).
//
// One coherent hand of drawing for every glyph:
//   · a 24 × 24 grid, strokes in currentColor at 1.8 weight, round caps and joins;
//   · shapes built from straight runs, arcs and circles at optical sizes, so the
//     set reads as one family at 12 px and at 26 px alike;
//   · solid marks (play, pause, the dots) fill instead of stroking, by the same
//     geometry — never a second style.
// Every icon is a component with the contract the app already uses:
// <Icon size={n} className style ... /> — extra props land on the <svg>.
import React from 'react';

const ic = (children) => function CfIcon({ size = 24, className, style, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      className={className} style={style} aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  );
};
const dot = (cx, cy, r = 1.15) => <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />;

/* ---- arrows, chevrons, history ---- */
export const ChevronDown = ic(<path d="M4.8 9.3 12 16.7 19.2 9.3" />);
export const ChevronUp = ic(<path d="M4.8 14.7 12 7.3l7.2 7.4" />);
export const ChevronLeft = ic(<path d="M14.7 4.8 7.3 12l7.4 7.2" />);
export const ChevronRight = ic(<path d="M9.3 4.8 16.7 12l-7.4 7.2" />);
export const ChevronsLeft = ic(<><path d="M11.4 4.8 4 12l7.4 7.2" /><path d="M20.4 4.8 13 12l7.4 7.2" /></>);
export const ChevronsRight = ic(<><path d="M3.6 4.8 11 12l-7.4 7.2" /><path d="M12.6 4.8 20 12l-7.4 7.2" /></>);
export const ArrowUp = ic(<><path d="M12 20.2V5" /><path d="M5.8 11.2 12 4.6l6.2 6.6" /></>);
export const ArrowLeftRight = ic(<><path d="M4 7.8h12.6" /><path d="M13.4 4.2 17 7.8l-3.6 3.6" /><path d="M20 16.2H7.4" /><path d="M10.6 12.6 7 16.2l3.6 3.6" /></>);
export const ArrowLeftToLine = ic(<><path d="M5.2 4v16" /><path d="M20 12H8.6" /><path d="M12.8 6.2 7 12l5.8 5.8" /></>);
export const ArrowRightToLine = ic(<><path d="M18.8 4v16" /><path d="M4 12h11.4" /><path d="M11.2 6.2 17 12l-5.8 5.8" /></>);
export const Undo2 = ic(<><path d="M8.6 5 4.2 9.4 8.6 13.8" /><path d="M4.4 9.4h9.1a5.9 5.9 0 1 1-5.9 5.9" /></>);
export const Redo2 = ic(<><path d="M15.4 5l4.4 4.4-4.4 4.4" /><path d="M19.6 9.4h-9.1a5.9 5.9 0 1 0 5.9 5.9" /></>);
export const RotateCcw = ic(<><path d="M4.2 3.8v4.8h4.8" /><path d="M4.7 12.4a7.7 7.7 0 1 1 2.1 5.3" /></>);
export const RotateCw = ic(<><path d="M19.8 3.8v4.8h-4.8" /><path d="M19.3 12.4a7.7 7.7 0 1 0-2.1 5.3" /></>);
export const RefreshCw = ic(<><path d="M19.9 12a8 8 0 0 0-13.6-5.4" /><path d="M5.9 3.2v4.4h4.4" /><path d="M4.1 12a8 8 0 0 0 13.6 5.4" /><path d="M18.1 20.8v-4.4h-4.4" /></>);
export const History = ic(<><path d="M4 4.6v4.4h4.4" /><path d="M4.3 12.2a8 8 0 1 1 2.2 5.6" /><path d="M12 8v4.4l3.1 1.9" /></>);
export const Copyright = ic(<><circle cx="12" cy="12" r="8.6" /><path d="M14.7 8.6A4.4 4.4 0 1 0 14.7 15.4" /></>);

/* ---- transport & playback ---- */
export const Play = ic(<path d="M8 5.1v13.8c0 .9 1 1.5 1.8 1L19.1 13a1.25 1.25 0 0 0 0-2L9.8 4.1C9 3.6 8 4.2 8 5.1Z" />);
export const Pause = ic(<><rect x="6.4" y="4.6" width="3.9" height="14.8" rx="1.5" fill="currentColor" stroke="none" /><rect x="13.7" y="4.6" width="3.9" height="14.8" rx="1.5" fill="currentColor" stroke="none" /></>);
export const SkipBack = ic(<><path d="M6.2 5.4v13.2" /><path d="M18.6 6.4 9.8 12l8.8 5.6Z" /></>);
export const SkipForward = ic(<><path d="M17.8 5.4v13.2" /><path d="M5.4 6.4 14.2 12l-8.8 5.6Z" /></>);
export const Rewind = ic(<><path d="M11.2 6.4 5.4 12l5.8 5.6Z" /><path d="M19.6 6.4 13.8 12l5.8 5.6Z" /></>);
export const Repeat = ic(<><path d="M17.4 3.8 20.6 7l-3.2 3.2" /><path d="M20.4 7H7.2a3.6 3.6 0 0 0-3.6 3.6v.9" /><path d="M6.6 20.2 3.4 17l3.2-3.2" /><path d="M3.6 17h13.2a3.6 3.6 0 0 0 3.6-3.6v-.9" /></>);
export const Shuffle = ic(<><path d="M3.8 6.8h3.2c4.8 0 6.6 10.4 11.4 10.4h2" /><path d="M17.7 14.4l2.9 2.8-2.9 2.8" /><path d="M3.8 17.2h3.2c2 0 3.4-1.9 4.8-4.1" /><path d="M14.5 9.7c1-1.6 2.2-2.9 3.9-2.9h2" /><path d="M17.7 4l2.9 2.8-2.9 2.8" /></>);
export const Volume2 = ic(<><path d="M4 9.7v4.6h3.3L12.2 19V5L7.3 9.7H4Z" /><path d="M15.6 9.7a3.5 3.5 0 0 1 0 4.6" /><path d="M18.4 7.4a6.8 6.8 0 0 1 0 9.2" /></>);
export const VolumeX = ic(<><path d="M4 9.7v4.6h3.3L12.2 19V5L7.3 9.7H4Z" /><path d="M16 9.7l5.2 5.3" /><path d="M21.2 9.7 16 15" /></>);

/* ---- marks, checks, status ---- */
export const Check = ic(<path d="M4.4 12.6 9.9 17.9 19.6 6.3" />);
export const X = ic(<path d="M5.8 5.8l12.4 12.4M18.2 5.8 5.8 18.2" />);
export const Plus = ic(<path d="M12 4.8v14.4M4.8 12h14.4" />);
export const Circle = ic(<circle cx="12" cy="12" r="8.6" />);
export const CircleCheck = ic(<><circle cx="12" cy="12" r="8.6" /><path d="M8.1 12.5l2.7 2.7 5.3-5.7" /></>);
export const CheckCircle2 = ic(<><circle cx="12" cy="12" r="8.6" /><circle cx="12" cy="12" r="4.9" strokeDasharray="2.6 2.8" /><path d="M10.2 12.3l1.4 1.4 2.3-2.5" /></>);
export const CircleAlert = ic(<><circle cx="12" cy="12" r="8.6" /><path d="M12 7.4v5.4" />{dot(12, 16.5, 1.05)}</>);
export const Info = ic(<><circle cx="12" cy="12" r="8.6" /><path d="M12 11v5.4" />{dot(12, 7.7, 1.05)}</>);
export const Ban = ic(<><circle cx="12" cy="12" r="8.6" /><path d="M6 6l12 12" /></>);
export const Star = ic(<path d="M12 3.7l2.35 5.25 5.75.6-4.25 3.9 1.15 5.65L12 16.85l-4.95 2.25 1.1-5.65L3.9 9.55l5.75-.6Z" />);
export const Heart = ic(<path d="M12 20.3C6.2 16.6 3.6 13.3 3.6 9.9A4.6 4.6 0 0 1 12 6.6a4.6 4.6 0 0 1 8.4 3.3c0 3.4-2.6 6.7-8.4 10.4Z" />);
export const Zap = ic(<path d="M13.4 2.6 4.6 13.9h5.7l-1 7.5 8.7-11.3h-5.8Z" />);
export const Sparkles = ic(<><path d="M11 3.8c.6 4.9 2.3 7 6.6 8.2-4.3 1.2-6 3.3-6.6 8.2-.6-4.9-2.3-7-6.6-8.2 4.3-1.2 6-3.3 6.6-8.2Z" /><path d="M18.6 14.6c.28 2.1 1 3 3 3.6-2 .6-2.72 1.5-3 3.6-.28-2.1-1-3-3-3.6 2-.6 2.72-1.5 3-3.6Z" /></>);
export const Diamond = ic(<path d="M12 3.4 20.4 12 12 20.6 3.6 12Z" />);
export const Flag = ic(<><path d="M5.6 21.6V2.8" /><path d="M5.6 3.4c3.4-1.9 5.9 1.5 9.4-.1v8.4c-3.5 1.6-6-1.8-9.4.1" /></>);
export const Target = ic(<><circle cx="12" cy="12" r="8.6" /><circle cx="12" cy="12" r="4.9" />{dot(12, 12, 1.5)}</>);
export const Crosshair = ic(<><circle cx="12" cy="12" r="6.4" /><path d="M12 2.7v3.5M12 17.8v3.5M2.7 12h3.5M17.8 12h3.5" />{dot(12, 12, 0.95)}</>);

/* ---- files, folders, transfer ---- */
export const FolderOpen = ic(<><path d="M3.6 8.6V6.8A1.8 1.8 0 0 1 5.4 5h3.9l2 2.5h7.3a1.8 1.8 0 0 1 1.8 1.8v1" /><path d="M3.1 12.6h17.8l-1.8 5.9a1.9 1.9 0 0 1-1.8 1.4H6.7a1.9 1.9 0 0 1-1.8-1.4Z" /></>);
export const FolderPlus = ic(<><path d="M3.8 18.6V6.8A1.8 1.8 0 0 1 5.6 5h3.9l2 2.5h6.9a1.8 1.8 0 0 1 1.8 1.8v9.3a1.8 1.8 0 0 1-1.8 1.8H5.6a1.8 1.8 0 0 1-1.8-1.8Z" /><path d="M12 11.4v5.4M9.3 14.1h5.4" /></>);
export const Download = ic(<><path d="M12 3.8v10.8" /><path d="M6.2 9.6 12 15.4l5.8-5.8" /><path d="M4.4 19.8h15.2" /></>);
export const Upload = ic(<><path d="M12 14.6V3.8" /><path d="M6.2 9.4 12 3.6l5.8 5.8" /><path d="M4.4 19.8h15.2" /></>);
export const Import = ic(<><path d="M12 3.4v9.4" /><path d="M6.9 8.6 12 13.7l5.1-5.1" /><path d="M4.4 15.4v3.4a1.9 1.9 0 0 0 1.9 1.9h11.4a1.9 1.9 0 0 0 1.9-1.9v-3.4" /></>);
export const Save = ic(<><path d="M5.2 3.8h11.3l3.7 3.7v11.3a1.6 1.6 0 0 1-1.6 1.6H5.4a1.6 1.6 0 0 1-1.6-1.6V5.4a1.6 1.6 0 0 1 1.4-1.6Z" /><path d="M8 3.8v4.8h7.4V3.8" /><path d="M8 20.4v-6.8h8v6.8" /></>);
export const Copy = ic(<><rect x="9.2" y="9.2" width="11" height="11" rx="2" /><path d="M14.8 5.8v-.6A1.6 1.6 0 0 0 13.2 3.6H5.4a1.6 1.6 0 0 0-1.6 1.6v7.8a1.6 1.6 0 0 0 1.6 1.6h.6" /></>);
export const CopyPlus = ic(<><rect x="9.5" y="9.5" width="10.7" height="10.7" rx="2" /><path d="M5.4 15.2A1.7 1.7 0 0 1 3.8 13.5v-8A1.7 1.7 0 0 1 5.5 3.8h8A1.7 1.7 0 0 1 15.2 5.5v.2" /><path d="M14.9 12.4v5M12.4 14.9h5" /></>);
export const ClipboardPaste = ic(<><rect x="5.2" y="4.6" width="13.6" height="16.6" rx="2" /><path d="M9.2 4.6a2.8 2.8 0 0 1 5.6 0" /><path d="M9 13.2h6.4M9 16.8h4.4" /></>);
export const Trash2 = ic(<><path d="M3.9 6.7h16.2" /><path d="M9.4 6.7V4.9A1 1 0 0 1 10.4 3.9h3.2a1 1 0 0 1 1 1v1.8" /><path d="M5.9 6.7l.9 12.3a1.9 1.9 0 0 0 1.9 1.7h6.6a1.9 1.9 0 0 0 1.9-1.7l.9-12.3" /><path d="M10 10.6v6.4M14 10.6v6.4" /></>);
export const ExternalLink = ic(<><path d="M13.6 4.4h5.9v5.9" /><path d="M18.7 5.3 11.2 12.8" /><path d="M19.4 13.9v5A1.7 1.7 0 0 1 17.7 20.6H5.7A1.7 1.7 0 0 1 4 18.9v-12A1.7 1.7 0 0 1 5.7 5.2h5" /></>);
export const Link2 = ic(<><path d="M10.6 13.4a4.1 4.1 0 0 0 5.8 0l2.9-2.9a4.1 4.1 0 1 0-5.8-5.8l-1.4 1.4" /><path d="M13.4 10.6a4.1 4.1 0 0 0-5.8 0l-2.9 2.9a4.1 4.1 0 1 0 5.8 5.8l1.4-1.4" /></>);
export const Unlink = ic(<><path d="M10.6 13.4a4.1 4.1 0 0 0 4.9.6l2.9-2.9a4.1 4.1 0 1 0-5-5.4" /><path d="M13.4 10.6a4.1 4.1 0 0 0-4.9-.6l-2.9 2.9a4.1 4.1 0 1 0 5 5.4" /><path d="M9.2 3.4 7.8 6.2M14.8 20.6l1.4-2.8" /></>);

/* ---- media & stage ---- */
export const Film = ic(<><rect x="3.4" y="3.8" width="17.2" height="16.4" rx="2" /><path d="M8.1 3.8v16.4M15.9 3.8v16.4" /><path d="M3.4 8.1h4.7M3.4 12h4.7M3.4 15.9h4.7M15.9 8.1h4.7M15.9 12h4.7M15.9 15.9h4.7" /></>);
export const Clapperboard = ic(<><path d="M3.6 10.4h16.8v8.2a1.7 1.7 0 0 1-1.7 1.7H5.3a1.7 1.7 0 0 1-1.7-1.7Z" /><path d="M4.1 4.6 20 3.4l.5 4L4.6 8.6Z" /><path d="M8.3 4.9 6.9 8.4M13 4.4l-1.4 4M17.7 3.9l-1.4 4" /></>);
export const Video = ic(<><rect x="2.9" y="6.4" width="13.6" height="11.6" rx="2" /><path d="M16.5 10.7l4.7-2.9v8.8l-4.7-2.9" /></>);
export const Camera = ic(<><rect x="2.9" y="7.4" width="18.2" height="12.2" rx="2" /><path d="M8.8 7.4 10.1 4.9h3.8l1.3 2.5" /><circle cx="12" cy="13.5" r="3.4" />{dot(17.7, 10.3, 0.85)}</>);
export const Image = ic(<><rect x="3.4" y="4.9" width="17.2" height="14.2" rx="2" /><circle cx="9" cy="9.9" r="1.5" /><path d="M3.4 17.1l5.2-4.7 3.9 3.3 2.7-2.3 5.4 4.5" /></>);
export const ImagePlus = ic(<><rect x="3.4" y="4.9" width="17.2" height="14.2" rx="2" /><circle cx="8.6" cy="9.6" r="1.35" /><path d="M3.6 16.8l4.6-4.1 3.2 2.7" /><path d="M18.9 13.9v6.4M15.7 17.1h6.4" /></>);
export const Music = ic(<><circle cx="6.9" cy="17.7" r="2.7" /><circle cx="16.9" cy="15.7" r="2.7" /><path d="M9.6 17.7V6.3l10-2.1v11.5" /></>);
export const AudioLines = ic(<path d="M4 10v4M8 6.8v10.4M12 3.8v16.4M16 8.6v6.8M20 10v4" />);
export const AudioWaveform = ic(<path d="M2.8 12h2.4l1.6-5.2 2.1 9.6 2.2-13 2.1 10.8 1.8-5.4 1.4 3.2h4.8" />);
export const FileAudio = ic(<><path d="M13.8 3.4v5.2h5.2" /><path d="M13.8 3.4H6.4a1.6 1.6 0 0 0-1.6 1.6v14a1.6 1.6 0 0 0 1.6 1.6h11.2a1.6 1.6 0 0 0 1.6-1.6V8.6" /><path d="M10.3 17.2v-4.4l4.9-1.1v4.1" /><circle cx="9" cy="17.2" r="1.35" /><circle cx="13.9" cy="15.8" r="1.35" /></>);
export const Mic = ic(<><rect x="9" y="2.9" width="6" height="11.2" rx="3" /><path d="M5.7 11.4a6.3 6.3 0 0 0 12.6 0" /><path d="M12 17.7v3.4M8.4 21.1h7.2" /></>);

/* ---- devices, system, windows ---- */
export const Monitor = ic(<><rect x="2.9" y="4.4" width="18.2" height="12.6" rx="2" /><path d="M12 17v3.2M7.9 20.6h8.2" /></>);
export const MonitorUp = ic(<><rect x="2.9" y="4.4" width="18.2" height="12.6" rx="2" /><path d="M12 13.6V8.2" /><path d="M8.9 11.1 12 7.9l3.1 3.2" /><path d="M12 17v3.2M7.9 20.6h8.2" /></>);
export const MonitorCog = ic(<><path d="M3.9 4.4h15.2a2 2 0 0 1 2 2V15" /><path d="M2.9 15.2V6.4a2 2 0 0 1 2-2" /><path d="M2.9 17h10.4M21.1 17h-3" /><path d="M9.5 20.6h4.5" /><circle cx="16.6" cy="17" r="2.1" /><path d="M16.6 13.7v1.5M16.6 18.8v1.5M13.3 17h1.5M17.9 17h1.5M14.3 14.7l1 1M17.9 18.3l1 1M18.9 14.7l-1 1M15.3 18.3l-1 1" /></>);
export const Smartphone = ic(<><rect x="7.4" y="2.9" width="9.2" height="18.2" rx="2" /><path d="M10.9 17.9h2.2" /></>);
export const AppWindow = ic(<><rect x="2.9" y="3.9" width="18.2" height="16.2" rx="2" /><path d="M2.9 9h18.2" />{dot(6.3, 6.5, 0.85)}{dot(9.6, 6.5, 0.85)}</>);
export const Server = ic(<><rect x="3.9" y="3.7" width="16.2" height="7.1" rx="1.8" /><rect x="3.9" y="13.2" width="16.2" height="7.1" rx="1.8" />{dot(7.4, 7.2, 1)}{dot(7.4, 16.7, 1)}</>);
export const Globe = ic(<><circle cx="12" cy="12" r="8.6" /><path d="M12 3.4c2.6 2.4 4 5.3 4 8.6s-1.4 6.2-4 8.6c-2.6-2.4-4-5.3-4-8.6s1.4-6.2 4-8.6Z" /><path d="M3.5 12h17" /></>);
export const WifiOff = ic(<><path d="M5.4 10.4a10.2 10.2 0 0 1 3.8-2.3M14.9 8.1a10.2 10.2 0 0 1 3.7 2.3" /><path d="M8.3 13.9a5.9 5.9 0 0 1 7.4 0" />{dot(12, 17.5, 1.15)}<path d="M3.8 3.8l16.4 16.4" /></>);
export const Keyboard = ic(<><rect x="2.7" y="6.4" width="18.6" height="11.2" rx="2" /><path d="M5.8 10h1.7M9.7 10h1.7M13.6 10h1.7M17.5 10h1.7M5.8 13.4h1.7M17.5 13.4h1.7M9.7 13.4h4.6" /></>);
export const Cable = ic(<><rect x="2.7" y="9.4" width="5.2" height="5.2" rx="1.2" /><rect x="16.1" y="9.4" width="5.2" height="5.2" rx="1.2" /><path d="M7.9 12c2.7 3 5.5 3 8.2 0" /><path d="M5.3 9.4V6.6M18.7 9.4V6.6" /></>);
export const Maximize = ic(<path d="M9.2 4H5.7A1.7 1.7 0 0 0 4 5.7v3.5M14.8 4h3.5A1.7 1.7 0 0 1 20 5.7v3.5M20 14.8v3.5a1.7 1.7 0 0 1-1.7 1.7h-3.5M4 14.8v3.5A1.7 1.7 0 0 0 5.7 20h3.5" />);
export const Minimize = ic(<path d="M9.4 3.9v3.4a1.7 1.7 0 0 1-1.7 1.7H4.2M20.1 9h-3.4a1.7 1.7 0 0 1-1.7-1.7V3.9M15 20.1v-3.4a1.7 1.7 0 0 1 1.7-1.7h3.4M4.2 15h3.4a1.7 1.7 0 0 1 1.7 1.7v3.4" />);
export const Gauge = ic(<><path d="M4.3 19.4a9.2 9.2 0 1 1 15.4 0" /><path d="M12 15.2 16.3 9.6" />{dot(12, 15.4, 1.2)}<path d="M5.4 15.6l1.9.7M18.6 15.6l-1.9.7M12 6.4v2" /></>);
export const Clock = ic(<><circle cx="12" cy="12" r="8.6" /><path d="M12 7.3V12l3.1 2" /></>);
export const Clock3 = ic(<><circle cx="12" cy="12" r="8.6" /><path d="M12 7v5.1h4.1" /></>);
export const Loader2 = ic(<path d="M12 3.4a8.6 8.6 0 1 1-8.3 9.9" />);
export const LoaderCircle = ic(<path d="M20.6 12a8.6 8.6 0 1 1-2.6-6.1" />);

/* ---- people, security, account ---- */
export const UserRound = ic(<><circle cx="12" cy="8" r="3.7" /><path d="M4.7 20.4a7.7 7.7 0 0 1 14.6 0" /></>);
export const Users = ic(<><circle cx="9.1" cy="8.4" r="3.3" /><path d="M3.2 19.9a6 6 0 0 1 11.8 0" /><path d="M15.6 5.4a3.3 3.3 0 0 1 0 6" /><path d="M17.9 14.1a6 6 0 0 1 2.9 5.8" /></>);
export const Lock = ic(<><path d="M8 11V7.4a4 4 0 0 1 8 0V11" /><rect x="5.4" y="11" width="13.2" height="9.6" rx="2" />{dot(12, 15.8, 1.3)}</>);
export const LockOpen = ic(<><path d="M8 11V7.4a4 4 0 0 1 7.9-.9" /><rect x="5.4" y="11" width="13.2" height="9.6" rx="2" />{dot(12, 15.8, 1.3)}</>);
export const KeyRound = ic(<><circle cx="8.4" cy="14.6" r="5.1" /><path d="M12.2 10.8 19.7 3.3" /><path d="M16.9 6.1l2.6 2.6M14.5 8.5l2.1 2.1" /></>);
export const ShieldCheck = ic(<><path d="M12 3.1 19.1 5.7v6.1c0 4.7-3 7.7-7.1 9.3-4.1-1.6-7.1-4.6-7.1-9.3V5.7Z" /><path d="M8.8 11.7l2.2 2.2 4.3-4.5" /></>);

/* ---- editing tools ---- */
export const Scissors = ic(<><circle cx="6.4" cy="6.7" r="2.6" /><circle cx="6.4" cy="17.3" r="2.6" /><path d="M8.6 8.5 19.6 17.6M8.6 15.5 19.6 6.4" /></>);
export const ScissorsLineDashed = ic(<><circle cx="6" cy="6.9" r="2.4" /><circle cx="6" cy="17.1" r="2.4" /><path d="M8.2 8.7 11.4 12M14.8 15.3l4 3.3" strokeDasharray="3 2.6" /><path d="M8.2 15.3 11.4 12M14.8 8.7l4-3.3" strokeDasharray="3 2.6" /></>);
export const Crop = ic(<path d="M6.4 2.7v14.9h14.9M2.7 6.4h14.9v14.9" />);
export const Slice = ic(<><path d="M3.9 20.2C5.9 12.9 12.4 6.3 19.7 3.5l1.6 1.6C18.5 12.4 11.9 18.9 4.6 20.9Z" /><path d="M7.6 16.6c2.9-1.4 5.7-4.2 7.6-7.7" /></>);
export const Eraser = ic(<><path d="M7.6 19.6 18.9 8.3a1.7 1.7 0 0 0 0-2.4l-2-2a1.7 1.7 0 0 0-2.4 0L5.7 12.7a1.7 1.7 0 0 0 .1 2.5l2.9 2.9a2.4 2.4 0 0 0 1.7.7h2.4" /><path d="M3.9 19.7h16.2" /></>);
export const Pipette = ic(<><path d="M19.9 2.6a2.1 2.1 0 0 1 3 3L13.2 15.3l-3.5-.7-.7-3.5Z" /><path d="M16.9 5.6l1.5-1.5M9 11.1l-1.6-1.6 2.3-2.3 3.5 3.5" /><path d="M6.1 15.7c-1 1.3-1.9 2.6-1.9 3.8a1.95 1.95 0 0 0 3.9 0c0-1.2-.9-2.5-2-3.8Z" /></>);
export const Paintbrush = ic(<><path d="M14.6 4.1 19.9 9.4 12.4 16.9a2.2 2.2 0 0 1-3.1 0L7.9 15.5a2.2 2.2 0 0 1 0-3.1Z" /><path d="M8.1 14.7c-1.9.6-3.1 2-3.3 4.3 2.3-.2 3.7-1.4 4.3-3.3" /></>);
export const Palette = ic(<><path d="M12 3.7a8.3 8.3 0 1 0 0 16.6c1.2 0 2-.9 2-2 0-.7-.4-1.2-.4-2 0-1 .8-1.8 1.8-1.8h1.9a4.2 4.2 0 0 0 4.2-4.2C21.5 6.9 17.2 3.7 12 3.7Z" />{dot(7.9, 10.1, 1.2)}{dot(12, 7.6, 1.2)}{dot(16.1, 10.1, 1.2)}{dot(9.2, 14.6, 1.2)}</>);
export const Pencil = ic(<><path d="M4.4 19.6l1-4.3L16.9 3.8a1.95 1.95 0 0 1 2.8 0l.5.5a1.95 1.95 0 0 1 0 2.8L8.7 18.6Z" /><path d="M14.9 5.8l3.1 3.1" /></>);
export const Magnet = ic(<><path d="M6.4 3.7v7.4a5.6 5.6 0 0 0 11.2 0V3.7" /><path d="M6.4 3.7h3.9v4.5H6.4ZM13.7 3.7h3.9v4.5h-3.9Z" /></>);
export const Blend = ic(<><circle cx="9" cy="12" r="5.6" /><circle cx="15" cy="12" r="5.6" /></>);
export const Eye = ic(<><path d="M2.7 12S5.9 5.7 12 5.7 21.3 12 21.3 12 18.1 18.3 12 18.3 2.7 12 2.7 12Z" /><circle cx="12" cy="12" r="3.1" /></>);
export const EyeOff = ic(<><path d="M6.6 6.9A9.4 9.4 0 0 1 12 5.7c6.1 0 9.3 6.3 9.3 6.3a17.4 17.4 0 0 1-3.4 3.9M17.5 17a9.6 9.6 0 0 1-5.5 1.3c-6.1 0-9.3-6.3-9.3-6.3a17.7 17.7 0 0 1 3.2-3.8" /><path d="M9.9 9.7a3.1 3.1 0 0 0 4.5 4.2M4.2 4.2l15.6 15.6" /></>);
export const Split = ic(<><circle cx="6" cy="5.4" r="2.3" /><circle cx="6" cy="18.6" r="2.3" /><circle cx="18" cy="7.4" r="2.3" /><path d="M6 7.7v8.6M18 9.7v2.1a4.1 4.1 0 0 1-4.1 4.1H8.3" /></>);
export const FlipHorizontal2 = ic(<><path d="M9.6 6.3 4.3 12l5.3 5.7Z" /><path d="M14.4 6.3 19.7 12l-5.3 5.7Z" /><path d="M12 3.4v17.2" strokeDasharray="2.4 2.8" /></>);

/* ---- layout, panels, lists ---- */
export const Layers = ic(<><path d="M12 3.7 20.6 8.5 12 13.3 3.4 8.5Z" /><path d="M3.8 12.7 12 17.5l8.2-4.8" /><path d="M3.8 16.5 12 21.3l8.2-4.8" /></>);
export const LayoutTemplate = ic(<><rect x="3.4" y="4.4" width="17.2" height="15.2" rx="2" /><path d="M3.4 9.6h17.2M9.6 9.6v10" /></>);
export const PanelBottom = ic(<><rect x="3.4" y="4.4" width="17.2" height="15.2" rx="2" /><path d="M3.4 15h17.2" /></>);
export const BetweenHorizontalStart = ic(<><path d="M3.6 3.4v17.2" /><rect x="7.9" y="4.9" width="12.2" height="5.6" rx="1.2" /><rect x="7.9" y="13.5" width="12.2" height="5.6" rx="1.2" /></>);
export const RectangleVertical = ic(<rect x="6.9" y="3.4" width="10.2" height="17.2" rx="1.6" />);
export const Square = ic(<rect x="5.4" y="5.4" width="13.2" height="13.2" rx="1.6" />);
export const SquareDashed = ic(<rect x="5.4" y="5.4" width="13.2" height="13.2" rx="1.6" strokeDasharray="3.8 3.2" />);
export const StretchHorizontal = ic(<><path d="M3.4 12h5.2M20.6 12h-5.2" /><path d="M6.2 8.7 3.2 12l3 3.3M17.8 8.7l3 3.3-3 3.3" /><path d="M9.6 8.4v7.2M14.4 8.4v7.2" /></>);
export const ListChecks = ic(<><path d="M3.3 6.4 4.8 7.9 7.4 5" /><path d="M3.3 15.2l1.5 1.5 2.6-2.9" /><path d="M11 6.9h9.6M11 15.7h9.6" /></>);
export const LayoutGrid = ic(<><rect x="4" y="4" width="7" height="7" rx="1.6" /><rect x="13" y="4" width="7" height="7" rx="1.6" /><rect x="4" y="13" width="7" height="7" rx="1.6" /><rect x="13" y="13" width="7" height="7" rx="1.6" /></>);
export const ListRows = ic(<><path d="M9.2 6.2h10.6M9.2 12h10.6M9.2 17.8h10.6" />{dot(4.4, 6.2)}{dot(4.4, 12)}{dot(4.4, 17.8)}</>);
export const GripVertical = ic(<>{dot(9.4, 6.8)}{dot(14.6, 6.8)}{dot(9.4, 12)}{dot(14.6, 12)}{dot(9.4, 17.2)}{dot(14.6, 17.2)}</>);
export const MoreHorizontal = ic(<>{dot(5.4, 12, 1.45)}{dot(12, 12, 1.45)}{dot(18.6, 12, 1.45)}</>);
export const MoreVertical = ic(<>{dot(12, 5.4, 1.45)}{dot(12, 12, 1.45)}{dot(12, 18.6, 1.45)}</>);
export const MousePointer2 = ic(<path d="M5.4 3.7 19.3 12.4l-7.5 1.1-2.9 6.8Z" />);
export const Search = ic(<><circle cx="11" cy="11" r="6.6" /><path d="M15.9 15.9 20.6 20.6" /></>);
export const ZoomIn = ic(<><circle cx="11" cy="11" r="6.6" /><path d="M15.9 15.9 20.6 20.6" /><path d="M11 8.4v5.2M8.4 11h5.2" /></>);
export const ZoomOut = ic(<><circle cx="11" cy="11" r="6.6" /><path d="M15.9 15.9 20.6 20.6" /><path d="M8.4 11h5.2" /></>);

/* ---- text & type ---- */
export const Type = ic(<path d="M4.4 5.6V4h15.2v1.6M12 4v16.2M8.7 20.2h6.6" />);
export const Bold = ic(<><path d="M7 4.6v14.8" /><path d="M7 4.6h5.7a3.1 3.1 0 0 1 0 6.2H7" /><path d="M7 10.8h6.6a3.55 3.55 0 0 1 0 7.1H7" /></>);
export const Italic = ic(<path d="M10.2 4.4h6.8M7 19.6h6.8M13.6 4.4 10.4 19.6" />);
export const Underline = ic(<><path d="M6.2 4.4v6.3a5.8 5.8 0 0 0 11.6 0V4.4" /><path d="M5.4 20.2h13.2" /></>);
export const CaseUpper = ic(<><path d="M3.9 18.2 8.4 6.1l4.5 12.1" /><path d="M6 13.6h4.8" /><circle cx="16.9" cy="14.3" r="2.9" /><path d="M19.8 11.5v5.7" /></>);
export const AlignLeft = ic(<path d="M3.8 6h16.4M3.8 12h9.8M3.8 18h13.4" />);
export const AlignCenter = ic(<path d="M3.8 6h16.4M7.1 12h9.8M5.3 18h13.4" />);
export const AlignRight = ic(<path d="M3.8 6h16.4M10.4 12h9.8M6.8 18h13.4" />);
export const Captions = ic(<><rect x="2.9" y="5.4" width="18.2" height="13.2" rx="2" /><path d="M6.4 10.1h4.2M13.6 10.1h4M6.4 13.9h6.8" /></>);
export const Languages = ic(<><path d="M3.9 6.4h9.2M8.5 4.2v2.2c0 3.6-2.1 7-4.5 9" /><path d="M5.8 9.6c1.3 2.5 3.5 4.6 6.2 5.9" /><path d="M13.9 20.3 18 10.9l4.1 9.4" /><path d="M15.4 17h5.2" /></>);

/* ---- wand, forge, brand ---- */
export const Wand2 = ic(<><path d="M4.4 19.6 15.2 8.8" /><path d="M17.9 3.1c.3 2 1 2.8 2.9 3.1-1.9.3-2.6 1.1-2.9 3.1-.3-2-1-2.8-2.9-3.1 1.9-.3 2.6-1.1 2.9-3.1Z" /><path d="M19.6 13.4v3.1M18 15h3.1" /></>);
export const WandSparkles = ic(<><path d="M4.2 19.8 14.3 9.7" /><path d="M17.4 2.9c.3 2.1 1.1 2.9 3 3.3-1.9.4-2.7 1.2-3 3.3-.3-2.1-1.1-2.9-3-3.3 1.9-.4 2.7-1.2 3-3.3Z" /><path d="M20.3 11.9c.2 1.5.8 2.1 2.1 2.4-1.3.3-1.9.9-2.1 2.4-.2-1.5-.8-2.1-2.1-2.4 1.3-.3 1.9-.9 2.1-2.4Z" /><path d="M8.6 3.4l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9Z" /></>);
export const Anvil = ic(<><path d="M3.4 5.4h17.2" /><path d="M12 5.4v2.5" /><path d="M7.1 7.9h9.8l-1.6 4.5a3.5 3.5 0 0 1-6.6 0Z" /><path d="M12 15.9v2" /><path d="M8.9 17.9h6.2l.7 2.7H8.2Z" /></>);
export const Award = ic(<><circle cx="12" cy="9.2" r="5.4" />{dot(12, 9.2, 1.3)}<path d="M8.9 13.6 7.1 20.4l4.9-2.5 4.9 2.5-1.8-6.8" /></>);
/* P6 (2026-11-10): one icon = one meaning. Star means Favourite and nothing
   else, so Stickers got their own glyph — a smiling sticker sheet with the
   bottom-right corner peeled — and Brand a swatch book (a bound book with
   fanned colour tabs on its fore-edge). Drawn in the set's stroke hand. */
export const Sticker = ic(<><path d="M7.5 4.5h9a3 3 0 0 1 3 3v6.1l-6.1 5.9H7.5a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3Z" /><path d="M13.4 19.5v-3.3a2.7 2.7 0 0 1 2.7-2.7h3.4" />{dot(9.4, 10.3, 1.15)}{dot(14.6, 10.3, 1.15)}<path d="M9.2 13.4a5 5 0 0 0 5.6 0" /></>);
export const SwatchBook = ic(<><path d="M6.2 5.4A1.9 1.9 0 0 1 8.1 3.5h7.2v17H8.1a1.9 1.9 0 0 1-1.9-1.9Z" /><path d="M6.2 17.3a1.9 1.9 0 0 1 1.9-1.9h7.2" /><path d="M15.3 6.9l3.8-.8M15.3 11h4M15.3 15.1l3.8.8" /></>);
export const Bot = ic(<><rect x="4.4" y="8.2" width="15.2" height="11" rx="2.6" /><path d="M12 8.2V4.9" />{dot(12, 3.6, 1.15)}{dot(9, 13.2, 1.2)}{dot(15, 13.2, 1.2)}<path d="M9.6 16.6h4.8" /></>);
export const Coffee = ic(<><path d="M5 9.4h11.1v5.1a4.9 4.9 0 0 1-4.9 4.9h-1.3A4.9 4.9 0 0 1 5 14.5Z" /><path d="M16.1 10.4h1.2a2.95 2.95 0 0 1 0 5.9h-1.2" /><path d="M3.9 21.2h13.4" /><path d="M8.4 3.4c0 1.2 1 1.4 1 2.6M12.6 3.4c0 1.2 1 1.4 1 2.6" /></>);
export const Compass = ic(<><circle cx="12" cy="12" r="8.6" /><path d="M15.6 8.4 13.3 13.3 8.4 15.6l2.3-4.9Z" />{dot(12, 12, 0.9)}</>);
export const Contrast = ic(<><circle cx="12" cy="12" r="8.6" /><path d="M12 3.9a8.1 8.1 0 0 1 0 16.2Z" fill="currentColor" stroke="none" /></>);
export const Snowflake = ic(<><path d="M12 3v18M5 7.5l14 9M19 7.5l-14 9" /><path d="M12 3 10 5M12 3l2 2M12 21l-2-2M12 21l2-2" /></>);

/* ---- settings & sliders ---- */
export const Settings = ic(<><circle cx="12" cy="12" r="3.1" /><circle cx="12" cy="12" r="5.7" /><path d="M12 2.5v2.3M12 19.2v2.3M2.5 12h2.3M19.2 12h2.3M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" /></>);
export const Settings2 = ic(<><path d="M6.8 3.8v5.4M6.8 14.4v5.8M12 3.8v1.6M12 10.6v9.6M17.2 3.8v8.6M17.2 17.6v2.6" /><circle cx="6.8" cy="11.8" r="2.1" /><circle cx="12" cy="8" r="2.1" /><circle cx="17.2" cy="15" r="2.1" /></>);
export const SlidersHorizontal = ic(<><path d="M3.4 6.8h5.9M15.5 6.8h5.1M3.4 12h11.1M18.7 12h1.9M3.4 17.2h2.9M10.5 17.2h10.1" /><circle cx="12.4" cy="6.8" r="2.1" /><circle cx="16.6" cy="12" r="2.1" /><circle cx="8.4" cy="17.2" r="2.1" /></>);

/* ---- misc chrome ---- */
export const Home = ic(<><path d="M3.9 11.3 12 3.9l8.1 7.4" /><path d="M5.9 9.7v10.2h12.2V9.7" /><path d="M10 19.9v-5.1h4v5.1" /></>);
export const Instagram = ic(<><rect x="3.9" y="3.9" width="16.2" height="16.2" rx="4.6" /><circle cx="12" cy="12" r="3.9" />{dot(17.1, 6.9, 1)}</>);
export const MessageCircle = ic(<path d="M12 4.1c4.9 0 8.4 3.3 8.4 7.4s-3.5 7.4-8.4 7.4c-1 0-2-.2-2.9-.5L4.2 20l1-3.2a8 8 0 0 1-1.5-4.3c0-4.1 3.5-7.4 8.3-7.4Z" />);
export const MessageSquarePlus = ic(<><path d="M20.6 15.3V5.4A1.6 1.6 0 0 0 19 3.8H5A1.6 1.6 0 0 0 3.4 5.4v9.9A1.6 1.6 0 0 0 5 16.9h1.9v3.9l4.3-3.9H19a1.6 1.6 0 0 0 1.6-1.6Z" /><path d="M12 7.8v5.4M9.3 10.5h5.4" /></>);
export const Pin = ic(<><path d="M8.4 3.9h7.2l-.8 6.6 3 3.2v1.9H6.2v-1.9l3-3.2Z" /><path d="M12 15.6v5.5" /></>);
export const PinOff = ic(<><path d="M9.9 3.9h4.3l-.4 3.5M10.1 10.5l-1 1v2.1M14.7 10.6l2.5 2.7v1.9H8.6" /><path d="M12 15.2v5.9M3.9 3.9l16.2 16.2" /></>);

/* ---- semantic marks: drawn glyphs where the old UI printed an emoji ----
   Effect headers and timeline effect bars take the glyph of their effect
   FAMILY (the name beside it carries the specifics); FlowAI style cards take
   a glyph per style. Same hand, same stroke as the rest of the set. */
export const FX_GROUP_ICONS = {
  'Glitch & Digital': AudioWaveform,
  'Blur & Focus': Circle,
  'Distortion & Mirror': FlipHorizontal2,
  'Film & Vintage': Film,
  'Light & Glow': Sparkles,
  'Particles & Weather': Snowflake,
  'Motion': ArrowLeftRight,
};
export function FxGlyph({ group, size = 15 }) {
  const G = FX_GROUP_ICONS[group] || WandSparkles;
  return <G size={size} />;
}
export const STYLE_ICONS = {
  orbit: RefreshCw, crt: Monitor, hormozi: Captions, mrbeast: Zap,
  cinematic: Clapperboard, vlog: Video, podcast: Mic, minimal: Square,
  glitch: AudioWaveform,
};
export function StyleGlyph({ id, size = 17 }) {
  const G = STYLE_ICONS[id] || WandSparkles;
  return <G size={size} />;
}
