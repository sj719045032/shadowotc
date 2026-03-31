import {
  readContract,
  writeContract,
  waitForTransactionReceipt,
  getPublicClient,
  getWalletClient,
  getAccount,
} from "@wagmi/core";
import { decodeEventLog, parseAbiItem, parseUnits, formatUnits, getAddress, type Abi } from "viem";
import { config } from "../wagmi";
import ABI from "./abi.json";
import CWETH_ABI from "./cweth-abi.json";
import CUSDC_ABI from "./cusdc-abi.json";

export const CONTRACT_ADDRESS = (import.meta.env.VITE_CONTRACT_ADDRESS || "") as `0x${string}`;
export const USDC_ADDRESS = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as `0x${string}`;
export const CWETH_ADDRESS = (import.meta.env.VITE_CWETH_ADDRESS || "") as `0x${string}`;
export const CUSDC_ADDRESS = (import.meta.env.VITE_CUSDC_ADDRESS || "") as `0x${string}`;
export const SEPOLIA_CHAIN_ID = 11155111;
const CWETH_DEPLOY_BLOCK = 10558864n;
const CUSDC_DEPLOY_BLOCK = 10558865n;
const OTC_DEPLOY_BLOCK = 10558866n;

export type PendingUnwrap = {
  token: "ETH" | "USDC";
  contractAddress: `0x${string}`;
  handle: `0x${string}`;
  txHash: `0x${string}`;
  blockNumber: bigint;
};

export const ZERO_FHE_HANDLE = ("0x" + "0".repeat(64)) as `0x${string}`;

const OTC_ABI = ABI as Abi;
const CWETH_CONTRACT_ABI = CWETH_ABI as Abi;
const CUSDC_CONTRACT_ABI = CUSDC_ABI as Abi;

const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

// ─── Read helpers ──────────────────────────────────────────────

export async function getETHBalance(address: string): Promise<string> {
  const client = getPublicClient(config);
  const balance = await client.getBalance({ address: address as `0x${string}` });
  return formatUnits(balance, 18);
}

export async function getUSDCBalance(address: string): Promise<string> {
  const balance = await readContract(config, {
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [address as `0x${string}`],
  });
  return formatUnits(balance as bigint, 6);
}

// ─── OTC Contract reads ────────────────────────────────────────

export async function otcRead<T = unknown>(functionName: string, args: unknown[] = [], account?: `0x${string}`): Promise<T> {
  return readContract(config, {
    address: CONTRACT_ADDRESS,
    abi: OTC_ABI,
    functionName,
    args,
    ...(account ? { account } : {}),
  }) as Promise<T>;
}

export async function otcWrite(functionName: string, args: unknown[] = [], value?: bigint): Promise<`0x${string}`> {
  return writeContract(config, {
    address: CONTRACT_ADDRESS,
    abi: OTC_ABI,
    functionName,
    args,
    ...(value !== undefined ? { value } : {}),
  });
}

export async function waitTx(hash: `0x${string}`) {
  return waitForTransactionReceipt(config, { hash });
}

// ─── Wrapper token reads ───────────────────────────────────────

export async function cwethRead<T = unknown>(functionName: string, args: unknown[] = []): Promise<T> {
  return readContract(config, {
    address: CWETH_ADDRESS,
    abi: CWETH_CONTRACT_ABI,
    functionName,
    args,
  }) as Promise<T>;
}

export async function cusdcRead<T = unknown>(functionName: string, args: unknown[] = []): Promise<T> {
  return readContract(config, {
    address: CUSDC_ADDRESS,
    abi: CUSDC_CONTRACT_ABI,
    functionName,
    args,
  }) as Promise<T>;
}

// ─── Wrapper token writes ──────────────────────────────────────

export async function cwethWrite(functionName: string, args: unknown[] = [], value?: bigint): Promise<`0x${string}`> {
  return writeContract(config, {
    address: CWETH_ADDRESS,
    abi: CWETH_CONTRACT_ABI,
    functionName,
    args,
    ...(value !== undefined ? { value } : {}),
  });
}

export async function cusdcWrite(functionName: string, args: unknown[] = [], value?: bigint): Promise<`0x${string}`> {
  return writeContract(config, {
    address: CUSDC_ADDRESS,
    abi: CUSDC_CONTRACT_ABI,
    functionName,
    args,
    ...(value !== undefined ? { value } : {}),
  });
}

// ─── USDC ERC-20 writes ───────────────────────────────────────

export async function usdcApprove(spender: `0x${string}`, amount: bigint): Promise<`0x${string}`> {
  return writeContract(config, {
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender, amount],
  });
}

export async function usdcAllowance(owner: `0x${string}`, spender: `0x${string}`): Promise<bigint> {
  return readContract(config, {
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, spender],
  }) as Promise<bigint>;
}

