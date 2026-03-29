import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getContract, approveUSDC, getUSDCBalance, getETHBalance, parseUnits } from "../lib/contract";
import { encryptInputs } from "../lib/fhevm";
import { useWallet } from "../App";

const TOKEN_PAIRS = ["ETH/USDC", "BTC/USDC", "SOL/USDC", "AVAX/USDC", "MATIC/USDC"];

// Which step are we on
function computeStep(pair: string, price: string, amount: string, submitting: boolean) {
  if (submitting) return 3;
  if (pair && price && amount) return 3;
  if (pair) return 2;
  return 1;
}

// Scramble text for encryption animation
function EncryptionAnimation() {
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
    <div className="flex items-center justify-center py-8">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-500/10 mb-4 encrypt-pulse">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0110 0v4"/>
          </svg>
        </div>
        <div className="text-sm text-blue-400 font-medium mb-3">Encrypting your order...</div>
        <div className="font-mono text-xs text-blue-500/60 tracking-wider overflow-hidden">
          <span className="text-blue-400/40">0x</span>
          {chars.map((c, i) => (
            <span key={i} className="scramble-char" style={{ animationDelay: `${i * 0.05}s` }}>
              {c}
            </span>
          ))}
        </div>
        <div className="text-xs text-slate-500 mt-3">FHE encryption in progress...</div>
      </div>
    </div>
  );
}

