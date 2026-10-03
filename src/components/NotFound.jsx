import React from "react";
import {
  ArrowRight,
  ExternalLink,
  Home,
  LifeBuoy,
  RefreshCw,
  Wrench,
} from "lucide-react";

/**
 * 404 / "we couldn't reach this" screen.
 *
 * Two audiences land here, and the copy has to work for both:
 *
 *  1. Someone mistyped a dashboard path (/analytic, /ticket) — a genuine 404.
 *  2. The primary host (clevertapintel.globalsupportteam.com) is misbehaving
 *     at the DNS/edge layer and the user has no idea whether they broke
 *     something. They didn't. That's why the headline leads with "it's us".
 *
 * NOTE: this can only render once the app has actually loaded. A DNS failure
 * (DNS_PROBE_FINISHED_NXDOMAIN) is resolved by the browser BEFORE any request
 * reaches us, so that case shows Chrome's own error page and never this one —
 * the fix for that lives with the infra team / the domain's DNS records.
 * This screen covers every failure from the app inward, and gives anyone who
 * does reach it the mirror URL so they aren't blocked.
 */

// Vercel mirror of the same dashboard. Kept here as the single source of truth
// so the link can be updated in one place if the deployment ever moves.
const MIRROR_URL = "https://csd-sigma.vercel.app/";

const NotFound = ({ path }) => {
  const attemptedPath =
    path || (typeof window !== "undefined" ? window.location.pathname : "/");

  return (
    <div className="relative min-h-screen w-full overflow-hidden font-sans bg-slate-50 dark:bg-[#060D17] flex items-center justify-center px-5 py-12">
      {/* ── Ambient background ─────────────────────────────────────────── */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-48 left-1/2 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-indigo-500/10 blur-3xl dark:bg-indigo-500/20" />
        <div className="absolute -bottom-40 -right-32 h-96 w-96 rounded-full bg-purple-500/10 blur-3xl dark:bg-purple-600/20" />
        <div
          className="absolute inset-0 opacity-[0.35] dark:opacity-[0.18]"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgb(100 116 139 / 0.18) 1px, transparent 1px), linear-gradient(to bottom, rgb(100 116 139 / 0.18) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            WebkitMaskImage:
              "radial-gradient(ellipse 70% 55% at 50% 40%, #000 40%, transparent 100%)",
            maskImage:
              "radial-gradient(ellipse 70% 55% at 50% 40%, #000 40%, transparent 100%)",
          }}
        />
      </div>

      {/* ── Content ────────────────────────────────────────────────────── */}
      <div className="relative w-full max-w-2xl">
        {/* Brand */}
        <div className="flex items-center justify-center gap-3 mb-9 animate-fade-in">
          <img
            src="https://res.cloudinary.com/diwc3efjb/image/upload/v1766049455/clevertap_vtpmh8.jpg"
            className="h-8 w-8 rounded-lg object-cover"
            style={{ boxShadow: "0 1px 4px rgba(15,23,42,0.12)" }}
            alt="CleverTap"
          />
          <div className="pl-3 border-l border-slate-200 dark:border-slate-700/80">
            <p className="text-[13px] font-semibold tracking-tight text-slate-800 dark:text-slate-100 leading-tight">
              Customer Success Dashboard
            </p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
              Global Support Team
            </p>
          </div>
        </div>

        {/* The numeral */}
        <div className="text-center animate-fade-in stagger-1 opacity-0">
          <h1
            className="font-bold tracking-tighter leading-none select-none bg-clip-text text-transparent bg-gradient-to-br from-slate-900 via-indigo-600 to-purple-500 dark:from-white dark:via-indigo-300 dark:to-purple-400"
            style={{ fontSize: "clamp(5rem, 18vw, 9rem)" }}
          >
            404
          </h1>
        </div>

        {/* Status pill */}
        <div className="flex justify-center -mt-2 mb-7 animate-fade-in stagger-2 opacity-0">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50 dark:bg-amber-500/10 border border-amber-200/70 dark:border-amber-500/20">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
            </span>
            <span className="text-[11px] font-semibold tracking-wide uppercase text-amber-700 dark:text-amber-400">
              Infra team notified · Investigating
            </span>
          </div>
        </div>

        {/* Message card */}
        <div
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/70 backdrop-blur-sm p-7 sm:p-9 animate-fade-in stagger-3 opacity-0"
          style={{ boxShadow: "var(--shadow-premium)" }}
        >
          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-slate-900 dark:text-white text-center">
            It's not you — it's us.
          </h2>

          <p className="mt-3 text-[14px] leading-relaxed text-slate-500 dark:text-slate-400 text-center max-w-lg mx-auto">
            This page didn't load the way it should have. Nothing is wrong on
            your end — we're already checking with our infra team and will have
            it back shortly.
          </p>

          {attemptedPath && attemptedPath !== "/" && (
            <div className="mt-5 flex justify-center">
              <code className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 text-[12px] font-mono text-slate-500 dark:text-slate-400 max-w-full truncate">
                {attemptedPath}
              </code>
            </div>
          )}

          {/* Mirror — the actual unblock */}
          <div className="mt-7 rounded-xl border border-indigo-200/70 dark:border-indigo-500/25 bg-gradient-to-br from-indigo-50 to-purple-50/50 dark:from-indigo-500/10 dark:to-purple-500/5 p-5">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 w-8 h-8 shrink-0 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shadow-sm shadow-indigo-500/25">
                <LifeBuoy className="w-4 h-4 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                  Meanwhile, you're not blocked
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
                  The same dashboard — same data, same login — is live on our
                  mirror. Use it until the main link is restored.
                </p>
                <a
                  href={MIRROR_URL}
                  className="mt-4 btn-primary group"
                  rel="noopener noreferrer"
                >
                  Open the mirror dashboard
                  <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </a>
                <p className="mt-2.5 flex items-center gap-1.5 text-[11px] font-mono text-slate-400 dark:text-slate-500 break-all">
                  <ExternalLink className="w-3 h-3 shrink-0" />
                  {MIRROR_URL}
                </p>
              </div>
            </div>
          </div>

          {/* Secondary actions */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={() => window.location.reload()}
              className="btn-secondary text-xs"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Try again
            </button>
            <a href="/" className="btn-secondary text-xs">
              <Home className="w-3.5 h-3.5" /> Back to dashboard
            </a>
          </div>

          {/* Apology */}
          <div className="mt-7 pt-5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-center gap-2 text-center">
            <Wrench className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 shrink-0" />
            <p className="text-[12px] text-slate-400 dark:text-slate-500">
              Apologies for the inconvenience — thanks for bearing with us.
            </p>
          </div>
        </div>

        <p className="mt-6 text-center text-[11px] text-slate-400 dark:text-slate-600 animate-fade-in stagger-4 opacity-0">
          Still stuck after the mirror? Ping the Global Support Team channel.
        </p>
      </div>
    </div>
  );
};

export default NotFound;