// ─── Data types ────────────────────────────────────────────────

export type OrderData = {
  id: number;
  tokenPair: string;
  isBuy: boolean;
  status: number;
  createdAt: number;
  baseDeposit: string;
  quoteDeposit: string;
  baseRemaining: string;
  quoteRemaining: string;
};

export type FillData = {
  orderId: number;
  ethTransferred: string;
  tokenTransferred: string;
  filledAt: number;
};

export type AccessStatus = {
  hasRequested: boolean;
  hasAccess: boolean;
  isMaker: boolean;
};

// ─── Maker check ──────────────────────────────────────────────

export async function checkIsMaker(orderId: number): Promise<boolean> {
  const account = getAccount(config).address;
  if (!account) return false;
  return otcRead<boolean>("isMaker", [orderId], account);
}

// ─── Order fetchers ────────────────────────────────────────────

export async function fetchAllOrders(): Promise<OrderData[]> {
  const count = await otcRead<bigint>("orderCount");
  const indices = Array.from({ length: Number(count) }, (_, i) => i);
  const results = await Promise.all(indices.map(i => otcRead<readonly unknown[]>("getOrder", [i])));
  return results.map((o, i) => ({
    id: i,
    tokenPair: o[0] as string,
    isBuy: o[1] as boolean,
    status: Number(o[2]),
    createdAt: Number(o[3]),
    baseDeposit: formatUnits((o[4] as bigint) ?? 0n, 18),
    quoteDeposit: formatUnits((o[5] as bigint) ?? 0n, 6),
    baseRemaining: formatUnits((o[6] as bigint) ?? 0n, 18),
    quoteRemaining: formatUnits((o[7] as bigint) ?? 0n, 6),
  }));
}

export async function fetchMyFillIds(): Promise<number[]> {
  const account = getAccount(config).address;
  if (!account) return [];
  const ids = await otcRead<readonly bigint[]>("getMyFills", [], account);
  return ids.map((id) => Number(id));
}

export async function fetchFillDetail(fillId: number): Promise<FillData> {
  const f = await otcRead<readonly unknown[]>("getFill", [fillId]);
  return {
    orderId: Number(f[0]),
    filledAt: Number(f[1]),
    ethTransferred: formatUnits((f[2] as bigint) ?? 0n, 18),
    tokenTransferred: formatUnits((f[3] as bigint) ?? 0n, 6),
  };
}

export async function fetchOrderFillIds(orderId: number): Promise<number[]> {
  const ids = await otcRead<readonly bigint[]>("getOrderFills", [orderId]);
  return ids.map((id) => Number(id));
}

// ─── Operator setup (one-time per user) ────────────────────────

export async function needsOperatorSetup(): Promise<boolean> {
  if (!CONTRACT_ADDRESS || !CWETH_ADDRESS || !CUSDC_ADDRESS) return false;
  const account = getAccount(config);
  if (!account.address) return false;
  const address = account.address;
  const [cwethOk, cusdcOk] = await Promise.all([
    cwethRead<boolean>("isOperator", [address, CONTRACT_ADDRESS]),
    cusdcRead<boolean>("isOperator", [address, CONTRACT_ADDRESS]),
  ]);
  return !cwethOk || !cusdcOk;
}

export async function ensureOperatorSet(): Promise<void> {
  if (!CONTRACT_ADDRESS || !CWETH_ADDRESS || !CUSDC_ADDRESS) return;
  const account = getAccount(config);
  if (!account.address) return;
  const address = account.address;
  const maxUint48 = 281474976710655n; // type(uint48).max

  const [cwethOk, cusdcOk] = await Promise.all([
    cwethRead<boolean>("isOperator", [address, CONTRACT_ADDRESS]),
    cusdcRead<boolean>("isOperator", [address, CONTRACT_ADDRESS]),
  ]);

  if (!cwethOk) {
    const hash = await cwethWrite("setOperator", [CONTRACT_ADDRESS, maxUint48]);
    await waitTx(hash);
  }
  if (!cusdcOk) {
    const hash = await cusdcWrite("setOperator", [CONTRACT_ADDRESS, maxUint48]);
    await waitTx(hash);
  }
}


// ─── Access management ─────────────────────────────────────────

export async function getAccessRequests(orderId: number): Promise<string[]> {
  const account = getAccount(config).address;
  if (!account) return [];
  try {
    return await otcRead<string[]>("getAccessRequests", [orderId], account);
  } catch {
    return [];
  }
}

export async function getGrantedAddresses(orderId: number): Promise<string[]> {
  const account = getAccount(config).address;
  if (!account) return [];
  try {
    return await otcRead<string[]>("getGrantedAddresses", [orderId], account);
  } catch {
    return [];
  }
}

