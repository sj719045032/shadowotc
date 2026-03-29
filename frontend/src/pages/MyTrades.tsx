import { useState, useEffect } from "react";
import { fetchAllOrders, type OrderData, getContract, CONTRACT_ADDRESS } from "../lib/contract";
import { useWallet } from "../App";
import { decryptValues } from "../lib/fhevm";

type DecryptedOrder = OrderData & {
  decryptedPrice?: number;
  decryptedAmount?: number;
  decrypting?: boolean;
};

export default function MyTrades() {
  const { account, connect } = useWallet();
  const [orders, setOrders] = useState<DecryptedOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (account) loadMyOrders();
  }, [account]);

  async function loadMyOrders() {
    try {
      setLoading(true);
      const all = await fetchAllOrders();
      const mine = all.filter(
        (o) =>
          o.maker.toLowerCase() === account.toLowerCase() ||
          o.taker.toLowerCase() === account.toLowerCase(),
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
                decryptedPrice: Number(values[0] || 0n),
                decryptedAmount: Number(values[1] || 0n),
                decrypting: false,
              }
            : o,
        ),
      );
    } catch (err) {
      console.error("Decrypt failed:", err);
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, decrypting: false } : o)),
      );
    }
  }

  if (!account) {
    return (
      <div className="text-center py-20">
        <div className="text-4xl mb-4">🔐</div>
        <div className="text-slate-400 mb-4">Connect your wallet to view your trades</div>
        <button
          onClick={connect}
          className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium transition cursor-pointer"
        >
          Connect Wallet
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">My Trades</h1>
          <p className="text-slate-400 text-sm mt-1">
            Orders you created or filled. Click "Decrypt" to reveal encrypted details.
          </p>
        </div>
        <button
          onClick={loadMyOrders}
          className="text-sm text-slate-400 hover:text-white border border-[#2a3a52] rounded-lg px-4 py-2 transition cursor-pointer"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="text-center py-20 text-slate-400">Loading...</div>
      ) : orders.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-4xl mb-4">📭</div>
          <div className="text-slate-400">No trades yet.</div>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((o) => (
            <div
              key={o.id}
              className="bg-[#1a2235] border border-[#2a3a52] rounded-xl p-5"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-mono text-slate-400">#{o.id}</span>
                  <span className="font-bold">{o.tokenPair}</span>
                  <span className={`text-sm font-bold ${o.isBuy ? "text-green-400" : "text-red-400"}`}>
                    {o.isBuy ? "BUY" : "SELL"}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      o.status === 0
                        ? "bg-green-500/20 text-green-400"
                        : o.status === 1
                          ? "bg-blue-500/20 text-blue-400"
                          : "bg-slate-500/20 text-slate-400"
                    }`}
                  >
                    {["Open", "Filled", "Cancelled"][o.status]}
                  </span>
                </div>
                <span className="text-xs text-slate-500">
                  {o.maker.toLowerCase() === account.toLowerCase() ? "You are Maker" : "You are Taker"}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-slate-400 mb-1">Price</div>
                  {o.decryptedPrice !== undefined ? (
                    <div className="text-lg font-bold text-green-400">${o.decryptedPrice.toLocaleString()}</div>
                  ) : (
                    <div className="text-sm text-slate-500">🔒 Encrypted</div>
                  )}
                </div>
                <div>
                  <div className="text-xs text-slate-400 mb-1">Amount</div>
                  {o.decryptedAmount !== undefined ? (
                    <div className="text-lg font-bold text-green-400">
                      {o.decryptedAmount.toLocaleString()} {o.tokenPair.split("/")[0]}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500">🔒 Encrypted</div>
                  )}
                </div>
              </div>

              {o.decryptedPrice === undefined && (
                <button
                  onClick={() => handleDecrypt(o.id)}
                  disabled={o.decrypting}
                  className="mt-4 w-full bg-[#111827] hover:bg-[#0a0e17] border border-[#2a3a52] text-slate-300 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50 cursor-pointer"
                >
                  {o.decrypting ? "Decrypting..." : "🔓 Decrypt Details"}
                </button>
              )}

              {o.decryptedPrice !== undefined && o.decryptedAmount !== undefined && (
                <div className="mt-3 pt-3 border-t border-[#2a3a52] flex justify-between text-sm">
                  <span className="text-slate-400">Total Value</span>
                  <span className="font-bold text-blue-400">
                    ${(o.decryptedPrice * o.decryptedAmount).toLocaleString()} {o.tokenPair.split("/")[1]}
                  </span>
                </div>
              )}

              {o.taker !== "0x0000000000000000000000000000000000000000" && (
                <div className="mt-2 text-xs text-slate-500">
                  Counterparty: {o.taker.slice(0, 6)}...{o.taker.slice(-4)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
