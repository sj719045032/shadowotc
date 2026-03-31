import { useState, useEffect, useCallback } from "react";
import {
  getETHBalance,
  getUSDCBalance,
  CONTRACT_ADDRESS,
  CWETH_ADDRESS,
  CUSDC_ADDRESS,
  parseUnits,
  cwethRead,
  cusdcRead,
  cwethWrite,
  cusdcWrite,
  usdcApprove,
  usdcAllowance,
  waitTx,
  getPendingUnwraps,
  getTransferHistory,
  type PendingUnwrap,
  type TransferRecord,
  ZERO_FHE_HANDLE,
} from "../lib/contract";
import { getAccount } from "@wagmi/core";
import { decodeEventLog, type Abi } from "viem";
import { config } from "../wagmi";
import CWETH_ABI from "../lib/cweth-abi.json";
import CUSDC_ABI from "../lib/cusdc-abi.json";
import { decryptValues, encryptUint64, publicDecryptHandle } from "../lib/fhevm";
import { useWallet } from "../App";
import TransactionModal, { type Step } from "../components/TransactionModal";

// ---------------------------------------------------------------------------
// Vault Card Component
// ---------------------------------------------------------------------------

type VaultCardProps = {
  title: string;
  symbol: string;
  contractAddress: string;
  plaintextBalance: string;
  plaintextLoading: boolean;
  encryptedHandle: string | null;
  decryptedBalance: string | null;
  decryptLoading: boolean;
  onDecrypt: () => void;
  onWrap: (amount: string) => void;
  onUnwrap: (amount: string) => void;
  busy: boolean;
  account: string;
};