export async function getAccessStatus(orderId: number): Promise<AccessStatus> {
  const account = getAccount(config).address;
  if (!account) {
    return { hasRequested: false, hasAccess: false, isMaker: false };
  }

  const status = await otcRead<readonly [boolean, boolean, boolean]>("getAccessStatus", [orderId], account);
  return {
    hasRequested: status[0],
    hasAccess: status[1],
    isMaker: status[2],
  };
}

// ─── Pending fill recovery ────────────────────────────────────

// ─── Token transfer history ───────────────────────────────────

export type TransferRecord = {
  token: "ETH" | "USDC";
  direction: "wrap" | "unwrap" | "in" | "out";
  from: `0x${string}`;
  to: `0x${string}`;
  amountHandle: `0x${string}`;
  txHash: `0x${string}`;
  blockNumber: bigint;
  timestamp?: number;
  decryptedAmount?: number;
};

export async function getTransferHistory(
  userAddress: `0x${string}`,
  token: "ETH" | "USDC",
): Promise<TransferRecord[]> {
  const client = getPublicClient(config);
  const contractAddress = token === "ETH" ? CWETH_ADDRESS : CUSDC_ADDRESS;
  const fromBlock = token === "ETH" ? CWETH_DEPLOY_BLOCK : CUSDC_DEPLOY_BLOCK;
  if (!contractAddress) return [];

  const transferEvent = parseAbiItem("event ConfidentialTransfer(address indexed from, address indexed to, bytes32 indexed amount)");
  const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as `0x${string}`;

  const [outLogs, inLogs] = await Promise.all([
    client.getLogs({ address: contractAddress, event: transferEvent, args: { from: userAddress }, fromBlock, toBlock: "latest" }),
    client.getLogs({ address: contractAddress, event: transferEvent, args: { to: userAddress }, fromBlock, toBlock: "latest" }),
  ]);

  // Deduplicate (wrap mint: from=0x0,to=user appears in inLogs; self-transfers appear in both)
  const seen = new Set<string>();
  const records: TransferRecord[] = [];

  for (const log of [...outLogs, ...inLogs]) {
    const key = `${log.transactionHash}-${log.logIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const from = (log.args.from || ZERO_ADDR) as `0x${string}`;
    const to = (log.args.to || ZERO_ADDR) as `0x${string}`;
    const handle = (log.args.amount || "0x") as `0x${string}`;

    let direction: TransferRecord["direction"];
    if (from === ZERO_ADDR) direction = "wrap";
    else if (to === ZERO_ADDR) direction = "unwrap";
    else if (to.toLowerCase() === userAddress.toLowerCase()) direction = "in";
    else direction = "out";

    records.push({ token, direction, from, to, amountHandle: handle, txHash: log.transactionHash, blockNumber: log.blockNumber });
  }

  return records.sort((a, b) => Number(b.blockNumber - a.blockNumber));
}

// ─── Pending fill recovery ────────────────────────────────────

export type PendingFillInfo = {
  pendingFillId: number;
  orderId: number;
  txHash: `0x${string}`;
  blockNumber: bigint;
};

export function parseFillInitiatedId(logs: readonly { data: `0x${string}`; topics: readonly `0x${string}`[] }[]): bigint {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi: OTC_ABI, data: log.data, topics: log.topics }) as unknown as { eventName: string; args: Record<string, unknown> };
      if (decoded.eventName === "FillInitiated") {
        return BigInt((decoded.args.pendingFillId ?? decoded.args[0] ?? 0) as string | number | bigint);
      }
    } catch { /* not this event */ }
  }
  return 0n;
}

export function parseFillCancelledReason(logs: readonly { data: `0x${string}`; topics: readonly `0x${string}`[] }[]): string | null {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi: OTC_ABI, data: log.data, topics: log.topics }) as unknown as { eventName: string; args: Record<string, unknown> };
      if (decoded.eventName === "FillCancelled") {
        const r = (decoded.args.reason as string) || "Fill cancelled";
        if (r === "Price mismatch") return "Fill cancelled: your bid price did not meet the maker's asking price.";
        if (r === "Zero fill") return "Fill cancelled: no tokens could be matched. Check your balance and fill amount.";
        return `Fill cancelled: ${r}`;
      }
    } catch { /* not this event */ }
  }
  return null;
}

export async function getPendingFillsForOrder(orderId: number): Promise<PendingFillInfo[]> {
  const client = getPublicClient(config);
  const initiatedEvent = parseAbiItem("event FillInitiated(uint256 indexed pendingFillId, uint256 indexed orderId)");
  const settledEvent = parseAbiItem("event FillSettled(uint256 indexed pendingFillId, uint256 indexed orderId)");
  // Only fetch initiated and settled for this orderId.
  // FillCancelled has no orderId topic, so we check on-chain status for non-settled IDs instead.
  const [initiatedLogs, settledLogs] = await Promise.all([
    client.getLogs({
      address: CONTRACT_ADDRESS,
      event: initiatedEvent,
      args: { orderId: BigInt(orderId) },
      fromBlock: OTC_DEPLOY_BLOCK,
      toBlock: "latest",
    }),
    client.getLogs({
      address: CONTRACT_ADDRESS,
      event: settledEvent,
      args: { orderId: BigInt(orderId) },
      fromBlock: OTC_DEPLOY_BLOCK,
      toBlock: "latest",
    }),
  ]);

  const completedIds = new Set<number>();
  for (const log of settledLogs) {
    const decoded = decodeEventLog({ abi: OTC_ABI, data: log.data, topics: log.topics }) as unknown as { args: Record<string, unknown> };
    completedIds.add(Number(decoded.args.pendingFillId));
  }

  // Check on-chain status for remaining IDs instead of scanning all FillCancelled events
  const initiatedIds = initiatedLogs.map((log) => {
    const decoded = decodeEventLog({ abi: OTC_ABI, data: log.data, topics: log.topics }) as unknown as { args: Record<string, unknown> };
    return Number(decoded.args.pendingFillId);
  });
  const nonSettledIds = initiatedIds.filter((id) => !completedIds.has(id));
  const pfResults = await Promise.all(
    nonSettledIds.map((id) => otcRead<readonly [bigint, number, bigint, bigint]>("getPendingFill", [id])),
  );
  pfResults.forEach((pf, i) => {
    if (pf[1] !== 0) completedIds.add(nonSettledIds[i]);
  });

  return initiatedLogs
    .map((log) => {
      const decoded = decodeEventLog({ abi: OTC_ABI, data: log.data, topics: log.topics }) as unknown as { args: Record<string, unknown> };
      return {
        pendingFillId: Number(decoded.args.pendingFillId),
        orderId: Number(decoded.args.orderId),
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
      } satisfies PendingFillInfo;
    })
    .filter((f) => !completedIds.has(f.pendingFillId));
}

// ─── Utilities ─────────────────────────────────────────────────

async function fetchPendingUnwrapsForToken(
  contractAddress: `0x${string}`,
  abi: Abi,
  receiver: `0x${string}`,
  fromBlock: bigint,
  token: "ETH" | "USDC",
): Promise<PendingUnwrap[]> {
  const client = getPublicClient(config);
  const requestedEvent = parseAbiItem("event UnwrapRequested(address indexed receiver, bytes32 amount)");
  const finalizedEvent = parseAbiItem("event UnwrapFinalized(address indexed receiver, bytes32 encryptedAmount, uint64 cleartextAmount)");

  const [requestedLogs, finalizedLogs] = await Promise.all([
    client.getLogs({
      address: contractAddress,
      event: requestedEvent,
      args: { receiver },
      fromBlock,
      toBlock: "latest",
    }),
    client.getLogs({
      address: contractAddress,
      event: finalizedEvent,
      args: { receiver },
      fromBlock,
      toBlock: "latest",
    }),
  ]);

  const finalizedHandles = new Set(
    finalizedLogs.map((log) => {
      const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics }) as unknown as { args: Record<string, unknown> };
      return (decoded.args.encryptedAmount as `0x${string}`).toLowerCase();
    }),
  );

  return requestedLogs
    .map((log) => {
      const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics }) as unknown as { args: Record<string, unknown> };
      return {
        token,
        contractAddress,
        handle: decoded.args.amount as `0x${string}`,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
      } satisfies PendingUnwrap;
    })
    .filter((request) => !finalizedHandles.has(request.handle.toLowerCase()));
}

export async function getPendingUnwraps(receiver: `0x${string}`): Promise<PendingUnwrap[]> {
  const [cwethResults, cusdcResults] = await Promise.all([
    CWETH_ADDRESS ? fetchPendingUnwrapsForToken(CWETH_ADDRESS, CWETH_CONTRACT_ABI, receiver, CWETH_DEPLOY_BLOCK, "ETH") : [],
    CUSDC_ADDRESS ? fetchPendingUnwrapsForToken(CUSDC_ADDRESS, CUSDC_CONTRACT_ABI, receiver, CUSDC_DEPLOY_BLOCK, "USDC") : [],
  ]);

  return [...cwethResults, ...cusdcResults].sort((a, b) => Number(b.blockNumber - a.blockNumber));
}

export async function getWalletClientInstance() {
  return getWalletClient(config);
}

export { parseUnits, formatUnits, getAddress };
export { config };
