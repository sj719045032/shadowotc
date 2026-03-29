import { BrowserProvider, Contract, getAddress, parseUnits, formatUnits } from "ethers";
import ABI from "./abi.json";

export const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || "";
export const USDC_ADDRESS = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
export const SEPOLIA_CHAIN_ID = 11155111;

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

export function getProvider() {
  if (!window.ethereum) throw new Error("MetaMask not found");
  return new BrowserProvider(window.ethereum);
}

export async function getSigner() {
  const provider = getProvider();
  return provider.getSigner();
}

export async function getContract(withSigner = false) {
  if (!CONTRACT_ADDRESS) throw new Error("Contract address not configured");
  if (withSigner) {
    const signer = await getSigner();
    return new Contract(CONTRACT_ADDRESS, ABI, signer);
  }
  const provider = getProvider();
  return new Contract(CONTRACT_ADDRESS, ABI, provider);
}

export async function getUSDC(withSigner = false) {
  if (withSigner) {
    const signer = await getSigner();
    return new Contract(USDC_ADDRESS, ERC20_ABI, signer);
  }
  const provider = getProvider();
  return new Contract(USDC_ADDRESS, ERC20_ABI, provider);
}

export async function getUSDCBalance(address: string): Promise<string> {
  const usdc = await getUSDC();
  const balance = await usdc.balanceOf(address);
  return formatUnits(balance, 6); // USDC has 6 decimals
}

export async function approveUSDC(amount: string): Promise<void> {
  const usdc = await getUSDC(true);
  const tx = await usdc.approve(CONTRACT_ADDRESS, parseUnits(amount, 6));
  await tx.wait();
}

export async function connectWallet(): Promise<string> {
  const provider = getProvider();
  const accounts = await provider.send("eth_requestAccounts", []);
  return getAddress(accounts[0]);
}

export async function switchToSepolia() {
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0xaa36a7" }],
    });
  } catch (err: unknown) {
    if ((err as { code: number }).code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: "0xaa36a7",
            chainName: "Sepolia",
            rpcUrls: ["https://rpc.sepolia.org"],
            nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
            blockExplorerUrls: ["https://sepolia.etherscan.io"],
          },
        ],
      });
    }
  }
}

export async function getETHBalance(address: string): Promise<string> {
  const provider = getProvider();
  const balance = await provider.getBalance(address);
  return formatUnits(balance, 18);
}

export type OrderData = {
  id: number;
  maker: string;
  tokenPair: string;
  isBuy: boolean;
  status: number;
  createdAt: number;
  ethDeposit: string;
  tokenDeposit: string;
  ethRemaining: string;
  tokenRemaining: string;
};

export async function fetchAllOrders(): Promise<OrderData[]> {
  const contract = await getContract();
  const count = await contract.orderCount();
  const orders: OrderData[] = [];
  for (let i = 0; i < Number(count); i++) {
    const o = await contract.getOrder(i);
    orders.push({
      id: i,
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
  return orders;
}

export { parseUnits, formatUnits };
