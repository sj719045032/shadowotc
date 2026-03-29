import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

// Sepolia USDC address
const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployed = await deploy("ConfidentialOTC", {
    from: deployer,
    args: [SEPOLIA_USDC],
    log: true,
  });

  console.log(`ConfidentialOTC (Dark Pool) contract: `, deployed.address);
  console.log(`Payment token (USDC): `, SEPOLIA_USDC);
};
export default func;
func.id = "deploy_confidentialOTC";
func.tags = ["ConfidentialOTC"];
