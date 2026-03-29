import { createInstance, SepoliaConfig, type FhevmInstance } from "@zama-fhe/relayer-sdk/web";
import { CONTRACT_ADDRESS, getProvider } from "./contract";

let instance: FhevmInstance | null = null;

export async function getFhevmInstance(): Promise<FhevmInstance> {
  if (instance) return instance;

  instance = await createInstance({
    ...SepoliaConfig,
    network: window.ethereum,
  });

  return instance;
}

export async function encryptInputs(
  userAddress: string,
  price: number,
  amount: number,
) {
  const fhevmInstance = await getFhevmInstance();
  const input = fhevmInstance.createEncryptedInput(
    CONTRACT_ADDRESS,
    userAddress,
  );
  input.add64(price);
  input.add64(amount);
  const encrypted = await input.encrypt();
  return encrypted;
}

export async function decryptValues(
  handles: { handle: string; contractAddress: string }[],
  userAddress: string,
): Promise<Map<string, bigint>> {
  const fhevmInstance = await getFhevmInstance();
  const provider = getProvider();
  const signer = await provider.getSigner();

  const { publicKey, privateKey } = fhevmInstance.generateKeypair();

  const now = Math.floor(Date.now() / 1000);
  const contractAddresses = [...new Set(handles.map((h) => h.contractAddress))];

  const eip712 = fhevmInstance.createEIP712(
    publicKey,
    contractAddresses,
    now,
    1, // 1 day duration
  );

  const { EIP712Domain: _, ...sigTypes } = eip712.types;
  // Cast to mutable for ethers.js compatibility
  const mutableTypes: Record<string, { name: string; type: string }[]> = {};
  for (const [key, val] of Object.entries(sigTypes)) {
    mutableTypes[key] = [...val];
  }
  const signature = await signer.signTypedData(
    eip712.domain as Record<string, unknown>,
    mutableTypes,
    eip712.message as Record<string, unknown>,
  );

  const results = await fhevmInstance.userDecrypt(
    handles,
    privateKey,
    publicKey,
    signature,
    contractAddresses,
    userAddress,
    now,
    1,
  );

  // Convert results to a map of handle -> decrypted value
  const decrypted = new Map<string, bigint>();
  for (const [handle, result] of Object.entries(results)) {
    decrypted.set(handle, BigInt(result as number | bigint));
  }
  return decrypted;
}