export default function CreateOrder() {
  const { account, connect } = useWallet();
  const navigate = useNavigate();
  const [pair, setPair] = useState("ETH/USDC");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [price, setPrice] = useState("");
  const [amount, setAmount] = useState("");
  const deposit = side === "sell" ? amount : (price && amount ? String(Number(price) * Number(amount)) : "");
  const [usdcBalance, setUsdcBalance] = useState("");
  const [ethBalance, setEthBalance] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (account) {
      getUSDCBalance(account).then(setUsdcBalance).catch(() => {});
      getETHBalance(account).then(setEthBalance).catch(() => {});
    }
  }, [account]);

  const currentStep = computeStep(pair, price, amount, submitting);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!account) {
      await connect();
      return;
    }

    const priceNum = Number(price);
    const amountNum = Number(amount);
    if (!priceNum || !amountNum) {
      setError("Price and amount must be greater than 0");
      return;
    }

    if (!deposit || Number(deposit) <= 0) {
      setError("Deposit amount must be greater than 0");
      return;
    }

    try {
      setSubmitting(true);

      // Encrypt price and amount using fhEVM
      const encrypted = await encryptInputs(account, priceNum, amountNum);

      const contract = await getContract(true);

      if (side === "buy") {
        // BUY order: deposit USDC (approve + transferFrom)
        await approveUSDC(deposit);
        const tx = await contract.createOrder(
          encrypted.handles[0],
          encrypted.inputProof,
          encrypted.handles[1],
          encrypted.inputProof,
          true,
          pair,
          parseUnits(deposit, 6),
        );
        await tx.wait();
      } else {
        // SELL order: deposit ETH (sent as msg.value)
        const tx = await contract.createOrder(
          encrypted.handles[0],
          encrypted.inputProof,
          encrypted.handles[1],
          encrypted.inputProof,
          false,
          pair,
          0,
          { value: parseUnits(deposit, 18) },
        );
        await tx.wait();
      }

      navigate("/");
    } catch (err: unknown) {
      console.error(err);
      setError((err as Error).message?.slice(0, 100) || "Transaction failed");
    } finally {
      setSubmitting(false);
    }
  }, [account, connect, price, amount, side, pair, navigate]);

  const steps = [
    { num: 1, label: "Select Pair" },
    { num: 2, label: "Set Terms" },
    { num: 3, label: "Encrypt & Submit" },
  ];

  const depositLabel = side === "sell" ? "ETH Deposit" : "USDC Deposit";
  const depositUnit = side === "sell" ? "ETH" : "USDC";
  const relevantBalance = side === "sell" ? ethBalance : usdcBalance;

  return (
    <div className="max-w-2xl mx-auto">
      {/* Step Indicator */}
      <div className="flex items-center justify-center mb-8 gap-0">
        {steps.map((s, idx) => (
          <div key={s.num} className="flex items-center">
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                currentStep >= s.num
                  ? currentStep === s.num
                    ? "bg-blue-500 text-white shadow-[0_0_15px_rgba(59,130,246,0.4)] step-active"
                    : "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                  : "bg-[#1a2235] text-slate-600 border border-[#1e293b]"
              }`}>
                {currentStep > s.num ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                ) : s.num}
              </div>
              <span className={`text-xs font-medium hidden sm:block transition-colors duration-300 ${
                currentStep >= s.num ? "text-slate-300" : "text-slate-600"
              }`}>
                {s.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div className={`w-8 sm:w-12 h-px mx-2 sm:mx-3 transition-colors duration-300 ${
                currentStep > s.num ? "bg-blue-500/40" : "bg-[#1e293b]"
              }`} />
            )}
          </div>
        ))}
      </div>

      {/* Submitting overlay */}
      {submitting && (
        <div className="rounded-2xl bg-[#111827] border border-blue-500/20 gradient-border mb-6 overflow-hidden">
          <EncryptionAnimation />
        </div>
      )}

      <form onSubmit={handleSubmit} className={`space-y-6 ${submitting ? "opacity-30 pointer-events-none" : ""}`}>
        {/* Step 1: Token Pair */}
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 sm:p-6 gradient-border">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-6 h-6 rounded-full bg-blue-500/10 flex items-center justify-center">
              <span className="text-xs font-bold text-blue-400">1</span>
            </div>
            <h3 className="text-sm font-semibold text-slate-200">Select Trading Pair</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {TOKEN_PAIRS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPair(p)}
                className={`px-4 py-2.5 rounded-lg text-sm font-medium border transition-all duration-200 cursor-pointer ${
                  pair === p
                    ? "border-blue-500/50 bg-blue-500/15 text-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.15)]"
                    : "border-[#1e293b] bg-[#0d1117] text-slate-400 hover:border-slate-600 hover:text-slate-300"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Step 2: Order Terms */}
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 sm:p-6 gradient-border">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-6 h-6 rounded-full bg-blue-500/10 flex items-center justify-center">
              <span className="text-xs font-bold text-blue-400">2</span>
            </div>
            <h3 className="text-sm font-semibold text-slate-200">Set Order Terms</h3>
          </div>

          {/* Side selector */}
          <div className="mb-5">
            <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">Side</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSide("buy")}
                className={`py-3.5 rounded-xl text-sm font-bold border-2 transition-all duration-200 cursor-pointer ${
                  side === "buy"
                    ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400 shadow-[0_0_20px_rgba(34,197,94,0.1)]"
                    : "border-[#1e293b] bg-[#0d1117] text-slate-500 hover:border-slate-600"
                }`}
              >
                <span className="flex items-center justify-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 11 12 6 7 11"/><line x1="12" y1="18" x2="12" y2="6"/></svg>
                  BUY
                </span>
                <span className="block text-[10px] font-normal mt-0.5 opacity-70">Deposit USDC</span>
              </button>
              <button
                type="button"
                onClick={() => setSide("sell")}
                className={`py-3.5 rounded-xl text-sm font-bold border-2 transition-all duration-200 cursor-pointer ${
                  side === "sell"
                    ? "border-red-500/50 bg-red-500/10 text-red-400 shadow-[0_0_20px_rgba(239,68,68,0.1)]"
                    : "border-[#1e293b] bg-[#0d1117] text-slate-500 hover:border-slate-600"
                }`}
              >
                <span className="flex items-center justify-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="7 13 12 18 17 13"/><line x1="12" y1="6" x2="12" y2="18"/></svg>
                  SELL
                </span>
                <span className="block text-[10px] font-normal mt-0.5 opacity-70">Deposit ETH</span>
              </button>
            </div>
          </div>

          {/* Price */}
          <div className="mb-5">
            <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">
              Price (USD)
            </label>
            <div className="relative">
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                min="1"
                className="w-full bg-[#0d1117] border border-[#1e293b] rounded-xl px-4 py-3.5 text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 focus:shadow-[0_0_12px_rgba(59,130,246,0.1)] transition-all duration-200"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-xs text-slate-500">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                FHE
              </div>
            </div>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">
              Amount
            </label>
            <div className="relative">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                min="1"
                className="w-full bg-[#0d1117] border border-[#1e293b] rounded-xl px-4 py-3.5 text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 focus:shadow-[0_0_12px_rgba(59,130,246,0.1)] transition-all duration-200"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-xs text-slate-500">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                FHE
              </div>
            </div>
          </div>
        </div>

        {/* Step 3: Summary + Submit */}
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 sm:p-6 gradient-border">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-6 h-6 rounded-full bg-blue-500/10 flex items-center justify-center">
              <span className="text-xs font-bold text-blue-400">3</span>
            </div>
            <h3 className="text-sm font-semibold text-slate-200">Review & Encrypt</h3>
          </div>

          {price && amount ? (
            <div className="mb-5 space-y-3">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Action</span>
                <span className={`font-semibold ${side === "buy" ? "text-emerald-400" : "text-red-400"}`}>
                  {side === "buy" ? "Buying" : "Selling"} {pair.split("/")[0]}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Amount</span>
                <span className="font-medium text-slate-200">{Number(amount).toLocaleString()} {pair.split("/")[0]}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Price</span>
                <span className="font-medium text-slate-200">${Number(price).toLocaleString()} {pair.split("/")[1]}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">{depositLabel} (auto)</span>
                <span className="font-medium text-slate-200">{deposit ? Number(deposit).toLocaleString() : "—"} {depositUnit}</span>
              </div>

              {/* Balances */}
              <div className="flex justify-between items-center text-xs text-slate-500">
                <span>Your Balances:</span>
                <div className="flex gap-3">
                  {ethBalance && (
                    <span className={side === "sell" ? "text-blue-400" : ""}>
                      {Number(ethBalance).toFixed(4)} ETH
                    </span>
                  )}
                  {usdcBalance && (
                    <span className={side === "buy" ? "text-blue-400" : ""}>
                      {Number(usdcBalance).toLocaleString()} USDC
                    </span>
                  )}
                </div>
              </div>

              {relevantBalance && Number(deposit) > Number(relevantBalance) && (
                <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                  Insufficient {depositUnit} balance
                </div>
              )}

              <div className="h-px bg-[#1e293b]" />
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Total Value</span>
                <span className="font-bold text-lg text-blue-400">
                  ${(Number(price) * Number(amount)).toLocaleString()}
                </span>
              </div>

              {/* Privacy notice */}
              <div className="flex items-start gap-2.5 bg-blue-500/5 border border-blue-500/10 rounded-lg p-3 mt-2">
                <svg className="mt-0.5 flex-shrink-0" width="14" height="14" viewBox="0 0 32 32" fill="none">
                  <path d="M16 2L4 8v8c0 7.18 5.12 13.9 12 16 6.88-2.1 12-8.82 12-16V8L16 2z" fill="#3b82f6" fillOpacity="0.2" stroke="#3b82f6" strokeWidth="1.5"/>
                  <path d="M12 16l3 3 5-6" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-xs text-blue-300/70 leading-relaxed">
                  Price, amount, and total will be encrypted using FHE before submission.
                  {side === "sell"
                    ? " ETH will be sent with the transaction as collateral."
                    : " USDC will be approved and transferred as collateral."}
                </span>
              </div>
            </div>
          ) : (
            <div className="text-center py-6 text-slate-600 text-sm">
              Enter price and amount above to see order summary
            </div>
          )}

          {error && (
            <div className="mb-4 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !price || !amount}
            className={`w-full py-3.5 rounded-xl font-semibold transition-all duration-200 cursor-pointer disabled:cursor-not-allowed disabled:shadow-none ${
              side === "sell"
                ? "bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 text-white shadow-[0_0_20px_rgba(239,68,68,0.2)] hover:shadow-[0_0_30px_rgba(239,68,68,0.3)]"
                : "bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 text-white shadow-[0_0_20px_rgba(34,197,94,0.2)] hover:shadow-[0_0_30px_rgba(34,197,94,0.3)]"
            }`}
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full spinner" />
                Encrypting & Submitting...
              </span>
            ) : !account ? (
              "Connect Wallet"
            ) : (
              <span className="flex items-center justify-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0110 0v4"/>
                </svg>
                {side === "sell"
                  ? `Create SELL Order (deposit ${deposit} ETH)`
                  : `Create BUY Order (deposit ${deposit} USDC)`}
              </span>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
