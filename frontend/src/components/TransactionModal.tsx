import { useState, useEffect } from "react";

export type Step = {
  label: string;
  status: "pending" | "active" | "done" | "error";
};

export type TransactionModalProps = {
  open: boolean;
  title: string;
  steps: Step[];
  error?: string;
  onClose?: () => void;
};

function ScrambleHex() {
  const [chars, setChars] = useState<string[]>([]);
  const pool = "0123456789abcdef";

  useEffect(() => {
    const interval = setInterval(() => {
      setChars(
        Array.from({ length: 24 }, () => pool[Math.floor(Math.random() * pool.length)])
      );
    }, 80);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="font-mono text-xs text-blue-500/60 tracking-wider overflow-hidden text-center">
      <span className="text-blue-400/40">0x</span>
      {chars.map((c, i) => (
        <span key={i} className="scramble-char" style={{ animationDelay: `${i * 0.05}s` }}>
          {c}
        </span>
      ))}
    </div>
  );
}

function StepIcon({ status }: { status: Step["status"] }) {
  switch (status) {
    case "done":
      return (
        <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
      );
    case "active":
      return (
        <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0 encrypt-pulse">
          <div className="w-3.5 h-3.5 border-2 border-blue-400/30 border-t-blue-400 rounded-full spinner" />
        </div>
      );
    case "error":
      return (
        <div className="w-6 h-6 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </div>
      );
    case "pending":
    default:
      return (
        <div className="w-6 h-6 rounded-full bg-slate-700/50 flex items-center justify-center flex-shrink-0">
          <div className="w-2 h-2 rounded-full bg-slate-500/60" />
        </div>
      );
  }
}

export default function TransactionModal({ open, title, steps, error, onClose }: TransactionModalProps) {
  if (!open) return null;

  const allDone = steps.length > 0 && steps.every((s) => s.status === "done");
  const hasError = steps.some((s) => s.status === "error") || !!error;
  const canClose = allDone || hasError;
  const hasActiveStep = steps.some((s) => s.status === "active");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-[#111827] border border-blue-500/20 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden gradient-border">
        {/* Header */}
        <div className="px-6 pt-6 pb-2 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">{title}</h3>
          {canClose && onClose && (
            <button
              onClick={onClose}
              className="text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>

        {/* Steps */}
        <div className="px-6 py-4 space-y-3">
          {steps.map((step, idx) => (
            <div key={idx} className="flex items-center gap-3">
              <StepIcon status={step.status} />
              <span className={`text-sm font-medium transition-colors duration-200 ${
                step.status === "done" ? "text-emerald-400" :
                step.status === "active" ? "text-blue-400" :
                step.status === "error" ? "text-red-400" :
                "text-slate-500"
              }`}>
                {step.label}
              </span>
            </div>
          ))}
        </div>

        {/* Error message */}
        {error && (
          <div className="mx-6 mb-4 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-400 flex items-start gap-2">
            <svg className="flex-shrink-0 mt-0.5" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* Success message */}
        {allDone && !error && (
          <div className="mx-6 mb-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-sm text-emerald-400 flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            Transaction completed successfully
          </div>
        )}

        {/* Scramble animation - only while active */}
        {hasActiveStep && (
          <div className="px-6 pb-5 pt-1">
            <div className="flex flex-col items-center gap-2">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-blue-500/10 encrypt-pulse">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0110 0v4"/>
                </svg>
              </div>
              <ScrambleHex />
              <div className="text-[10px] text-slate-500 mt-1">FHE encryption in progress...</div>
            </div>
          </div>
        )}

        {/* Close button at bottom when closable */}
        {canClose && onClose && (
          <div className="px-6 pb-5">
            <button
              onClick={onClose}
              className={`w-full py-2.5 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer ${
                hasError
                  ? "bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400"
                  : "bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400"
              }`}
            >
              {hasError ? "Close" : "Done"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
