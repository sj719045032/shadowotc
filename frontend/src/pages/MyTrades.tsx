import { useState, useEffect, useMemo } from "react";
import { fetchAllOrders, type OrderData, getContract, CONTRACT_ADDRESS } from "../lib/contract";
import { useWallet } from "../App";
import { decryptValues, unscaleFromFHE } from "../lib/fhevm";

type DecryptedOrder = OrderData & {
  decryptedPrice?: number;
  decryptedAmount?: number;
  decrypting?: boolean;
  justDecrypted?: boolean;
};

export default function MyTrades() {
  const { account, connect } = useWallet();
  const [orders, setOrders] = useState<DecryptedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [grantingAccess, setGrantingAccess] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [grantModal, setGrantModal] = useState<{ orderId: number; address: string } | null>(null);
  const [grantSuccess, setGrantSuccess] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    if (account) loadMyOrders();
  }, [account]);

  async function loadMyOrders() {
    try {
      setLoading(true);
      const all = await fetchAllOrders();
      // Note: taker is now encrypted (eaddress), so we can only filter by maker
      // In a full implementation, we'd also track fills per taker address
      const mine = all.filter(
        (o) => o.maker.toLowerCase() === account.toLowerCase(),
      );
      setOrders(mine.reverse());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function handleDecrypt(orderId: number) {
    try {
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, decrypting: true } : o)),
      );

      const contract = await getContract();
      const encPrice = await contract.getPrice(orderId);
      const encAmount = await contract.getAmount(orderId);

      const results = await decryptValues(
        [
          { handle: encPrice.toString(), contractAddress: CONTRACT_ADDRESS },
          { handle: encAmount.toString(), contractAddress: CONTRACT_ADDRESS },
        ],
        account,
      );

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
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, decrypting: false } : o)),
      );
    }
  }

  async function handleGrantAccessSubmit() {
    if (!grantModal || !grantModal.address.startsWith("0x") || grantModal.address.length !== 42) return;

    try {
      setGrantingAccess(grantModal.orderId);
      const contract = await getContract(true);
      const tx = await contract.grantAccess(grantModal.orderId, grantModal.address);
      await tx.wait();
      setGrantSuccess(grantModal.orderId);
      setGrantModal(null);
      setTimeout(() => setGrantSuccess(null), 3000);
    } catch (err) {
      console.error("Grant access failed:", err);
    } finally {
      setGrantingAccess(null);
    }
  }

  function handleShareLink(orderId: number) {
    const url = `${window.location.origin}/?order=${orderId}`;
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
        <div className="border border-[#1e293b] rounded-xl overflow-hidden gradient-border">
          {orders.map((o, idx) => {
            const isExpanded = expandedId === o.id;
            const isMaker = o.maker.toLowerCase() === account.toLowerCase();
            const deposit = o.isBuy ? `${Number(o.tokenDeposit).toLocaleString()} USDC` : `${Number(o.ethDeposit).toFixed(4)} ETH`;
            return (
            <div key={o.id} className={`${idx > 0 ? "border-t border-[#1e293b]" : ""} row-enter`} style={{ animationDelay: `${idx * 40}ms` }}>
              {/* Compact row */}
              <div
                onClick={() => setExpandedId(isExpanded ? null : o.id)}
                className="flex items-center gap-3 px-4 py-3 hover:bg-[#1a2235]/50 cursor-pointer transition-colors"
              >
                <span className="font-mono text-xs text-slate-500 w-8">#{o.id}</span>
                <span className="font-medium text-sm text-slate-200 w-24">{o.tokenPair}</span>
                <span className={`text-xs font-bold w-12 ${o.isBuy ? "text-emerald-400" : "text-red-400"}`}>{o.isBuy ? "BUY" : "SELL"}</span>
                <span className="text-xs text-slate-400 w-28">{deposit}</span>
                <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ${
                  o.status === 0 ? "bg-emerald-500/10 text-emerald-400" : o.status === 1 ? "bg-blue-500/10 text-blue-400" : "bg-slate-500/10 text-slate-500"
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${o.status === 0 ? "bg-emerald-400" : o.status === 1 ? "bg-blue-400" : "bg-slate-500"}`} />
                  {["Open", "Filled", "Cancelled"][o.status]}
                </span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ml-auto ${isMaker ? "bg-purple-500/10 text-purple-400" : "bg-cyan-500/10 text-cyan-400"}`}>
                  {isMaker ? "Maker" : "Taker"}
                </span>
                <svg className={`w-4 h-4 text-slate-500 transition-transform ${isExpanded ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="px-4 pb-4 pt-1 bg-[#0d1117]/50 border-t border-[#1e293b]/50 space-y-3 page-fade-in">
                  {/* Price & Amount */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-[#111827] rounded-lg p-3 border border-[#1e293b]/50">
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Price</div>
                      {o.decryptedPrice !== undefined ? (
                        <div className={`text-lg font-bold text-emerald-400 ${o.justDecrypted ? "decrypt-reveal" : ""}`}>${o.decryptedPrice.toLocaleString()}</div>
                      ) : (
                        <div className="encrypted-badge inline-flex items-center gap-1.5 border border-blue-500/20 rounded px-2 py-0.5 text-xs text-blue-300/80">🔒 Encrypted</div>
                      )}
                    </div>
                    <div className="bg-[#111827] rounded-lg p-3 border border-[#1e293b]/50">
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Amount</div>
                      {o.decryptedAmount !== undefined ? (
                        <div className={`text-lg font-bold text-emerald-400 ${o.justDecrypted ? "decrypt-reveal" : ""}`}>{o.decryptedAmount} {o.tokenPair.split("/")[0]}</div>
                      ) : (
                        <div className="encrypted-badge inline-flex items-center gap-1.5 border border-blue-500/20 rounded px-2 py-0.5 text-xs text-blue-300/80">🔒 Encrypted</div>
                      )}
                    </div>
                  </div>

                  {/* Total value */}
                  {o.decryptedPrice !== undefined && o.decryptedAmount !== undefined && (
                    <div className={`flex justify-between items-center text-sm bg-[#111827] rounded-lg p-3 border border-[#1e293b]/50 ${o.justDecrypted ? "decrypt-reveal" : ""}`}>
                      <span className="text-slate-400">Total Value</span>
                      <span className="font-bold text-blue-400">${(o.decryptedPrice * o.decryptedAmount).toLocaleString()}</span>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    {o.decryptedPrice === undefined && (
                      <button onClick={() => handleDecrypt(o.id)} disabled={o.decrypting}
                        className="flex-1 flex items-center justify-center gap-1.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 py-2 rounded-lg text-xs font-medium transition cursor-pointer disabled:opacity-50">
                        {o.decrypting ? <><span className="w-3 h-3 border-2 border-blue-400/30 border-t-blue-400 rounded-full spinner"/>Decrypting...</> : "🔓 Decrypt"}
                      </button>
                    )}
                    {isMaker && o.status === 0 && (
                      <>
                        <button onClick={() => setGrantModal({ orderId: o.id, address: "" })}
                          className="flex-1 flex items-center justify-center gap-1.5 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 text-purple-400 py-2 rounded-lg text-xs font-medium transition cursor-pointer">
                          Grant Access
                        </button>
                        <button onClick={() => handleShareLink(o.id)}
                          className="flex-1 flex items-center justify-center gap-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 text-cyan-400 py-2 rounded-lg text-xs font-medium transition cursor-pointer">
                          {copiedId === o.id ? "✓ Copied!" : "Share Link"}
                        </button>
                      </>
                    )}
                  </div>

                  {/* Timestamp */}
                  <div className="text-[10px] text-slate-600">{new Date(o.createdAt * 1000).toLocaleString()}</div>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
