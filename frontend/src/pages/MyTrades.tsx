import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { fetchAllOrders, type OrderData, getContract, CONTRACT_ADDRESS, fetchMyFillIds, fetchFillDetail, formatUnits } from "../lib/contract";
import { useWallet } from "../App";
import { decryptValues, unscaleFromFHE } from "../lib/fhevm";
import TransactionModal, { type Step } from "../components/TransactionModal";

type DecryptedOrder = OrderData & {
  decryptedPrice?: number;
  decryptedAmount?: number;
  decrypting?: boolean;
  justDecrypted?: boolean;
};

export default function MyTrades() {
  const navigate = useNavigate();
  const { account, connect } = useWallet();
  const [orders, setOrders] = useState<DecryptedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [grantingAccess, setGrantingAccess] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [grantModal, setGrantModal] = useState<{ orderId: number; address: string } | null>(null);
  const [grantSuccess, setGrantSuccess] = useState<number | null>(null);

  // Transaction modal state
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [txModalTitle, setTxModalTitle] = useState("");
  const [txSteps, setTxSteps] = useState<Step[]>([]);
  const [txError, setTxError] = useState("");

  function openTxModal(title: string, steps: Step[]) {
    setTxModalTitle(title);
    setTxSteps(steps);
    setTxError("");
    setTxModalOpen(true);
  }

  function updateTxStep(idx: number, status: Step["status"]) {
    setTxSteps((prev) => prev.map((s, i) => i === idx ? { ...s, status } : s));
  }

  function failTxModal(msg: string) {
    setTxError(msg);
    setTxSteps((prev) => prev.map((s) => s.status === "active" ? { ...s, status: "error" } : s));
  }

  useEffect(() => {
    if (account) loadMyOrders();
  }, [account]);

  async function loadMyOrders() {
    try {
      setLoading(true);
      const all = await fetchAllOrders();
      const makerOrders = all.filter(
        (o) => o.maker.toLowerCase() === account.toLowerCase(),
      );

      // Also fetch orders where user is a taker (via fills)
      let takerOrders: OrderData[] = [];
      try {
        const fillIds = await fetchMyFillIds();
        const seenOrderIds = new Set(makerOrders.map((o) => o.id));
        const takerOrderIds = new Set<number>();
        for (const fid of fillIds) {
          const detail = await fetchFillDetail(fid);
          if (!seenOrderIds.has(detail.orderId) && !takerOrderIds.has(detail.orderId)) {
            takerOrderIds.add(detail.orderId);
          }
        }
        if (takerOrderIds.size > 0) {
          const contract = await getContract();
          for (const oid of takerOrderIds) {
            const o = await contract.getOrder(oid);
            takerOrders.push({
              id: oid,
              maker: o.maker ?? o[0],
              tokenPair: o.tokenPair ?? o[1],
              isBuy: o.isBuy ?? o[2],
              status: Number(o.status ?? o[3]),
              createdAt: Number(o.createdAt ?? o[4]),
              ethDeposit: formatUnits(o.ethDeposit ?? o[5] ?? 0n, 18),
              tokenDeposit: formatUnits(o.tokenDeposit ?? o[6] ?? 0n, 6),
              ethRemaining: formatUnits(o.ethRemaining ?? o[7] ?? 0n, 18),
              tokenRemaining: formatUnits(o.tokenRemaining ?? o[8] ?? 0n, 6),
            });
          }
        }
      } catch {
        // getMyFills may not be available yet; silently ignore
      }

      const merged = [...makerOrders, ...takerOrders];
      merged.sort((a, b) => b.createdAt - a.createdAt);
      setOrders(merged);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function handleDecrypt(orderId: number) {
    const steps: Step[] = [
      { label: "Generating keypair", status: "pending" },
      { label: "Signing request", status: "pending" },
      { label: "Decrypting via KMS", status: "pending" },
    ];
    openTxModal("Decrypting Order #" + orderId, steps);

    try {
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, decrypting: true } : o)),
      );

      updateTxStep(0, "active");
      const contract = await getContract();
      const encPrice = await contract.getPrice(orderId);
      const encAmount = await contract.getAmount(orderId);
      updateTxStep(0, "done");

      updateTxStep(1, "active");
      const results = await decryptValues(
        [
          { handle: encPrice.toString(), contractAddress: CONTRACT_ADDRESS },
          { handle: encAmount.toString(), contractAddress: CONTRACT_ADDRESS },
        ],
        account,
      );
      updateTxStep(1, "done");

      updateTxStep(2, "active");
      const values = [...results.values()];

      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId
            ? {
                ...o,
                decryptedPrice: unscaleFromFHE(Number(values[0] || 0n)),
                decryptedAmount: unscaleFromFHE(Number(values[1] || 0n)),
                decrypting: false,
                justDecrypted: true,
              }
            : o,
        ),
      );
      updateTxStep(2, "done");

      // Remove the animation flag after it plays
      setTimeout(() => {
        setOrders((prev) =>
          prev.map((o) =>
            o.id === orderId ? { ...o, justDecrypted: false } : o,
          ),
        );
      }, 700);
    } catch (err) {
      console.error("Decrypt failed:", err);
      failTxModal("Decrypt failed. You may not have access to this order.");
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, decrypting: false } : o)),
      );
    }
  }

  async function handleGrantAccessSubmit() {
    if (!grantModal || !grantModal.address.startsWith("0x") || grantModal.address.length !== 42) return;

    const steps: Step[] = [
      { label: "Submitting grant access", status: "pending" },
      { label: "Waiting for confirmation", status: "pending" },
    ];
    const oid = grantModal.orderId;
    openTxModal("Granting Access", steps);

    try {
      setGrantingAccess(oid);

      updateTxStep(0, "active");
      const contract = await getContract(true);
      const tx = await contract.grantAccess(oid, grantModal.address);
      updateTxStep(0, "done");

      updateTxStep(1, "active");
      await tx.wait();
      updateTxStep(1, "done");

      setGrantSuccess(oid);
      setGrantModal(null);
      setTimeout(() => setGrantSuccess(null), 3000);
    } catch (err) {
      console.error("Grant access failed:", err);
      failTxModal((err as Error).message?.slice(0, 100) || "Grant access failed");
    } finally {
      setGrantingAccess(null);
    }
  }

  function handleShareLink(orderId: number) {
    const url = `${window.location.origin}/order/${orderId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(orderId);
      setTimeout(() => setCopiedId(null), 2000);
    }).catch(() => {
      // fallback
      window.prompt("Copy this link:", url);
    });
  }

  // Portfolio value from decrypted orders
  const portfolioValue = useMemo(() => {
    let total = 0;
    let hasDecrypted = false;
    orders.forEach((o) => {
      if (o.decryptedPrice !== undefined && o.decryptedAmount !== undefined) {
        total += o.decryptedPrice * o.decryptedAmount;
        hasDecrypted = true;
      }
    });
    return { total, hasDecrypted };
  }, [orders]);

  if (!account) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-blue-500/10 mb-5">
          <svg className="shield-pulse" width="36" height="36" viewBox="0 0 32 32" fill="none">
            <path d="M16 2L4 8v8c0 7.18 5.12 13.9 12 16 6.88-2.1 12-8.82 12-16V8L16 2z" fill="#3b82f6" fillOpacity="0.15" stroke="#3b82f6" strokeWidth="1.5"/>
            <rect x="12" y="13" width="8" height="7" rx="1" stroke="#3b82f6" strokeWidth="1.5"/>
            <path d="M14 13v-2a2 2 0 014 0v2" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
        <div className="text-slate-200 font-semibold text-lg mb-2">Wallet Required</div>
        <div className="text-slate-500 text-sm mb-5 text-center max-w-xs">Connect your wallet to view and decrypt your trades</div>
        <button
          onClick={connect}
          className="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white px-6 py-2.5 rounded-full text-sm font-medium transition-all duration-200 shadow-[0_0_20px_rgba(59,130,246,0.3)] cursor-pointer"
        >
          Connect Wallet
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Grant Access Modal */}
      {grantModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) setGrantModal(null); }}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative bg-[#111827] border border-[#1e293b] rounded-2xl w-full max-w-md overflow-hidden gradient-border">
            <div className="px-6 pt-6 pb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Grant Access</h3>
              <button onClick={() => setGrantModal(null)} className="text-slate-500 hover:text-slate-300 transition cursor-pointer">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="px-6 pb-6 space-y-4">
              <p className="text-sm text-slate-400">Enter the wallet address to grant view access to Order #{grantModal.orderId}'s encrypted price and amount.</p>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Wallet Address</label>
                <input
                  type="text"
                  value={grantModal.address}
                  onChange={(e) => setGrantModal({ ...grantModal, address: e.target.value })}
                  placeholder="0x..."
                  className="w-full bg-[#0d1117] border border-[#1e293b] rounded-xl px-4 py-3 text-white font-mono text-sm placeholder-slate-600 focus:outline-none focus:border-purple-500/50 transition-all duration-200"
                />
              </div>
              <button
                onClick={handleGrantAccessSubmit}
                disabled={grantingAccess !== null || !grantModal.address.startsWith("0x") || grantModal.address.length !== 42}
                className="w-full bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 text-white py-3 rounded-xl font-medium transition-all duration-200 cursor-pointer disabled:cursor-not-allowed shadow-[0_0_20px_rgba(168,85,247,0.2)]"
              >
                {grantingAccess !== null ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full spinner" />
                    Granting...
                  </span>
                ) : "Grant View Access"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Grant success toast */}
      {grantSuccess !== null && (
        <div className="fixed top-20 right-6 z-50 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl px-5 py-3 text-sm font-medium shadow-lg backdrop-blur-sm page-fade-in flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Access granted for Order #{grantSuccess}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">My Trades</h1>
          <p className="text-slate-400 text-sm mt-1">
            Orders you created or filled. Decrypt to reveal hidden details.
          </p>
        </div>
        <button
          onClick={loadMyOrders}
          className="self-start flex items-center gap-1.5 text-xs text-slate-400 hover:text-blue-400 border border-[#1e293b] hover:border-blue-500/30 rounded-lg px-3 py-1.5 transition-all duration-200 cursor-pointer"
        >
          <svg className={loading ? "spinner" : ""} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m0 0a9 9 0 019-9m-9 9a9 9 0 009 9"/>
          </svg>
          Refresh
        </button>
      </div>

      {/* Portfolio Value */}
      {portfolioValue.hasDecrypted && (
        <div className="mb-6 rounded-xl overflow-hidden gradient-border card-glow">
          <div className="bg-gradient-to-r from-[#111827] to-[#0f172a] p-5 sm:p-6">
            <div className="flex items-center gap-2 mb-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
              </svg>
              <span className="text-xs text-slate-400 uppercase tracking-wider font-medium">Decrypted Portfolio Value</span>
            </div>
            <div className="stat-value text-3xl sm:text-4xl font-bold text-white">
              ${portfolioValue.total.toLocaleString()}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Based on {orders.filter((o) => o.decryptedPrice !== undefined).length} decrypted order{orders.filter((o) => o.decryptedPrice !== undefined).length !== 1 ? "s" : ""}
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full spinner" />
          <span className="text-slate-400 text-sm">Loading your trades...</span>
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-20">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-800/50 mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/>
            </svg>
          </div>
          <div className="text-slate-300 font-medium mb-1">No trades yet</div>
          <div className="text-slate-500 text-sm">Create or fill an order to see it here.</div>
        </div>
      ) : (
        <div className="border border-[#1e293b] rounded-xl overflow-hidden gradient-border card-glow">
          <table className="w-full">
            <thead>
              <tr className="bg-[#111827]/80 text-slate-500 text-[11px] uppercase tracking-wider">
                <th className="text-left px-4 py-3 font-semibold">ID</th>
                <th className="text-left px-4 py-3 font-semibold">Pair</th>
                <th className="text-left px-4 py-3 font-semibold">Side</th>
                <th className="text-left px-4 py-3 font-semibold">Price</th>
                <th className="text-left px-4 py-3 font-semibold">Amount</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-left px-4 py-3 font-semibold">Role</th>
                <th className="text-right px-4 py-3 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o, idx) => {
                const isMaker = o.maker.toLowerCase() === account.toLowerCase();
                return (
                  <tr key={o.id} onClick={() => navigate('/order/' + o.id)} className={`border-t border-[#1e293b]/60 hover:bg-blue-500/[0.03] transition-colors row-enter cursor-pointer`} style={{ animationDelay: `${idx * 50}ms` }}>
                    <td className="px-4 py-3.5 font-mono text-xs text-slate-500">#{o.id}</td>
                    <td className="px-4 py-3.5 text-sm font-medium text-slate-200">{o.tokenPair}</td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded ${o.isBuy ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${o.isBuy ? "bg-emerald-400" : "bg-red-400"}`} />
                        {o.isBuy ? "BUY" : "SELL"}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      {o.decryptedPrice !== undefined ? (
                        <span className={`text-sm font-medium text-emerald-400 ${o.justDecrypted ? "decrypt-reveal" : ""}`}>${o.decryptedPrice.toLocaleString()}</span>
                      ) : (
                        <span className="encrypted-badge inline-flex items-center gap-1.5 border border-blue-500/20 rounded-md px-2.5 py-1 text-[11px] text-blue-300/80">🔒 Encrypted</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      {o.decryptedAmount !== undefined ? (
                        <span className={`text-sm font-medium text-emerald-400 ${o.justDecrypted ? "decrypt-reveal" : ""}`}>{o.decryptedAmount} {o.tokenPair.split("/")[0]}</span>
                      ) : (
                        <span className="encrypted-badge inline-flex items-center gap-1.5 border border-blue-500/20 rounded-md px-2.5 py-1 text-[11px] text-blue-300/80">🔒 Encrypted</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-0.5 rounded-full ${
                        o.status === 0 ? "bg-emerald-500/10 text-emerald-400 status-open" : o.status === 1 ? "bg-blue-500/10 text-blue-400" : "bg-slate-500/10 text-slate-500"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${o.status === 0 ? "bg-emerald-400" : o.status === 1 ? "bg-blue-400" : "bg-slate-500"}`} />
                        {["Open", "Filled", "Cancelled"][o.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${isMaker ? "bg-purple-500/10 text-purple-400" : "bg-cyan-500/10 text-cyan-400"}`}>
                        {isMaker ? "Maker" : "Taker"}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {o.decryptedPrice === undefined && (
                          <button onClick={(e) => { e.stopPropagation(); handleDecrypt(o.id); }} disabled={o.decrypting}
                            className="text-[11px] px-2.5 py-1 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 rounded-lg transition cursor-pointer disabled:opacity-50">
                            {o.decrypting ? "..." : "Decrypt"}
                          </button>
                        )}
                        {isMaker && o.status === 0 && (
                          <>
                            <button onClick={(e) => { e.stopPropagation(); setGrantModal({ orderId: o.id, address: "" }); }}
                              className="text-[11px] px-2.5 py-1 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 text-purple-400 rounded-lg transition cursor-pointer">
                              Grant
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); handleShareLink(o.id); }}
                              className="text-[11px] px-2.5 py-1 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 text-cyan-400 rounded-lg transition cursor-pointer">
                              {copiedId === o.id ? "✓" : "Share"}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Transaction Modal */}
      <TransactionModal
        open={txModalOpen}
        title={txModalTitle}
        steps={txSteps}
        error={txError}
        onClose={() => { setTxModalOpen(false); setTxError(""); }}
      />
    </div>
  );
}
