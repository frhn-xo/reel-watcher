"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  saveProgress,
  markCompleted,
  shouldResume,
  getEntry,
  getRotation,
  saveRotation,
  getZoom,
  saveZoom,
  clampZoom,
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
  statusOf,
  useWatchHistory,
  type Rotation,
} from "@/lib/progress";
import type { Filter } from "@/lib/prefs";

export type PlaylistItem = {
  shortcode: string;
  title: string;
  views: string | null;
  channel: string;
};

// Speeds offered by the popup menu, fastest at the top (matches YouTube's order).
const SPEED_STEPS = [2, 1.75, 1.5, 1.25, 1, 0.75, 0.5, 0.25];

export default function ReelPlayer({
  playlist,
  startShortcode,
  filterChannels,
  filterMode,
  query,
}: {
  playlist: PlaylistItem[];
  startShortcode: string;
  filterChannels: string[] | null;
  filterMode: Filter;
  query: string;
}) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transformAnimTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(0); // throttle timeupdate writes (seconds)
  const resumedFor = useRef<string>(""); // shortcode we've already auto-resumed, so we do it once
  const currentCodeRef = useRef(startShortcode); // mirror of currentCode for async guards

  const [currentCode, setCurrentCode] = useState(startShortcode);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [flash, setFlash] = useState<string | null>(null);
  // When the <video> fails to load: "gone" = removed from IG (410, permanent),
  // "error" = transient (worth a retry). null = playing/ok. Reset on reel change.
  const [loadError, setLoadError] = useState<null | "gone" | "error">(null);
  const [entered, setEntered] = useState(false); // drives the fade-in on open
  const [speedMenu, setSpeedMenu] = useState(false); // YouTube-style speed popup
  const speedRef = useRef<HTMLDivElement>(null);
  const [displayMenu, setDisplayMenu] = useState(false); // rotate + zoom popup
  const displayRef = useRef<HTMLDivElement>(null);
  const [frameSize, setFrameSize] = useState({ w: 0, h: 0 }); // container box, for fit math
  const [natural, setNatural] = useState({ w: 0, h: 0 }); // intrinsic video dimensions
  // Animate the transform ONLY for an explicit user rotate/zoom. Restoring a saved
  // angle or zoom on load / reel-change must snap — otherwise the video visibly
  // "twists" or "jumps" from the default to the saved value on every refresh.
  const [animateTransform, setAnimateTransform] = useState(false);

  // Rotation is NOT mirrored into local state — it lives in watch history (one
  // source of truth, persisted per reel). useWatchHistory re-renders on every
  // write, so reading it here is both reactive and always current.
  const history = useWatchHistory();

  // The player plays through the SAME view the grid showed. Channel filtering is
  // deterministic (channel is in the data), so it's applied during render — server
  // and client agree. The opened reel is always kept so deep links still play.
  const channelFiltered = useMemo(() => {
    if (!filterChannels) return playlist;
    const set = new Set(filterChannels);
    return playlist.filter(
      (p) => set.has(p.channel) || p.shortcode === startShortcode
    );
  }, [playlist, filterChannels, startShortcode]);

  // Apply the seen/fresh filter against local watch history. Derived (not an
  // effect) so there's no cascading setState: useWatchHistory() returns {} on the
  // first render — server and client agree, no hydration mismatch — then populates
  // after mount. The opened reel AND the current reel are always kept, so finishing
  // a reel in the "Fresh" view (which flips it to seen) can never strand next/prev.
  const effective = useMemo(() => {
    if (filterMode === "all") return channelFiltered;
    const wantSeen = filterMode === "seen";
    return channelFiltered.filter(
      (p) =>
        p.shortcode === startShortcode ||
        p.shortcode === currentCode ||
        (statusOf(history[p.shortcode]) === "watched") === wantSeen
    );
  }, [channelFiltered, filterMode, startShortcode, currentCode, history]);

  const pos = effective.findIndex((p) => p.shortcode === currentCode);
  const item =
    effective[pos] ??
    playlist.find((p) => p.shortcode === currentCode) ??
    playlist[0];
  const hasPrev = pos > 0;
  const hasNext = pos >= 0 && pos < effective.length - 1;
  const rotation = (history[item.shortcode]?.rotation ?? 0) as Rotation;
  const zoom = history[item.shortcode]?.zoom ?? 1;

  // Write the current reel's position to local history (screen-agnostic resume).
  const persistCurrent = useCallback(() => {
    const v = videoRef.current;
    if (v && v.duration && isFinite(v.duration)) {
      saveProgress(item.shortcode, v.currentTime, v.duration);
    }
  }, [item.shortcode]);

  // Keep the URL in sync without a full navigation (shareable, back works).
  useEffect(() => {
    window.history.replaceState(
      null,
      "",
      `/watch/${item.shortcode}${query ? `?${query}` : ""}`
    );
  }, [item.shortcode, query]);

  // Play whenever the current reel changes. We DON'T call v.load() here: the
  // <video src> is a React-managed prop, so changing `index` changes `src`, and
  // the browser runs its own load algorithm automatically. Calling load() on top
  // of that races the React-driven source swap and can throw NotSupportedError
  // ("element has no supported sources"). So just (re)start playback, and swallow
  // the benign AbortError that fires when a play() is interrupted by the next load.
  useEffect(() => {
    const v = videoRef.current;
    currentCodeRef.current = currentCode;
    if (!v) return;
    lastSaved.current = 0; // allow the first timeupdate of the new reel to save
    v.play().catch(() => setPlaying(false));
  }, [currentCode]);

  // Persist position when the tab is hidden or the page is being left — so a
  // close/refresh mid-reel still resumes next time. (We deliberately avoid
  // `beforeunload`: it's unreliable for saving and disables the back/forward
  // cache. `visibilitychange` + `pagehide` cover close/refresh/tab-switch.)
  useEffect(() => {
    const save = () => persistCurrent();
    document.addEventListener("visibilitychange", save);
    window.addEventListener("pagehide", save);
    return () => {
      save(); // also on reel change / unmount
      document.removeEventListener("visibilitychange", save);
      window.removeEventListener("pagehide", save);
    };
  }, [persistCurrent]);

  // HARD STOP on unmount — the fix for "audio kept playing after I left the reel".
  // Detaching a <video> from the DOM does NOT reliably stop playback: browsers
  // keep the media (and its audio) alive until garbage collection. Pausing, on
  // the other hand, silences it immediately — so that's all we do here.
  //
  // We deliberately DON'T removeAttribute("src")+load(): React's Strict Mode
  // (on by default in dev) double-invokes effects — mount → cleanup → mount —
  // so this cleanup fires on first render and strips the src. Because `src` is a
  // JSX prop whose value never changed, React doesn't re-apply it on the second
  // mount, leaving the <video> permanently sourceless (networkState EMPTY, black
  // frame, 0:00/0:00). Pausing is non-destructive and survives the double-invoke.
  useEffect(() => {
    const v = videoRef.current;
    return () => {
      if (!v) return;
      try {
        v.pause();
      } catch {}
    };
  }, []);

  // Fade the player in on open so entering isn't a hard cut.
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Close the speed / display popups on outside click or Escape.
  useEffect(() => {
    if (!speedMenu && !displayMenu) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (speedRef.current && !speedRef.current.contains(t)) setSpeedMenu(false);
      if (displayRef.current && !displayRef.current.contains(t)) setDisplayMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSpeedMenu(false);
        setDisplayMenu(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [speedMenu, displayMenu]);

  // Track the player box so we can scale a 90°/270° rotation to fit (a rotated
  // portrait video is wider than the frame unless we shrink it to match).
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const measure = () =>
      setFrameSize({ w: c.clientWidth, h: c.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  // Keep the fullscreen icon honest even when the user exits via Esc or the OS.
  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  // Clear any pending auto-hide / flash timers on unmount, so no stray
  // setState fires after the player is gone.
  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      if (transformAnimTimer.current) clearTimeout(transformAnimTimer.current);
    };
  }, []);

  const goNext = useCallback(() => {
    persistCurrent();
    setLoadError(null); // leaving this reel clears any failure overlay it showed
    setCurrentCode((code) => {
      const i = effective.findIndex((p) => p.shortcode === code);
      return i >= 0 && i < effective.length - 1 ? effective[i + 1].shortcode : code;
    });
  }, [effective, persistCurrent]);
  const goPrev = useCallback(() => {
    persistCurrent();
    setLoadError(null);
    setCurrentCode((code) => {
      const i = effective.findIndex((p) => p.shortcode === code);
      return i > 0 ? effective[i - 1].shortcode : code;
    });
  }, [effective, persistCurrent]);

  const flashHint = useCallback((msg: string) => {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(
      () => setFlash((f) => (f === msg ? null : f)),
      600
    );
  }, []);

  // Turn the transform transition ON for one explicit user rotate/zoom, then OFF
  // again — so the change eases, but later restores (refresh / reel-change) snap
  // instead of visibly twisting or jumping from the default to the saved value.
  const flashTransformAnim = useCallback(() => {
    setAnimateTransform(true);
    if (transformAnimTimer.current) clearTimeout(transformAnimTimer.current);
    transformAnimTimer.current = setTimeout(() => setAnimateTransform(false), 250);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const skip = useCallback(
    (sec: number) => {
      const v = videoRef.current;
      if (!v) return;
      v.currentTime = Math.min(Math.max(0, v.currentTime + sec), v.duration || 0);
      flashHint(sec > 0 ? `+${sec}s` : `${sec}s`);
    },
    [flashHint]
  );

  const seekToFraction = useCallback((frac: number) => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    v.currentTime = v.duration * frac;
  }, []);

  const changeVolume = useCallback(
    (delta: number) => {
      const v = videoRef.current;
      if (!v) return;
      v.volume = Math.min(1, Math.max(0, v.volume + delta));
      if (v.volume > 0) v.muted = false;
      setMuted(v.muted);
      flashHint(`${Math.round(v.volume * 100)}%`);
    },
    [flashHint]
  );

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  const changeRate = useCallback(
    (dir: number) => {
      const v = videoRef.current;
      if (!v) return;
      const steps = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
      const i = steps.indexOf(v.playbackRate);
      const next = steps[Math.min(steps.length - 1, Math.max(0, (i === -1 ? 3 : i) + dir))];
      v.playbackRate = next;
      setRate(next);
      flashHint(`${next}×`);
    },
    [flashHint]
  );

  // Pick an exact speed from the YouTube-style popup menu.
  const setRateTo = useCallback((next: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = next;
    setRate(next);
    setSpeedMenu(false);
  }, []);

  // Rotate the display 90° clockwise and remember it for THIS reel, so broken
  // source orientation stays fixed next time you open it (even after a restart).
  const rotate = useCallback(() => {
    // Read the persisted angle (not the render snapshot) so rapid clicks still
    // accumulate correctly; the write fires the history event → re-render.
    const next = (((getRotation(item.shortcode) + 90) % 360) as Rotation);
    flashTransformAnim();
    saveRotation(item.shortcode, next);
    flashHint(`${next}°`);
  }, [item.shortcode, flashHint, flashTransformAnim]);

  // Step the display zoom for THIS reel (1 = fit-to-frame). Persisted per reel like
  // rotation — a reel's source resolution varies, so the preferred size does too.
  // Read the persisted value (not the render snapshot) so rapid clicks accumulate.
  const zoomBy = useCallback(
    (dir: number) => {
      const next = clampZoom(getZoom(item.shortcode) + dir * ZOOM_STEP);
      flashTransformAnim();
      saveZoom(item.shortcode, next);
      flashHint(`${Math.round(next * 100)}%`);
    },
    [item.shortcode, flashHint, flashTransformAnim]
  );

  // Restore this reel to the default display (no rotation, fit-to-frame).
  const resetDisplay = useCallback(() => {
    flashTransformAnim();
    saveRotation(item.shortcode, 0);
    saveZoom(item.shortcode, 1);
    flashHint("Reset");
  }, [item.shortcode, flashHint, flashTransformAnim]);

  const toggleFullscreen = useCallback(() => {
    const c = containerRef.current;
    if (!c) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else c.requestFullscreen?.();
  }, []);

  // Leave the player. Stop the video immediately (so audio dies the instant you
  // click, not after React gets around to unmounting), save the spot, exit
  // fullscreen, then return. If we came from the grid, history.back() restores it
  // with its scroll position intact; otherwise (deep link) fall back to the grid.
  const close = useCallback(() => {
    const v = videoRef.current;
    if (v) v.pause();
    persistCurrent();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    let cameFromGrid = false;
    try {
      cameFromGrid = sessionStorage.getItem("reel-watcher:from-grid") === "1";
      sessionStorage.removeItem("reel-watcher:from-grid");
    } catch {}
    if (cameFromGrid) router.back();
    else router.push("/");
  }, [router, persistCurrent]);

  // The <video> errored — find out why. The element can't expose the HTTP status,
  // so ask the stream for a 1-byte range: 410 means the reel was removed from
  // Instagram (permanent), anything else is a transient load failure (retryable).
  // Guarded by currentCodeRef so a result that lands after we've moved on is dropped.
  const diagnoseLoadError = useCallback(async (code: string) => {
    let kind: "gone" | "error" = "error";
    try {
      const res = await fetch(`/api/stream/${code}`, {
        headers: { Range: "bytes=0-0" },
        cache: "no-store",
      });
      res.body?.cancel().catch(() => {});
      if (res.status === 410) kind = "gone";
    } catch {
      kind = "error";
    }
    if (currentCodeRef.current === code) setLoadError(kind);
  }, []);

  // Retry a transient failure: clear the overlay and re-run the element's load.
  const retryLoad = useCallback(() => {
    setLoadError(null);
    const v = videoRef.current;
    if (v) {
      v.load();
      v.play().catch(() => setPlaying(false));
    }
  }, []);

  // Auto-hide controls while playing.
  const nudgeControls = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setShowControls(false);
    }, 2500);
  }, []);

  // YouTube keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      // Ignore browser/OS chords (Cmd+R refresh, Ctrl+L, Alt+←, …) — our plain
      // single-key shortcuts must never ride along with a modifier. Without this,
      // Cmd+R both refreshed AND fired `r` (rotate), so pages reloaded rotated.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === " " || k === "k") {
        e.preventDefault();
        togglePlay();
      } else if (k === "i") close(); // back to the For You grid (YouTube's `i`)
      else if (k === "f") toggleFullscreen();
      else if (k === "m") toggleMute();
      else if (k === "r") rotate();
      else if (k === "+" || k === "=") zoomBy(1);
      else if (k === "-" || k === "_") zoomBy(-1);
      else if (k === "ArrowLeft") {
        e.preventDefault();
        skip(-5);
        nudgeControls();
      } else if (k === "ArrowRight") {
        e.preventDefault();
        skip(5);
        nudgeControls();
      } else if (k === "j") skip(-10);
      else if (k === "l") skip(10);
      else if (k === "ArrowUp") {
        e.preventDefault();
        changeVolume(0.1);
      } else if (k === "ArrowDown") {
        e.preventDefault();
        changeVolume(-0.1);
      } else if (k === "Home") seekToFraction(0);
      else if (k === "End") seekToFraction(0.999);
      else if (k === ">" || (k === "." && e.shiftKey)) changeRate(1);
      else if (k === "<" || (k === "," && e.shiftKey)) changeRate(-1);
      else if (/^[0-9]$/.test(k)) seekToFraction(Number(k) / 10);
      else if (k === "N" && e.shiftKey) {
        if (hasNext) goNext();
      } else if (k === "P" && e.shiftKey) {
        if (hasPrev) goPrev();
      } else return;
      nudgeControls();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    close,
    togglePlay,
    toggleFullscreen,
    toggleMute,
    rotate,
    zoomBy,
    skip,
    changeVolume,
    seekToFraction,
    changeRate,
    hasNext,
    hasPrev,
    goNext,
    goPrev,
    nudgeControls,
  ]);

  const fmt = (s: number) => {
    if (!isFinite(s) || s < 0) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const controlsVisible = showControls || !playing;
  const pct = duration ? (current / duration) * 100 : 0;
  const bufPct = duration ? (buffered / duration) * 100 : 0;

  // Build the <video> transform from rotation + zoom. The base render is
  // fit-to-frame (object-contain), so `fitScale` is 1 at 0°/180°; for 90°/270° the
  // video's box is turned on its side, so we scale it to fit the frame first —
  // otherwise a rotated portrait reel spills past the edges. The per-reel zoom then
  // multiplies that fit (zoom 1 = exactly fit, >1 enlarges/crops, <1 shrinks).
  let fitScale = 1;
  const { w: fw, h: fh } = frameSize;
  const { w: nw, h: nh } = natural;
  if ((rotation === 90 || rotation === 270) && fw && fh && nw && nh) {
    const fit = Math.min(fw / nw, fh / nh); // how the video sits at 0°
    const rw = nw * fit;
    const rh = nh * fit;
    fitScale = Math.min(fw / rh, fh / rw); // shrink the sideways box to fit
  }
  const videoTransform = `rotate(${rotation}deg) scale(${fitScale * zoom})`;

  return (
    <div
      ref={containerRef}
      className="relative flex h-screen w-full select-none items-center justify-center overflow-hidden bg-black transition-opacity duration-300"
      onMouseMove={nudgeControls}
      onMouseLeave={() => playing && setShowControls(false)}
      style={{ cursor: controlsVisible ? "default" : "none", opacity: entered ? 1 : 0 }}
    >
      <video
        ref={videoRef}
        src={`/api/stream/${item.shortcode}`}
        poster={`/api/thumb/${item.shortcode}`}
        autoPlay
        playsInline
        className={`h-full w-full object-contain ${
          animateTransform ? "transition-transform duration-200" : ""
        }`}
        style={{ transform: videoTransform }}
        onClick={togglePlay}
        onPlay={() => {
          setPlaying(true);
          nudgeControls();
        }}
        onPause={() => {
          setPlaying(false);
          setShowControls(true);
        }}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          setCurrent(v.currentTime);
          // Save at most ~once every 2s of playback (and on any jump).
          if (Math.abs(v.currentTime - lastSaved.current) >= 2) {
            lastSaved.current = v.currentTime;
            saveProgress(item.shortcode, v.currentTime, v.duration);
          }
        }}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          setDuration(v.duration);
          v.playbackRate = rate;
          setNatural({ w: v.videoWidth, h: v.videoHeight });
          // Resume from where we left off — once per reel, from any entry point.
          if (resumedFor.current !== item.shortcode) {
            resumedFor.current = item.shortcode;
            const entry = getEntry(item.shortcode);
            if (shouldResume(entry) && entry!.position < v.duration - 1) {
              v.currentTime = entry!.position;
              flashHint(`Resuming ${fmt(entry!.position)}`);
            }
          }
        }}
        onProgress={(e) => {
          const v = e.currentTarget;
          if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
        }}
        onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
        onEnded={(e) => {
          markCompleted(item.shortcode, e.currentTarget.duration);
          if (hasNext) goNext();
          else setPlaying(false);
        }}
        onError={() => {
          setPlaying(false);
          diagnoseLoadError(item.shortcode);
        }}
      />

      {/* Load-failure overlay — a removed reel (gone) or a transient error. */}
      {loadError && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 bg-black/85 px-6 text-center backdrop-blur-sm">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="currentColor" className="text-neutral-500" aria-hidden>
            {loadError === "gone" ? (
              // slashed circle — unavailable
              <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2c1.85 0 3.55.63 4.9 1.69L5.69 16.9A8 8 0 0 1 12 4zm0 16a7.96 7.96 0 0 1-4.9-1.69L18.31 7.1A8 8 0 0 1 12 20z" />
            ) : (
              // warning triangle — something went wrong
              <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
            )}
          </svg>
          <div className="max-w-sm">
            <p className="text-lg font-semibold text-neutral-100">
              {loadError === "gone"
                ? "This reel is no longer available"
                : "Couldn’t load this reel"}
            </p>
            <p className="mt-1.5 text-sm text-neutral-400">
              {loadError === "gone"
                ? "It was removed, taken down, or made private on Instagram."
                : "Something went wrong reaching Instagram — it may be temporary."}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {loadError === "error" && (
              <button
                onClick={retryLoad}
                className="rounded-full bg-white px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
              >
                Retry
              </button>
            )}
            {hasNext && (
              <button
                onClick={goNext}
                className="rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-neutral-200 transition hover:border-white/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
              >
                Next reel
              </button>
            )}
            <button
              onClick={close}
              className="rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-neutral-200 transition hover:border-white/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
            >
              Back to grid
            </button>
          </div>
        </div>
      )}

      {/* skip flash hint */}
      {flash && (
        <div className="pointer-events-none absolute rounded-full bg-black/60 px-4 py-2 text-lg font-semibold text-white">
          {flash}
        </div>
      )}

      {/* big center play button when paused (hidden while an error overlay shows) */}
      {!playing && !loadError && (
        <button
          aria-label="Play"
          onClick={togglePlay}
          className="absolute grid h-20 w-20 place-items-center rounded-full bg-black/55 text-white backdrop-blur transition hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      )}

      {/* Back button — top-left, only while controls are visible */}
      <div
        className={`pointer-events-none absolute left-0 top-0 w-full p-4 transition-opacity duration-200 ${
          controlsVisible ? "opacity-100" : "opacity-0"
        }`}
      >
        <button
          onClick={close}
          className="pointer-events-auto flex items-center gap-1 rounded-full py-1 pl-1 pr-3 text-sm text-white/80 drop-shadow transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z" />
          </svg>
          Back to grid
        </button>
      </div>

      {/* Scrim — dark gradient behind the title so white text stays legible over light frames */}
      <div
        className={`pointer-events-none absolute bottom-0 left-0 h-1/3 w-full bg-gradient-to-t from-black/80 via-black/40 to-transparent transition-opacity duration-300 ${
          !playing ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Title block — bottom-left, shown only when PAUSED (streaming-app style) */}
      <div
        className={`pointer-events-none absolute bottom-24 left-0 w-full px-6 transition-opacity duration-300 ${
          !playing ? "opacity-100" : "opacity-0"
        }`}
      >
        <h1 className="text-3xl font-bold text-white drop-shadow-lg">
          {item.title}
        </h1>
        <p className="mt-1 text-sm text-neutral-300 drop-shadow">
          @{item.channel}
          {item.views ? ` · ${item.views} views` : ""} · {pos + 1}/
          {effective.length}
        </p>
      </div>

      {/* Bottom control bar */}
      <div
        className={`absolute bottom-0 left-0 w-full bg-gradient-to-t from-black/85 to-transparent px-4 pb-3 pt-12 transition-opacity duration-200 ${
          controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        {/* progress / scrubber */}
        <div className="group relative mb-2 flex h-4 items-center">
          <div className="absolute h-1 w-full rounded bg-white/25 group-hover:h-1.5" />
          <div
            className="absolute h-1 rounded bg-white/40 group-hover:h-1.5"
            style={{ width: `${bufPct}%` }}
          />
          <div
            className="absolute h-1 rounded bg-accent group-hover:h-1.5"
            style={{ width: `${pct}%` }}
          />
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={current}
            onChange={(e) => {
              const v = videoRef.current;
              if (v) {
                v.currentTime = Number(e.target.value);
                setCurrent(Number(e.target.value));
              }
            }}
            aria-label="Seek"
            className="absolute h-4 w-full cursor-pointer appearance-none bg-transparent [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:opacity-0 group-hover:[&::-webkit-slider-thumb]:opacity-100"
          />
        </div>

        {/* buttons row */}
        <div className="flex items-center gap-3 text-white">
          <Ctrl label="Previous (Shift+P)" disabled={!hasPrev} onClick={goPrev}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>
          </Ctrl>
          <Ctrl label="Play/Pause (k)" onClick={togglePlay}>
            {playing ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z" /></svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
            )}
          </Ctrl>
          <Ctrl label="Next (Shift+N)" disabled={!hasNext} onClick={goNext}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 6l8.5 6L6 18z" /></svg>
          </Ctrl>

          <Ctrl label="Back 5s (←)" onClick={() => skip(-5)}>
            <span className="text-xs font-semibold">−5s</span>
          </Ctrl>
          <Ctrl label="Forward 5s (→)" onClick={() => skip(5)}>
            <span className="text-xs font-semibold">+5s</span>
          </Ctrl>

          <Ctrl label="Mute (m)" onClick={toggleMute}>
            {muted ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M4 9v6h4l5 5V4L8 9zm12 .5 1.5-1.5L19 9.5 20.5 8 22 9.5 20.5 11 22 12.5 20.5 14 19 12.5 17.5 14 16 12.5 17.5 11z" /></svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M4 9v6h4l5 5V4L8 9zm11 .5a3.5 3.5 0 0 1 0 5v-5z" /></svg>
            )}
          </Ctrl>

          <span className="ml-1 text-xs tabular-nums text-neutral-200">
            {fmt(current)} / {fmt(duration)}
          </span>

          <div className="ml-auto flex items-center gap-3">
            <div ref={speedRef} className="relative">
              <button
                aria-label="Playback speed (< / >)"
                title="Playback speed (< / >)"
                aria-haspopup="menu"
                aria-expanded={speedMenu}
                onClick={() => {
                  setSpeedMenu((s) => !s);
                  setDisplayMenu(false);
                }}
                className="rounded-full px-2 py-1 text-xs font-semibold tabular-nums text-neutral-200 transition hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {rate}×
              </button>
              {speedMenu && (
                <div
                  role="menu"
                  className="absolute bottom-full right-0 mb-2 min-w-[7rem] overflow-hidden rounded-lg bg-neutral-900/95 py-1 text-sm text-white shadow-xl ring-1 ring-white/10 backdrop-blur"
                >
                  <div className="px-3 pb-1 pt-1 text-[0.65rem] font-semibold uppercase tracking-wide text-neutral-400">
                    Speed
                  </div>
                  {SPEED_STEPS.map((s) => (
                    <button
                      key={s}
                      role="menuitemradio"
                      aria-checked={rate === s}
                      onClick={() => setRateTo(s)}
                      className={`flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left tabular-nums transition hover:bg-white/10 ${
                        rate === s ? "text-white" : "text-neutral-300"
                      }`}
                    >
                      <span>{s === 1 ? "Normal" : `${s}×`}</span>
                      {rate === s && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Display popover — groups the per-reel rotate & zoom so the bar stays
                uncluttered. Keyboard still drives both directly (r, + / -). */}
            <div ref={displayRef} className="relative">
              <button
                aria-label="Display: rotate & zoom"
                title="Display: rotate & zoom"
                aria-haspopup="menu"
                aria-expanded={displayMenu}
                onClick={() => {
                  setDisplayMenu((s) => !s);
                  setSpeedMenu(false);
                }}
                className="grid h-9 w-9 place-items-center rounded-full text-white/90 transition hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z" /></svg>
              </button>
              {displayMenu && (
                <div
                  role="menu"
                  className="absolute bottom-full right-0 mb-2 min-w-[12rem] overflow-hidden rounded-lg bg-neutral-900/95 py-1 text-sm text-white shadow-xl ring-1 ring-white/10 backdrop-blur"
                >
                  <div className="px-3 pb-1 pt-1 text-[0.65rem] font-semibold uppercase tracking-wide text-neutral-400">
                    Display
                  </div>

                  {/* Size (zoom) stepper */}
                  <div className="flex items-center justify-between gap-3 px-3 py-1.5">
                    <span className="text-neutral-300">Size</span>
                    <div className="flex items-center gap-1">
                      <button
                        aria-label="Zoom out (-)"
                        title="Zoom out (-)"
                        onClick={() => zoomBy(-1)}
                        disabled={zoom <= ZOOM_MIN}
                        className="grid h-9 w-9 place-items-center rounded-full text-white/90 transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13H5v-2h14z" /></svg>
                      </button>
                      <span className="w-10 text-center tabular-nums text-neutral-200">
                        {Math.round(zoom * 100)}%
                      </span>
                      <button
                        aria-label="Zoom in (+)"
                        title="Zoom in (+)"
                        onClick={() => zoomBy(1)}
                        disabled={zoom >= ZOOM_MAX}
                        className="grid h-9 w-9 place-items-center rounded-full text-white/90 transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z" /></svg>
                      </button>
                    </div>
                  </div>

                  {/* Rotate — click to turn 90° clockwise, shows current angle */}
                  <button
                    role="menuitem"
                    onClick={rotate}
                    className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left transition hover:bg-white/10"
                  >
                    <span className="text-neutral-300">Rotate</span>
                    <span className="flex items-center gap-1.5 tabular-nums text-neutral-200">
                      {rotation}°
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M15.55 5.55 11 1v3.07C7.06 4.56 4 7.92 4 12s3.05 7.44 7 7.93v-2.02c-2.84-.48-5-2.94-5-5.91s2.16-5.43 5-5.91V10l4.55-4.45zM19.93 11a7.9 7.9 0 0 0-1.62-3.89l-1.42 1.42c.54.75.88 1.6 1.02 2.47h2.02zM13 17.9v2.02c1.39-.18 2.74-.72 3.9-1.62l-1.44-1.44c-.75.54-1.59.89-2.46 1.04zm3.89-2.42 1.42 1.41c.9-1.16 1.45-2.5 1.62-3.89h-2.02c-.14.87-.48 1.72-1.02 2.48z" /></svg>
                    </span>
                  </button>

                  {/* Reset to the default (fit-to-frame, unrotated) */}
                  <div className="mt-1 border-t border-white/10 pt-1">
                    <button
                      role="menuitem"
                      onClick={resetDisplay}
                      disabled={rotation === 0 && zoom === 1}
                      className="w-full px-3 py-1.5 text-left text-neutral-300 transition hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                      Reset
                    </button>
                  </div>
                </div>
              )}
            </div>

            <Ctrl
              label={fullscreen ? "Exit fullscreen (f)" : "Fullscreen (f)"}
              onClick={toggleFullscreen}
            >
              {fullscreen ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M5 16h3v3h2v-5H5zm3-8H5v2h5V5H8zm6 11h2v-3h3v-2h-5zm2-11V5h-2v5h5V8z" /></svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M7 14H5v5h5v-2H7zM5 10h2V7h3V5H5zm12 7h-3v2h5v-5h-2zM14 5v2h3v3h2V5z" /></svg>
              )}
            </Ctrl>
          </div>
        </div>
      </div>
    </div>
  );
}

function Ctrl({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid h-9 w-9 place-items-center rounded-full text-white/90 transition hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
