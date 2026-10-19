import { cx } from '@/lib/cx';

/**
 * Visitor-written (or staff-written) text, shown as TEXT and nothing else. It is a React child, so
 * React escapes it: markup in a message appears as characters, never as elements. Line breaks are
 * kept by CSS, long words wrap, and `dir="auto"` lets a right-to-left message read the right way.
 * Nothing in the enquiries screens uses dangerouslySetInnerHTML; this is the one place to look.
 */
export function PlainText({ text, className }: { text: string; className?: string }) {
  return (
    <p dir="auto" className={cx('text-[14px] leading-6 break-words whitespace-pre-wrap text-pd-ink', className)}>
      {text}
    </p>
  );
}
