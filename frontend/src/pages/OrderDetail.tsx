import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getContract, CONTRACT_ADDRESS, approveUSDC, parseUnits, formatUnits } from "../lib/contract";
import { useWallet } from "../App";
import { encryptInputs, decryptValues, unscaleFromFHE } from "../lib/fhevm";

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { account, connect } = useWallet();
  const orderId = Number(id);

  const [order, setOrder] = useState<{
    maker: string; tokenPair: string; isBuy: boolean; status: number;
    createdAt: number; ethDeposit: string; tokenDeposit: string;
    ethRemaining: string; tokenRemaining: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [decryptedPrice, setDecryptedPrice] = useState<number | null>(null);
  const [decryptedAmount, setDecryptedAmount] = useState<number | null>(null);
  const [decrypting, setDecrypting] = useState(false);
  const [decryptError, setDecryptError] = useState("");
  const [fillAmount, setFillAmount] = useState("");
  const [filling, setFilling] = useState(false);
  const [fillError, setFillError] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => { loadOrder(); }, [orderId]);

  async function loadOrder() {
    try {
      setLoading(true);
      const contract = await getContract();
      const o = await contract.getOrder(orderId);
      setOrder({
        maker: o[0], tokenPair: o[1], isBuy: o[2], status: Number(o[3]),
        createdAt: Number(o[4]),
        ethDeposit: formatUnits(o[5] ?? 0n, 18),
        tokenDeposit: formatUnits(o[6] ?? 0n, 6),
        ethRemaining: formatUnits(o[7] ?? 0n, 18),
        tokenRemaining: formatUnits(o[8] ?? 0n, 6),
      });
    } catch {
      setOrder(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleDecrypt() {
    if (!account) { await connect(); return; }
    try {
      setDecrypting(true); setDecryptError("");
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
      const p = unscaleFromFHE(Number(values[0] || 0n));
      const a = unscaleFromFHE(Number(values[1] || 0n));
      setDecryptedPrice(p);
      setDecryptedAmount(a);
      setFillAmount(String(a));
    } catch {
      setDecryptError("Access denied. Ask the maker to grant you access first.");
    } finally {
      setDecrypting(false);
    }
  }

  async function handleFill() {
    if (!account || !decryptedPrice || !fillAmount) return;
    const fillAmt = Number(fillAmount);
    const price = decryptedPrice;
    try {
      setFilling(true); setFillError("");
      const encrypted = await encryptInputs(account, price, fillAmt);
      const contract = await getContract(true);
      if (order!.isBuy) {
        const ethAmt = String(fillAmt);
        const tx = await contract.fillOrder(orderId, encrypted.handles[0], encrypted.inputProof, encrypted.handles[1], encrypted.inputProof, parseUnits(ethAmt, 18), 0, { value: parseUnits(ethAmt, 18) });
        await tx.wait();
      } else {
        const usdcAmt = String(fillAmt * price);
        if (Number(usdcAmt) > 0) await approveUSDC(usdcAmt);
        const tx = await contract.fillOrder(orderId, encrypted.handles[0], encrypted.inputProof, encrypted.handles[1], encrypted.inputProof, 0, parseUnits(usdcAmt, 6));
        await tx.wait();
      }
      await loadOrder();
    } catch (err) {
      setFillError((err as Error).message?.slice(0, 100) || "Transaction failed");
    } finally {
      setFilling(false);
    }
  }

  async function handleGrantAccess() {
    const addr = window.prompt("Enter taker address:");
    if (!addr?.startsWith("0x") || addr.length !== 42) return;
    const contract = await getContract(true);
    const tx = await contract.grantAccess(orderId, addr);
    await tx.wait();
  }

  if (loading) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full spinner" /></div>;
  if (!order) return <div className="text-center py-20 text-slate-400">Order #{orderId} not found</div>;

  const isMaker = account?.toLowerCase() === order.maker.toLowerCase();
  const deposit = order.isBuy ? `${Number(order.tokenDeposit).toLocaleString()} USDC` : `${Number(order.ethDeposit).toFixed(6)} ETH`;
  const remaining = order.isBuy ? `${Number(order.tokenRemaining).toLocaleString()} USDC` : `${Number(order.ethRemaining).toFixed(6)} ETH`;
  const usdcToPay = decryptedPrice && fillAmount ? (Number(fillAmount) * decryptedPrice).toLocaleString() : "—";

  return (
    <div className="max-w-2xl mx-auto">
      {/* Back button */}
      <button onClick={() => navigate("/")} className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-blue-400 mb-6 transition cursor-pointer">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        Back to Order Book
      </button>

      {/* Header */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-2xl overflow-hidden gradient-border card-glow mb-6">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold text-white">Order #{orderId}</span>
              <span className={`text-xs font-bold px-2.5 py-1 rounded ${order.isBuy ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                {order.isBuy ? "BUY" : "SELL"}
              </span>
              <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${
                order.status === 0 ? "bg-emerald-500/10 text-emerald-400 status-open" : order.status === 1 ? "bg-blue-500/10 text-blue-400" : "bg-slate-500/10 text-slate-500"
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${order.status === 0 ? "bg-emerald-400" : order.status === 1 ? "bg-blue-400" : "bg-slate-500"}`} />
                {["Open", "Filled", "Cancelled"][order.status]}
              </span>
            </div>
            <span className="text-lg font-medium text-slate-300">{order.tokenPair}</span>
          </div>

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-[#0d1117] rounded-xl p-4 border border-[#1e293b]/50">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Deposit</div>
              <div className="text-lg font-bold text-white">{deposit}</div>
            </div>
            <div className="bg-[#0d1117] rounded-xl p-4 border border-[#1e293b]/50">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Remaining</div>
              <div className="text-lg font-bold text-white">{remaining}</div>
            </div>
          </div>

          {/* Maker info */}
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Maker: <span className="font-mono text-slate-400">{order.maker.slice(0, 8)}...{order.maker.slice(-6)}</span></span>
            <span>{new Date(order.createdAt * 1000).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Price & Amount section */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-2xl overflow-hidden gradient-border mb-6">
        <div className="p-6">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">Encrypted Terms</h3>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-[#0d1117] rounded-xl p-4 border border-[#1e293b]/50">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Price</div>
              {decryptedPrice !== null ? (
                <div className="text-xl font-bold text-emerald-400 decrypt-reveal">${decryptedPrice.toLocaleString()}</div>
              ) : (
                <div className="encrypted-badge inline-flex items-center gap-1.5 border border-blue-500/20 rounded px-2.5 py-1 text-xs text-blue-300/80">🔒 Encrypted</div>
              )}
            </div>
            <div className="bg-[#0d1117] rounded-xl p-4 border border-[#1e293b]/50">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Amount</div>
              {decryptedAmount !== null ? (
                <div className="text-xl font-bold text-emerald-400 decrypt-reveal">{decryptedAmount} {order.tokenPair.split("/")[0]}</div>
              ) : (
                <div className="encrypted-badge inline-flex items-center gap-1.5 border border-blue-500/20 rounded px-2.5 py-1 text-xs text-blue-300/80">🔒 Encrypted</div>
              )}
            </div>
          </div>

          {decryptedPrice === null && (
            <>
              {decryptError && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-3 text-sm text-red-400">
                  🚫 {decryptError}
                </div>
              )}
              <button onClick={handleDecrypt} disabled={decrypting}
                className="w-full bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 py-3 rounded-xl text-sm font-medium transition cursor-pointer disabled:opacity-50">
                {decrypting ? "Decrypting..." : "🔓 Decrypt Order Details"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Fill section - only for non-maker, open orders, after decrypt */}
      {!isMaker && order.status === 0 && decryptedPrice !== null && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-2xl overflow-hidden gradient-border mb-6">
          <div className="p-6">
            <h3 className="text-sm font-semibold text-slate-300 mb-4">Fill This Order</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Fill Amount ({order.tokenPair.split("/")[0]})</label>
                <input type="number" value={fillAmount} onChange={(e) => setFillAmount(e.target.value)}
                  step="any" min="0.000001" max={decryptedAmount || undefined}
                  className="w-full bg-[#0d1117] border border-[#1e293b] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500/50 transition" />
              </div>
              {Number(fillAmount) > 0 && (
                <div className="bg-[#0d1117] rounded-xl p-4 border border-[#1e293b]/50 space-y-2">
                  <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Settlement Preview</div>
                  {order.isBuy ? (
                    <>
                      <div className="flex justify-between text-sm"><span className="text-slate-400">You pay</span><span className="text-red-400 font-medium">{fillAmount} ETH</span></div>
                      <div className="flex justify-between text-sm"><span className="text-slate-400">You receive</span><span className="text-emerald-400 font-medium">{usdcToPay} USDC</span></div>
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between text-sm"><span className="text-slate-400">You pay</span><span className="text-red-400 font-medium">{usdcToPay} USDC</span></div>
                      <div className="flex justify-between text-sm"><span className="text-slate-400">You receive</span><span className="text-emerald-400 font-medium">{fillAmount} ETH</span></div>
                    </>
                  )}
                </div>
              )}
              {fillError && <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-3">{fillError}</div>}
              <button onClick={handleFill} disabled={filling || !fillAmount || Number(fillAmount) <= 0}
                className={`w-full py-3.5 rounded-xl font-semibold transition cursor-pointer disabled:opacity-50 ${
                  order.isBuy ? "bg-gradient-to-r from-red-600 to-red-500 text-white" : "bg-gradient-to-r from-emerald-600 to-emerald-500 text-white"
                }`}>
                {filling ? "Encrypting & Filling..." : order.isBuy ? "Fill (send ETH)" : "Approve USDC & Fill"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Maker actions */}
      {isMaker && order.status === 0 && (
        <div className="flex gap-3">
          <button onClick={handleGrantAccess}
            className="flex-1 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 text-purple-400 py-3 rounded-xl text-sm font-medium transition cursor-pointer">
            Grant Access
          </button>
          <button onClick={() => { const url = window.location.href; navigator.clipboard.writeText(url); setCopiedLink(true); setTimeout(() => setCopiedLink(false), 2000); }}
            className="flex-1 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 text-cyan-400 py-3 rounded-xl text-sm font-medium transition cursor-pointer">
            {copiedLink ? "✓ Copied!" : "Share Link"}
          </button>
        </div>
      )}
    </div>
  );
}