function VaultCard({
  title,
  symbol,
  contractAddress,
  plaintextBalance,
  plaintextLoading,
  encryptedHandle,
  decryptedBalance,
  decryptLoading,
  onDecrypt,
  onWrap,
  onUnwrap,
  busy,
  account,
}: VaultCardProps) {
  const [amount, setAmount] = useState("");
  const deployed = !!contractAddress;

  return (
    <div className="bg-[#111827] border border-[#1e293b] rounded-2xl overflow-hidden gradient-border card-glow">
      {/* Card Header */}
      <div className="px-5 sm:px-6 pt-5 sm:pt-6 pb-4 border-b border-[#1e293b]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
            {symbol === "ETH" ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M12 1.5l-8 12 8 4.5 8-4.5-8-12z" fill="#627eea" fillOpacity="0.3" stroke="#627eea" strokeWidth="1.2" />
                <path d="M4 13.5l8 4.5 8-4.5-8 9-8-9z" fill="#627eea" fillOpacity="0.15" stroke="#627eea" strokeWidth="1.2" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" fill="#2775ca" fillOpacity="0.2" stroke="#2775ca" strokeWidth="1.2" />
                <text x="12" y="16" textAnchor="middle" fill="#2775ca" fontSize="10" fontWeight="bold">$</text>
              </svg>
            )}
          </div>
          <div>
            <h3 className="text-base font-bold text-white">{title}</h3>
            <p className="text-xs text-slate-500">
              {symbol === "ETH" ? "Confidential Wrapped ETH" : "Confidential USDC"}
            </p>
          </div>
        </div>
      </div>

      {/* Balances */}
      <div className="px-5 sm:px-6 py-4 space-y-3">
        {/* Plaintext balance */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
            {symbol} Balance
          </span>
          <span className="text-sm font-mono text-slate-200">
            {plaintextLoading ? (
              <span className="text-slate-500">Loading...</span>
            ) : (
              `${parseFloat(Number(plaintextBalance).toFixed(symbol === "ETH" ? 6 : 2))} ${symbol}`
            )}
          </span>
        </div>

        {/* Encrypted balance */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
            c{symbol} Balance
          </span>
          {!deployed ? (
            <span className="text-xs text-slate-600">--</span>
          ) : decryptedBalance !== null ? (
            <span className="text-sm font-mono text-emerald-400 decrypt-reveal">
              {parseFloat(Number(decryptedBalance).toFixed(symbol === "ETH" ? 8 : 6))} c{symbol}
            </span>
          ) : (
            <div className="flex items-center gap-2">
              <span className="encrypted-badge inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-blue-400 border border-blue-500/20">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
                Encrypted
              </span>
              {encryptedHandle && (
                <button
                  onClick={onDecrypt}
                  disabled={decryptLoading || !account}
                  className="text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors disabled:text-slate-600 disabled:no-underline cursor-pointer disabled:cursor-not-allowed"
                >
                  {decryptLoading ? "Decrypting..." : "Decrypt"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Not deployed banner */}
      {!deployed && (
        <div className="mx-5 sm:mx-6 mb-4 bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 flex items-start gap-2.5">
          <svg className="flex-shrink-0 mt-0.5" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span className="text-xs text-amber-400/80 leading-relaxed">
            Contract not deployed. The c{symbol} contract address has not been configured yet.
          </span>
        </div>
      )}

      {/* Input + Buttons */}
      <div className="px-5 sm:px-6 pb-5 sm:pb-6 space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
            Amount
          </label>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              min="0"
              step="any"
              disabled={!deployed || busy}
              className="w-full bg-[#0d1117] border border-[#1e293b] rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 focus:shadow-[0_0_12px_rgba(59,130,246,0.1)] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-medium">
              {symbol}
            </span>
          </div>
        </div>

        {/* Max button */}
        {deployed && plaintextBalance && Number(plaintextBalance) > 0 && (
          <button
            type="button"
            onClick={() => setAmount(plaintextBalance)}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
          >
            Max: {parseFloat(Number(plaintextBalance).toFixed(symbol === "ETH" ? 6 : 2))} {symbol}
          </button>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => {
              if (amount && Number(amount) > 0) onWrap(amount);
            }}
            disabled={!deployed || busy || !amount || Number(amount) <= 0 || !account}
            className="py-3 rounded-xl text-sm font-semibold transition-all duration-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white shadow-[0_0_15px_rgba(34,197,94,0.15)] hover:shadow-[0_0_25px_rgba(34,197,94,0.25)] disabled:shadow-none disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500"
          >
            {busy ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full spinner" />
                ...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-1.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
                Wrap
              </span>
            )}
          </button>

          <button
            onClick={() => {
              if (amount && Number(amount) > 0) onUnwrap(amount);
            }}
            disabled={!deployed || busy || !amount || Number(amount) <= 0 || !account}
            className="py-3 rounded-xl text-sm font-semibold transition-all duration-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 bg-gradient-to-r from-orange-600 to-orange-500 hover:from-orange-500 hover:to-orange-400 text-white shadow-[0_0_15px_rgba(249,115,22,0.15)] hover:shadow-[0_0_25px_rgba(249,115,22,0.25)] disabled:shadow-none disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500"
          >
            {busy ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full spinner" />
                ...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-1.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 5-5 5 5 0 0 1 5 5v1" />
                </svg>
                Unwrap
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

type PendingUnwrapStatus = "requested" | "decrypting" | "ready" | "finalizing" | "error";

type PendingUnwrapItem = PendingUnwrap & {
  status: PendingUnwrapStatus;
  cleartext?: bigint;
  cleartexts?: `0x${string}`;
  decryptionProof?: `0x${string}`;
  error?: string;
  autoResume?: boolean;
};

const CWETH_ABI_TYPED = CWETH_ABI as Abi;
const CUSDC_ABI_TYPED = CUSDC_ABI as Abi;

function shortenHash(value: string) {
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function formatPendingAmount(item: PendingUnwrapItem) {
  if (item.cleartext === undefined) return null;
  // Both cWETH and cUSDC encrypted balances use 6-decimal precision
  const divisor = 1e6;
  const digits = item.token === "ETH" ? 6 : 2;
  return `${parseFloat((Number(item.cleartext) / divisor).toFixed(digits))} ${item.token}`;
}

function upsertPendingItem(items: PendingUnwrapItem[], next: PendingUnwrapItem) {
  const existing = items.find((item) => item.handle.toLowerCase() === next.handle.toLowerCase());
  if (!existing) return [next, ...items];
  return items.map((item) => item.handle.toLowerCase() === next.handle.toLowerCase() ? { ...item, ...next } : item);
}

function PendingUnwrapList({
  title,
  items,
  onFinalize,
}: {
  title: string;
  items: PendingUnwrapItem[];
  onFinalize: (item: PendingUnwrapItem) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="mt-4 bg-[#0d1117] border border-[#1e293b] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-slate-200">Pending unwraps · {title}</h4>
        <span className="text-xs text-slate-500">Recovered from chain</span>
      </div>
      <div className="space-y-3">
        {items.map((item) => {
          const canFinalize = item.status === "ready" && item.cleartexts && item.decryptionProof;
          return (
            <div key={item.handle} className="rounded-lg border border-[#1f2937] bg-slate-950/60 p-3">
              {(() => { const fmtAmt = formatPendingAmount(item); return (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-slate-400">Handle</div>
                  <div className="text-sm font-mono text-slate-200 truncate">{shortenHash(item.handle)}</div>
                  <div className="mt-1 text-xs text-slate-500">Tx {shortenHash(item.txHash)}</div>
                  {fmtAmt && (
                    <div className="mt-1 text-xs text-emerald-400">{fmtAmt}</div>
                  )}
                  {item.error && <div className="mt-1 text-xs text-rose-400">{item.error}</div>}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="text-xs px-2 py-1 rounded-full border border-slate-700 text-slate-300">
                    {item.status === "requested" && "request submitted"}
                    {item.status === "decrypting" && "decrypting"}
                    {item.status === "ready" && "ready to finalize"}
                    {item.status === "finalizing" && "finalizing"}
                    {item.status === "error" && "error"}
                  </span>
                  <button
                    type="button"
                    disabled={!canFinalize}
                    onClick={() => onFinalize(item)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-blue-600 text-white hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed cursor-pointer"
                  >
                    Finalize
                  </button>
                </div>
              </div>
              ); })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vault Page
// ---------------------------------------------------------------------------

export default function Vault() {
  const { account, connect } = useWallet();

  // Plaintext balances
  const [ethBalance, setEthBalance] = useState("");
  const [usdcBalance, setUsdcBalance] = useState("");
  const [balancesLoading, setBalancesLoading] = useState(false);

  // Encrypted balance handles
  const [cwethHandle, setCwethHandle] = useState<string | null>(null);
  const [cusdcHandle, setCusdcHandle] = useState<string | null>(null);

  // Decrypted confidential balances
  const [cwethDecrypted, setCwethDecrypted] = useState<string | null>(null);
  const [cusdcDecrypted, setCusdcDecrypted] = useState<string | null>(null);
  const [cwethDecrypting, setCwethDecrypting] = useState(false);
  const [cusdcDecrypting, setCusdcDecrypting] = useState(false);

  // Transaction modal state
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [txTitle, setTxTitle] = useState("");
  const [txSteps, setTxSteps] = useState<Step[]>([]);
  const [txError, setTxError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedToken, setSelectedToken] = useState<"ETH" | "USDC">("ETH");

  // Transfer history
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [transfersLoading, setTransfersLoading] = useState(false);
  const [decryptingHistory, setDecryptingHistory] = useState(false);
  const [pendingUnwraps, setPendingUnwraps] = useState<PendingUnwrapItem[]>([]);

  // ---- Load plaintext balances ----
  const loadBalances = useCallback(async () => {
    if (!account) return;
    setBalancesLoading(true);
    try {
      const [eth, usdc] = await Promise.all([
        getETHBalance(account),
        getUSDCBalance(account),
      ]);
      setEthBalance(eth);
      setUsdcBalance(usdc);
    } catch {
      // Silently fail - balances will show as 0
    } finally {
      setBalancesLoading(false);
    }
  }, [account]);

  // ---- Load encrypted balance handles ----
  const loadEncryptedHandles = useCallback(async () => {
    if (!account) return;
    const [cwethResult, cusdcResult] = await Promise.all([
      CWETH_ADDRESS ? cwethRead("confidentialBalanceOf", [account]).catch(() => null) : null,
      CUSDC_ADDRESS ? cusdcRead("confidentialBalanceOf", [account]).catch(() => null) : null,
    ]);
    if (cwethResult && cwethResult !== ZERO_FHE_HANDLE) setCwethHandle(cwethResult as string);
    if (cusdcResult && cusdcResult !== ZERO_FHE_HANDLE) setCusdcHandle(cusdcResult as string);
  }, [account]);

  const refreshPendingUnwraps = useCallback(async () => {
    if (!account) {
      setPendingUnwraps([]);
      return;
    }

    try {
      const requests = await getPendingUnwraps(account as `0x${string}`);
      setPendingUnwraps((prev) => {
        const finalizing = prev.filter((item) => item.status === "finalizing");
        const merged = requests.map((request) => {
          const existing = prev.find((item) => item.handle.toLowerCase() === request.handle.toLowerCase());
          return existing ? { ...existing, ...request } : { ...request, status: "requested" as const };
        });
        const mergedHandles = new Set(merged.map((item) => item.handle.toLowerCase()));
        const pendingFinalizing = finalizing.filter((item) => !mergedHandles.has(item.handle.toLowerCase()));
        return [...pendingFinalizing, ...merged];
      });
    } catch (err) {
      console.error("Failed to recover pending unwraps:", err);
    }
  }, [account]);

  useEffect(() => {
    loadBalances();
    loadEncryptedHandles();
    refreshPendingUnwraps();
  }, [loadBalances, loadEncryptedHandles, refreshPendingUnwraps]);

  // Load transfer history when token or account changes
  useEffect(() => {
    if (!account) { setTransfers([]); return; }
    setTransfersLoading(true);
    getTransferHistory(account as `0x${string}`, selectedToken)
      .then(setTransfers)
      .catch(() => setTransfers([]))
      .finally(() => setTransfersLoading(false));
  }, [account, selectedToken]);

  async function handleDecryptHistory() {
    if (!account || transfers.length === 0) return;
    const handles = transfers
      .filter((t) => t.amountHandle && t.amountHandle !== "0x" && !t.decryptedAmount)
      .map((t) => ({
        handle: t.amountHandle,
        contractAddress: (t.token === "ETH" ? CWETH_ADDRESS : CUSDC_ADDRESS) as string,
      }));
    if (handles.length === 0) return;
    setDecryptingHistory(true);
    try {
      const results = await decryptValues(handles, account);
      setTransfers((prev) =>
        prev.map((t) => {
          const val = results.get(t.amountHandle);
          return val !== undefined ? { ...t, decryptedAmount: Number(val) / 1e6 } : t;
        }),
      );
    } catch (err) {
      console.error("Failed to decrypt history:", err);
    } finally {
      setDecryptingHistory(false);
    }
  }

  // ---- Decrypt all balances in one signing request ----
  async function handleDecryptAll() {
    if (!account) return;
    const handles: { handle: string; contractAddress: string }[] = [];
    if (cwethHandle) handles.push({ handle: cwethHandle, contractAddress: CWETH_ADDRESS });
    if (cusdcHandle) handles.push({ handle: cusdcHandle, contractAddress: CUSDC_ADDRESS });
    if (handles.length === 0) return;

    setCwethDecrypting(true);
    setCusdcDecrypting(true);
    try {
      const results = await decryptValues(handles, account);
      if (cwethHandle) {
        const val = results.get(cwethHandle);
        setCwethDecrypted(val !== undefined ? String(Number(val) / 1e6) : "0");
      }
      if (cusdcHandle) {
        const val = results.get(cusdcHandle);
        setCusdcDecrypted(val !== undefined ? String(Number(val) / 1e6) : "0");
      }
    } catch (err) {
      console.error("Failed to decrypt balances:", err);
    } finally {
      setCwethDecrypting(false);
      setCusdcDecrypting(false);
    }
  }

  // ---- Step helpers ----
  function updateStep(idx: number, status: Step["status"]) {
    setTxSteps((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, status } : s)),
    );
  }

  function markActiveAsError() {
    setTxSteps((prev) =>
      prev.map((s) => (s.status === "active" ? { ...s, status: "error" } : s)),
    );
  }

  function parseUnwrapRequestedHandle(receipt: Awaited<ReturnType<typeof waitTx>>, token: "ETH" | "USDC") {
    const abi = token === "ETH" ? CWETH_ABI_TYPED : CUSDC_ABI_TYPED;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics }) as unknown as { eventName: string; args: Record<string, unknown> };
        if (decoded.eventName === "UnwrapRequested") {
          return decoded.args.amount as `0x${string}`;
        }
      } catch {
        // ignore non-matching logs
      }
    }
    throw new Error("UnwrapRequested event not found");
  }

  async function runPublicDecrypt(item: PendingUnwrap, autoResume = false) {
    setPendingUnwraps((prev) => upsertPendingItem(prev, { ...item, status: "decrypting", autoResume }));
    try {
      const decrypted = await publicDecryptHandle(item.handle);
      const nextItem: PendingUnwrapItem = {
        ...item,
        status: "ready",
        cleartext: decrypted.cleartext,
        cleartexts: decrypted.cleartexts,
        decryptionProof: decrypted.decryptionProof,
        autoResume,
      };
      setPendingUnwraps((prev) => upsertPendingItem(prev, nextItem));
      return nextItem;
    } catch (err) {
      const message = (err as Error).message?.slice(0, 160) || "Public decrypt failed";
      setPendingUnwraps((prev) => upsertPendingItem(prev, { ...item, status: "error", error: message, autoResume }));
      throw err;
    }
  }

  async function finalizePendingUnwrap(item: PendingUnwrapItem, options?: { showModal?: boolean }) {
    if (item.cleartext === undefined || !item.cleartexts || !item.decryptionProof) {
      throw new Error("Missing decryption result");
    }

    const showModal = options?.showModal ?? true;
    if (showModal) {
      setTxTitle(`Finalizing c${item.token} unwrap`);
      setTxSteps([
        { label: "Submitting finalize transaction", status: "pending" },
        { label: "Waiting for finalization confirmation", status: "pending" },
      ]);
      setTxError("");
      setTxModalOpen(true);
    }

    setPendingUnwraps((prev) => upsertPendingItem(prev, { ...item, status: "finalizing" }));
    setBusy(true);

    try {
      if (showModal) updateStep(0, "active");
      const hash = item.token === "ETH"
        ? await cwethWrite("finalizeUnwrap", [item.handle, item.cleartext, item.decryptionProof])
        : await cusdcWrite("finalizeUnwrap", [item.handle, item.cleartext, item.decryptionProof]);
      if (showModal) updateStep(0, "done");

      if (showModal) updateStep(1, "active");
      await waitTx(hash);
      if (showModal) updateStep(1, "done");

      setPendingUnwraps((prev) => prev.filter((entry) => entry.handle.toLowerCase() !== item.handle.toLowerCase()));
      await Promise.all([loadBalances(), loadEncryptedHandles()]);
      if (item.token === "ETH") {
        setCwethDecrypted(null);
      } else {
        setCusdcDecrypted(null);
      }
    } catch (err) {
      const message = (err as Error).message?.slice(0, 160) || "Finalize unwrap failed";
      setPendingUnwraps((prev) => upsertPendingItem(prev, { ...item, status: "error", error: message }));
      if (showModal) {
        setTxError(message);
        markActiveAsError();
      }
      throw err;
    } finally {
      setBusy(false);
    }
  }

  // ---- Wrap ETH -> cWETH ----
  const handleWrapETH = async (amount: string) => {
    if (!account) {
      await connect();
      return;
    }
    const steps: Step[] = [
      { label: "Submitting wrap transaction", status: "pending" },
      { label: "Waiting for confirmation", status: "pending" },
    ];
    setTxTitle("Wrapping ETH → cWETH");
    setTxSteps(steps);
    setTxError("");
    setTxModalOpen(true);
    setBusy(true);

    try {
      updateStep(0, "active");
      const hash = await cwethWrite("wrap", [], parseUnits(amount, 18));
      updateStep(0, "done");

      updateStep(1, "active");
      await waitTx(hash);
      updateStep(1, "done");

      // Refresh balances
      await Promise.all([loadBalances(), loadEncryptedHandles()]);
      setCwethDecrypted(null);
    } catch (err: unknown) {
      console.error(err);
      const msg = (err as Error).message?.slice(0, 120) || "Transaction failed";
      setTxError(msg);
      markActiveAsError();
    } finally {
      setBusy(false);
    }
  };

  // ---- Unwrap cWETH -> ETH ----
  const handleUnwrapETH = async (amount: string) => {
    if (!account) {
      await connect();
      return;
    }
    // Pre-check if decrypted balance is available and insufficient
    if (cwethDecrypted !== null && Number(amount) > Number(cwethDecrypted)) {
      setTxTitle("Unwrapping cWETH -> ETH");
      setTxSteps([{ label: "Balance check", status: "error" }]);
      setTxError(`Insufficient cWETH balance (have ${parseFloat(Number(cwethDecrypted).toFixed(8))}, need ${amount}).`);
      setTxModalOpen(true);
      return;
    }
    const steps: Step[] = [
      { label: "Encrypting amount", status: "pending" },
      { label: "Submitting unwrap transaction", status: "pending" },
      { label: "Waiting for confirmation", status: "pending" },
      { label: "Waiting for decryption result", status: "pending" },
      { label: "Finalizing unwrap", status: "pending" },
      { label: "Waiting for finalization confirmation", status: "pending" },
    ];
    setTxTitle("Unwrapping cWETH -> ETH");
    setTxSteps(steps);
    setTxError("");
    setTxModalOpen(true);
    setBusy(true);

    try {
      // cWETH unwrap with encrypted amount (fully confidential)
      // unwrap(address from, address to, externalEuint64 encryptedAmount, bytes inputProof)
      updateStep(0, "active");
      await new Promise(r => setTimeout(r, 50)); // let React paint modal
      const encrypted = await encryptUint64(CWETH_ADDRESS, account, parseUnits(amount, 6));
      updateStep(0, "done");

      updateStep(1, "active");
      const hash = await cwethWrite("unwrap", [account, account, encrypted.handles[0], encrypted.inputProof]);
      updateStep(1, "done");

      updateStep(2, "active");
      const receipt = await waitTx(hash);
      updateStep(2, "done");

      updateStep(3, "active");
      const handle = parseUnwrapRequestedHandle(receipt, "ETH");
      const pending: PendingUnwrap = {
        token: "ETH",
        contractAddress: CWETH_ADDRESS,
        handle,
        txHash: hash,
        blockNumber: receipt.blockNumber,
      };
      const decrypted = await runPublicDecrypt(pending, true);
      updateStep(3, "done");

      updateStep(4, "active");
      const hash2 = await cwethWrite("finalizeUnwrap", [decrypted.handle, decrypted.cleartext!, decrypted.decryptionProof!]);
      updateStep(4, "done");

      updateStep(5, "active");
      await waitTx(hash2);
      updateStep(5, "done");

      setPendingUnwraps((prev) => prev.filter((item) => item.handle.toLowerCase() !== handle.toLowerCase()));
      await Promise.all([loadBalances(), loadEncryptedHandles(), refreshPendingUnwraps()]);
      setCwethDecrypted(null);
    } catch (err: unknown) {
      console.error(err);
      const msg = (err as Error).message?.slice(0, 120) || "Transaction failed";
      setTxError(msg);
      markActiveAsError();
    } finally {
      setBusy(false);
    }
  };

  // ---- Wrap USDC -> cUSDC ----
  const handleWrapUSDC = async (amount: string) => {
    if (!account) {
      await connect();
      return;
    }
    const steps: Step[] = [
      { label: "Approving USDC", status: "pending" },
      { label: "Submitting wrap transaction", status: "pending" },
      { label: "Waiting for confirmation", status: "pending" },
    ];
    setTxTitle("Wrapping USDC → cUSDC");
    setTxSteps(steps);
    setTxError("");
    setTxModalOpen(true);
    setBusy(true);

    try {
      // Step 1: Approve USDC spending
      updateStep(0, "active");
      const needed = parseUnits(amount, 6);
      const { address: signerAddr } = getAccount(config);
      const currentAllowance = await usdcAllowance(signerAddr! as `0x${string}`, CUSDC_ADDRESS);
      if (currentAllowance < needed) {
        const approveHash = await usdcApprove(CUSDC_ADDRESS, needed);
        await waitTx(approveHash);
      }
      updateStep(0, "done");

      // Step 2: Wrap
      updateStep(1, "active");
      const wrapHash = await cusdcWrite("wrap", [signerAddr, needed]);
      updateStep(1, "done");

      // Step 3: Wait
      updateStep(2, "active");
      await waitTx(wrapHash);
      updateStep(2, "done");

      await Promise.all([loadBalances(), loadEncryptedHandles()]);
      setCusdcDecrypted(null);
    } catch (err: unknown) {
      console.error(err);
      const msg = (err as Error).message?.slice(0, 120) || "Transaction failed";
      setTxError(msg);
      markActiveAsError();
    } finally {
      setBusy(false);
    }
  };

  // ---- Unwrap cUSDC -> USDC ----
  const handleUnwrapUSDC = async (amount: string) => {
    if (!account) {
      await connect();
      return;
    }
    // Pre-check if decrypted balance is available and insufficient
    if (cusdcDecrypted !== null && Number(amount) > Number(cusdcDecrypted)) {
      setTxTitle("Unwrapping cUSDC -> USDC");
      setTxSteps([{ label: "Balance check", status: "error" }]);
      setTxError(`Insufficient cUSDC balance (have ${parseFloat(Number(cusdcDecrypted).toFixed(6))}, need ${amount}).`);
      setTxModalOpen(true);
      return;
    }
    const steps: Step[] = [
      { label: "Encrypting amount", status: "pending" },
      { label: "Submitting unwrap transaction", status: "pending" },
      { label: "Waiting for confirmation", status: "pending" },
      { label: "Waiting for decryption result", status: "pending" },
      { label: "Finalizing unwrap", status: "pending" },
      { label: "Waiting for finalization confirmation", status: "pending" },
    ];
    setTxTitle("Unwrapping cUSDC -> USDC");
    setTxSteps(steps);
    setTxError("");
    setTxModalOpen(true);
    setBusy(true);

    try {
      // cUSDC unwrap requires encrypted amount (ERC7984ERC20Wrapper signature)
      // unwrap(address from, address to, externalEuint64 encryptedAmount, bytes inputProof)
      updateStep(0, "active");
      await new Promise(r => setTimeout(r, 50)); // let React paint modal
      const encrypted = await encryptUint64(CUSDC_ADDRESS, account, parseUnits(amount, 6));
      updateStep(0, "done");

      updateStep(1, "active");
      const hash = await cusdcWrite("unwrap", [account, account, encrypted.handles[0], encrypted.inputProof]);
      updateStep(1, "done");

      updateStep(2, "active");
      const receipt = await waitTx(hash);
      updateStep(2, "done");

      updateStep(3, "active");
      const handle = parseUnwrapRequestedHandle(receipt, "USDC");
      const pending: PendingUnwrap = {
        token: "USDC",
        contractAddress: CUSDC_ADDRESS,
        handle,
        txHash: hash,
        blockNumber: receipt.blockNumber,
      };
      const decrypted = await runPublicDecrypt(pending, true);
      updateStep(3, "done");

      updateStep(4, "active");
      const hash2 = await cusdcWrite("finalizeUnwrap", [decrypted.handle, decrypted.cleartext!, decrypted.decryptionProof!]);
      updateStep(4, "done");

      updateStep(5, "active");
      await waitTx(hash2);
      updateStep(5, "done");

      setPendingUnwraps((prev) => prev.filter((item) => item.handle.toLowerCase() !== handle.toLowerCase()));
      await Promise.all([loadBalances(), loadEncryptedHandles(), refreshPendingUnwraps()]);
      setCusdcDecrypted(null);
    } catch (err: unknown) {
      console.error(err);
      const msg = (err as Error).message?.slice(0, 120) || "Transaction failed";
      setTxError(msg);
      markActiveAsError();
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const candidates = pendingUnwraps.filter((item) => item.status === "requested");
    if (candidates.length === 0) return;

    void (async () => {
      for (const item of candidates) {
        try {
          await runPublicDecrypt(item);
        } catch {
          // keep item visible for manual retry after refresh
        }
      }
    })();
  }, [pendingUnwraps]);

  return (
    <div className="max-w-5xl mx-auto">
      {/* Hero Banner */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2.5 mb-3">
          <div className="relative shield-pulse">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
              <path
                d="M16 2L4 8v8c0 7.18 5.12 13.9 12 16 6.88-2.1 12-8.82 12-16V8L16 2z"
                fill="url(#vault-grad)"
                fillOpacity="0.15"
                stroke="url(#vault-grad)"
                strokeWidth="1.5"
              />
              <rect x="11" y="13" width="10" height="8" rx="1.5" fill="none" stroke="#3b82f6" strokeWidth="1.5" />
              <path d="M14 13v-2a2 2 0 0 1 4 0v2" fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" />
              <defs>
                <linearGradient id="vault-grad" x1="4" y1="2" x2="28" y2="26">
                  <stop stopColor="#3b82f6" />
                  <stop offset="1" stopColor="#22c55e" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            <span className="text-blue-400">Confidential</span>{" "}
            <span className="text-slate-100">Vault</span>
          </h1>
        </div>
        <p className="text-sm text-slate-500 max-w-lg mx-auto">
          Wrap your assets into encrypted tokens (ERC-7984). Confidential balances are protected by fully homomorphic encryption.
        </p>
      </div>

      {/* Connect Wallet prompt */}
      {!account && (
        <div className="text-center py-12">
          <div className="inline-flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="6" width="20" height="14" rx="2" />
                <path d="M2 10h20" />
                <path d="M6 14h.01" />
              </svg>
            </div>
            <p className="text-slate-400 text-sm">Connect your wallet to manage confidential tokens</p>
            <button
              onClick={connect}
              className="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white px-6 py-2.5 rounded-full text-sm font-medium transition-all duration-200 shadow-[0_0_20px_rgba(59,130,246,0.3)] hover:shadow-[0_0_30px_rgba(59,130,246,0.4)] cursor-pointer"
            >
              Connect Wallet
            </button>
          </div>
        </div>
      )}

      {/* Token Selector + Card */}
      {account && (
        <div className="max-w-lg mx-auto">
          {/* Token selector */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs text-slate-500 uppercase tracking-wider">Token</span>
            <select
              value={selectedToken}
              onChange={(e) => setSelectedToken(e.target.value as "ETH" | "USDC")}
              className="bg-[#111827] border border-[#1e293b] text-slate-200 text-sm font-medium rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500/50 transition cursor-pointer"
            >
              <option value="ETH">ETH ↔ cWETH</option>
              <option value="USDC">USDC ↔ cUSDC</option>
            </select>
          </div>

          {/* Active card */}
          <VaultCard
            title={selectedToken === "ETH" ? "ETH ↔ cWETH" : "USDC ↔ cUSDC"}
            symbol={selectedToken}
            contractAddress={selectedToken === "ETH" ? CWETH_ADDRESS : CUSDC_ADDRESS}
            plaintextBalance={selectedToken === "ETH" ? ethBalance : usdcBalance}
            plaintextLoading={balancesLoading}
            encryptedHandle={selectedToken === "ETH" ? cwethHandle : cusdcHandle}
            decryptedBalance={selectedToken === "ETH" ? cwethDecrypted : cusdcDecrypted}
            decryptLoading={selectedToken === "ETH" ? cwethDecrypting : cusdcDecrypting}
            onDecrypt={handleDecryptAll}
            onWrap={selectedToken === "ETH" ? handleWrapETH : handleWrapUSDC}
            onUnwrap={selectedToken === "ETH" ? handleUnwrapETH : handleUnwrapUSDC}
            busy={busy}
            account={account}
          />

          {/* Pending unwraps for selected token */}
          <PendingUnwrapList
            title={selectedToken === "ETH" ? "cWETH" : "cUSDC"}
            items={pendingUnwraps.filter((item) => item.token === selectedToken)}
            onFinalize={(item) => { void finalizePendingUnwrap(item); }}
          />
        </div>
      )}

      {/* Transfer History */}
      {account && (
        <div className="max-w-lg mx-auto mt-6">
          <div className="bg-[#111827] border border-[#1e293b] rounded-2xl overflow-hidden gradient-border">
            <div className="px-5 py-4 border-b border-[#1e293b] flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                {selectedToken === "ETH" ? "cWETH" : "cUSDC"} History
                {!transfersLoading && transfers.length > 0 && ` (${transfers.length})`}
              </h3>
              {transfers.length > 0 && !transfers.every((t) => t.decryptedAmount !== undefined) && (
                <button
                  onClick={handleDecryptHistory}
                  disabled={decryptingHistory}
                  className="text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors disabled:text-slate-600 disabled:no-underline cursor-pointer disabled:cursor-not-allowed"
                >
                  {decryptingHistory ? "Decrypting..." : "Decrypt Amounts"}
                </button>
              )}
            </div>
            <div className="px-5 py-3">
              {transfersLoading ? (
                <div className="flex items-center justify-center py-4">
                  <div className="w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full spinner" />
                </div>
              ) : transfers.length === 0 ? (
                <div className="text-xs text-slate-600 py-2">No transactions yet</div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {transfers.map((t, i) => {
                    const dirLabel = t.direction === "wrap" ? "Wrap" : t.direction === "unwrap" ? "Unwrap" : t.direction === "in" ? "Received" : "Sent";
                    const dirColor = t.direction === "wrap" || t.direction === "in" ? "text-emerald-400" : "text-red-400";
                    const dirSign = t.direction === "wrap" || t.direction === "in" ? "+" : "-";
                    const otcAddr = CONTRACT_ADDRESS.toLowerCase();
                    const rawAddr = t.direction === "wrap" ? "" : t.direction === "unwrap" ? "" : t.direction === "in" ? t.from : t.to;
                    const counterparty = t.direction === "wrap" ? "Mint"
                      : t.direction === "unwrap" ? "Burn"
                      : rawAddr.toLowerCase() === otcAddr ? "OTC Contract"
                      : `${rawAddr.slice(0, 6)}...${rawAddr.slice(-4)}`;
                    return (
                      <div key={`${t.txHash}-${i}`} className="flex items-center justify-between py-2 border-b border-[#1e293b]/30 last:border-0">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-medium ${dirColor}`}>{dirLabel}</span>
                            {counterparty !== "Mint" && counterparty !== "Burn" && (
                              <span className={`text-[10px] font-mono ${counterparty === "OTC Contract" ? "text-purple-400" : "text-slate-600"}`}>
                                {counterparty}
                              </span>
                            )}
                          </div>
                          <a href={`https://sepolia.etherscan.io/tx/${t.txHash}`} target="_blank" rel="noopener noreferrer"
                            className="text-[10px] text-slate-600 hover:text-blue-400 font-mono transition-colors">
                            Tx {t.txHash.slice(0, 10)}...{t.txHash.slice(-4)}
                          </a>
                        </div>
                        <div className="text-right">
                          {t.decryptedAmount !== undefined ? (
                            <span className={`text-sm font-medium ${dirColor}`}>
                              {dirSign}{t.decryptedAmount.toLocaleString()} c{selectedToken === "ETH" ? "WETH" : "USDC"}
                            </span>
                          ) : (
                            <span className="encrypted-badge inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] text-blue-400 border border-blue-500/20">
                              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                              Encrypted
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Privacy info */}
      {account && (
        <div className="mt-8 flex items-start gap-2.5 bg-blue-500/5 border border-blue-500/10 rounded-xl p-4 max-w-2xl mx-auto">
          <svg className="mt-0.5 flex-shrink-0" width="16" height="16" viewBox="0 0 32 32" fill="none">
            <path d="M16 2L4 8v8c0 7.18 5.12 13.9 12 16 6.88-2.1 12-8.82 12-16V8L16 2z" fill="#3b82f6" fillOpacity="0.2" stroke="#3b82f6" strokeWidth="1.5" />
            <path d="M12 16l3 3 5-6" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-xs text-blue-300/70 leading-relaxed">
            Wrapped confidential tokens use Fully Homomorphic Encryption (FHE) to keep your balances private on-chain. Only you can decrypt and view your balance. Wrap and unwrap operations convert between standard tokens and their confidential counterparts at a 1:1 ratio.
          </span>
        </div>
      )}

      {/* Transaction Modal */}
      <TransactionModal
        open={txModalOpen}
        title={txTitle}
        steps={txSteps}
        error={txError}
        onClose={() => {
          setTxModalOpen(false);
          setTxError("");
        }}
      />
    </div>
  );
}
