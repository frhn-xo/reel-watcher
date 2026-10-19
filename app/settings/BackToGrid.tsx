"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

// Back arrow for the Settings header. A real "back" (not a fresh push to "/") so
// the grid's active view — filter pills + channel selection, which live in the
// URL — and its scroll position are restored exactly as they were left. Pushing
// "/" instead would land on a bare URL and force the grid to rebuild from the
// durable fallback, which races the fire-and-forget view write and can drop a
// just-set filter. Falls back to a plain push only when there's no in-app entry
// to pop (e.g. the app was opened directly on /settings).
export default function BackToGrid({ className }: { className?: string }) {
  const router = useRouter();

  const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (window.history.length > 1) router.back();
    else router.push("/");
  };

  return (
    <Link href="/" aria-label="Back to grid" onClick={onClick} className={className}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z" />
      </svg>
    </Link>
  );
}
