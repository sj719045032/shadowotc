import { initFhevm, createInstance, type FhevmInstance } from "fhevmjs";
import { CONTRACT_ADDRESS, getProvider } from "./contract";

// Sepolia fhEVM contract addresses (from ZamaConfig.sol)
const ACL_ADDRESS = "0xf0Ffdc93b7E186bC2f8CB3dAA75D86d1930A433D";
const KMS_ADDRESS = "0xbE0E383937d564D7FF0BC3b46c51f0bF8d5C311A";
const GATEWAY_URL = "https://gateway.sepolia.zama.ai";

let instance: FhevmInstance | null = null;

export async function getFhevmInstance(): Promise<FhevmInstance> {
  if (instance) return instance;

  await initFhevm();

  instance = await createInstance({
    kmsContractAddress: KMS_ADDRESS,
    aclContractAddress: ACL_ADDRESS,
    network: window.ethereum,
    gatewayUrl: GATEWAY_URL,
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

export async function decryptValue(
  handle: bigint,
  contractAddress: string,
  userAddress: string,
): Promise<bigint> {
  const fhevmInstance = await getFhevmInstance();
  const { publicKey, privateKey } = fhevmInstance.generateKeypair();

  const provider = getProvider();
  const signer = await provider.getSigner();

  const eip712 = fhevmInstance.createEIP712(publicKey, contractAddress);
  const signature = await signer.signTypedData(
    eip712.domain,
    { Reencrypt: eip712.types.Reencrypt },
    eip712.message,
  );

  return fhevmInstance.reencrypt(
    handle,
    privateKey,
    publicKey,
    signature,
    contractAddress,
    userAddress,
  );
}
