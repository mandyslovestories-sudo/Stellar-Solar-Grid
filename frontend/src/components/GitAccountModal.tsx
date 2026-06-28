"use client";

import { useState, useEffect, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

export interface GitAccount {
  /** Display label, e.g. "mandyslovestories-sudo (github.com)" */
  label: string;
  /** GitHub username */
  username: string;
  /** Remote URL to push to, e.g. "https://github.com/owner/repo.git" */
  remote: string;
  /** Optional: which credential helper token maps to this account */
  credentialHelper?: string;
}

interface Props {
  /** Branch name that will be pushed */
  branch: string;
  /** List of available git accounts to choose from */
  accounts: GitAccount[];
  /** Called when the user confirms — push the branch with this account */
  onPush: (account: GitAccount, branch: string) => Promise<void>;
  /** Called when the modal is dismissed without pushing */
  onClose: () => void;
}

// ── Status chip ────────────────────────────────────────────────────────────

type PushStatus = "idle" | "pushing" | "success" | "error";

function StatusBadge({ status, error }: { status: PushStatus; error?: string }) {
  if (status === "idle") return null;

  const map: Record<PushStatus, { cls: string; icon: string; text: string }> = {
    idle: { cls: "", icon: "", text: "" },
    pushing: {
      cls: "border-blue-500/30 bg-blue-900/20 text-blue-300",
      icon: "⏳",
      text: "Pushing…",
    },
    success: {
      cls: "border-green-500/30 bg-green-900/20 text-green-300",
      icon: "✓",
      text: "Pushed successfully",
    },
    error: {
      cls: "border-red-500/30 bg-red-900/20 text-red-300",
      icon: "✕",
      text: error ?? "Push failed",
    },
  };

  const { cls, icon, text } = map[status];

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs ${cls}`}
    >
      <span aria-hidden="true">{icon}</span>
      <span>{text}</span>
    </div>
  );
}

// ── Account card ───────────────────────────────────────────────────────────

function AccountCard({
  account,
  selected,
  onSelect,
  disabled,
}: {
  account: GitAccount;
  selected: boolean;
  onSelect: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={[
        "w-full rounded-xl border p-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-solar-yellow",
        selected
          ? "border-solar-yellow bg-solar-yellow/10"
          : "border-white/10 bg-solar-dark hover:border-white/30",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Username */}
          <p className="truncate text-sm font-semibold text-white">
            {account.username}
          </p>
          {/* Remote URL */}
          <p className="mt-0.5 truncate text-xs text-gray-400">
            {account.remote}
          </p>
          {/* Credential helper hint */}
          {account.credentialHelper && (
            <p className="mt-1 truncate text-xs text-gray-600">
              via {account.credentialHelper}
            </p>
          )}
        </div>
        {/* Selection indicator */}
        <div
          aria-hidden="true"
          className={[
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition",
            selected
              ? "border-solar-yellow bg-solar-yellow"
              : "border-white/20 bg-transparent",
          ].join(" ")}
        >
          {selected && (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path
                d="M2 5l2.5 2.5L8 3"
                stroke="#1A1A2E"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────────

export default function GitAccountModal({
  branch,
  accounts,
  onPush,
  onClose,
}: Props) {
  const [selected, setSelected] = useState<GitAccount | null>(
    accounts.length === 1 ? accounts[0] : null,
  );
  const [status, setStatus] = useState<PushStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string>();

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && status !== "pushing") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, status]);

  const handlePush = useCallback(async () => {
    if (!selected) return;
    setStatus("pushing");
    setErrorMsg(undefined);
    try {
      await onPush(selected, branch);
      setStatus("success");
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, [selected, branch, onPush]);

  const isPushing = status === "pushing";
  const isDone = status === "success";

  return (
    /* Backdrop */
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="git-account-modal-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0"
    >
      {/* Dim overlay */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={isPushing ? undefined : onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="relative w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-solar-accent border border-white/10 shadow-2xl overflow-hidden">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-black/20">
          <div className="flex items-center gap-2.5">
            {/* Git icon */}
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-solar-yellow/10 text-solar-yellow text-lg"
            >
              ⑂
            </span>
            <div>
              <h2
                id="git-account-modal-title"
                className="text-sm font-bold text-white"
              >
                Push branch
              </h2>
              <p className="text-xs text-gray-400 font-mono">{branch}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isPushing}
            aria-label="Close"
            className="rounded-lg p-1.5 text-gray-400 hover:text-white hover:bg-white/10 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
            </svg>
          </button>
        </div>

        {/* ── Body ── */}
        <div className="px-5 py-5 space-y-4 max-h-[70vh] overflow-y-auto">

          {/* Instruction */}
          <p className="text-xs text-gray-400">
            Select the GitHub account to push with. The remote URL will be
            rewritten to use the chosen credential.
          </p>

          {/* Account list */}
          {accounts.length === 0 ? (
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-900/20 px-4 py-3 text-xs text-yellow-300">
              ⚠️ No git accounts detected. Run{" "}
              <code className="font-mono text-solar-yellow">gh auth login</code>{" "}
              to add one, then reopen this modal.
            </div>
          ) : (
            <div className="space-y-2" role="radiogroup" aria-label="Git accounts">
              {accounts.map((acct) => (
                <AccountCard
                  key={acct.username}
                  account={acct}
                  selected={selected?.username === acct.username}
                  onSelect={() => setSelected(acct)}
                  disabled={isPushing || isDone}
                />
              ))}
            </div>
          )}

          {/* Status */}
          <StatusBadge status={status} error={errorMsg} />

          {/* Retry hint */}
          {status === "error" && (
            <p className="text-xs text-gray-500">
              Tip: make sure you&apos;re logged in with{" "}
              <code className="font-mono text-solar-yellow">gh auth login</code>{" "}
              as the selected account.
            </p>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex gap-3 px-5 py-4 border-t border-white/10">
          <button
            type="button"
            onClick={onClose}
            disabled={isPushing}
            className="flex-1 rounded-lg border border-white/10 py-3 text-sm text-gray-300 hover:border-solar-yellow hover:text-solar-yellow transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Cancel
          </button>

          {isDone ? (
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg bg-green-600 py-3 text-sm font-semibold text-white transition hover:bg-green-500"
            >
              Done ✓
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePush}
              disabled={!selected || isPushing || accounts.length === 0}
              className="flex-1 rounded-lg bg-solar-yellow py-3 text-sm font-semibold text-solar-dark transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isPushing ? (
                <span className="flex items-center justify-center gap-2">
                  <svg
                    className="h-4 w-4 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12" cy="12" r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    />
                  </svg>
                  Pushing…
                </span>
              ) : (
                "Push branch"
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
