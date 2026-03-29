import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { ConfidentialOTC, ConfidentialOTC__factory, MockERC20, MockERC20__factory } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  carol: HardhatEthersSigner;
  auditor: HardhatEthersSigner;
};

async function deployFixture() {
  // Deploy mock ERC20 token (USDC with 6 decimals)
  const tokenFactory = (await ethers.getContractFactory("MockERC20")) as MockERC20__factory;
  const token = (await tokenFactory.deploy("Mock USDC", "USDC", 6)) as MockERC20;
  const tokenAddress = await token.getAddress();

  // Deploy ConfidentialOTC with the mock token
  const factory = (await ethers.getContractFactory("ConfidentialOTC")) as ConfidentialOTC__factory;
  const contract = (await factory.deploy(tokenAddress)) as ConfidentialOTC;
  const contractAddress = await contract.getAddress();
  return { contract, contractAddress, token, tokenAddress };
}

describe("ConfidentialOTC - Confidential Dark Pool (ETH/USDC Swaps)", function () {
  let signers: Signers;
  let contract: ConfidentialOTC;
  let contractAddress: string;
  let token: MockERC20;
  let tokenAddress: string;

  before(async function () {
    const ethSigners = await ethers.getSigners();
    signers = {
      deployer: ethSigners[0],
      alice: ethSigners[1],
      bob: ethSigners[2],
      carol: ethSigners[3],
      auditor: ethSigners[4],
    };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("This test suite requires mock FHEVM");
      this.skip();
    }
    ({ contract, contractAddress, token, tokenAddress } = await deployFixture());
  });

  // Helper: mint USDC tokens and approve the OTC contract
  async function mintAndApprove(signer: HardhatEthersSigner, amount: bigint) {
    await (await token.mint(signer.address, amount)).wait();
    await (await token.connect(signer).approve(contractAddress, amount)).wait();
  }

  // =========================================================================
  //                        OWNERSHIP & ADMIN
  // =========================================================================

  describe("Ownership", function () {
    it("deployer should be the owner", async function () {
      expect(await contract.owner()).to.eq(signers.deployer.address);
    });

    it("owner can transfer ownership", async function () {
      await expect(contract.connect(signers.deployer).transferOwnership(signers.alice.address))
        .to.emit(contract, "OwnershipTransferred")
        .withArgs(signers.deployer.address, signers.alice.address);
      expect(await contract.owner()).to.eq(signers.alice.address);
    });

    it("non-owner cannot transfer ownership", async function () {
      await expect(
        contract.connect(signers.alice).transferOwnership(signers.bob.address),
      ).to.be.revertedWithCustomError(contract, "NotOwner");
    });

    it("cannot transfer ownership to zero address", async function () {
      await expect(
        contract.connect(signers.deployer).transferOwnership(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(contract, "ZeroAddress");
    });
  });

  // =========================================================================
  //                        AUDITOR MANAGEMENT
  // =========================================================================

  describe("Auditor", function () {
    it("owner can set auditor", async function () {
      await expect(contract.connect(signers.deployer).setAuditor(signers.auditor.address))
        .to.emit(contract, "AuditorUpdated")
        .withArgs(ethers.ZeroAddress, signers.auditor.address);
      expect(await contract.auditor()).to.eq(signers.auditor.address);
    });

    it("non-owner cannot set auditor", async function () {
      await expect(
        contract.connect(signers.alice).setAuditor(signers.auditor.address),
      ).to.be.revertedWithCustomError(contract, "NotOwner");
    });

    it("cannot set auditor to zero address", async function () {
      await expect(
        contract.connect(signers.deployer).setAuditor(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(contract, "ZeroAddress");
    });
  });

  // =========================================================================
  //                        SELL ORDER CREATION (ETH deposit)
  // =========================================================================

  describe("createOrder - SELL (ETH deposit)", function () {
    it("should create a SELL order with ETH deposit", async function () {
      const ethDeposit = ethers.parseEther("1.0");

      const encInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(1500) // price
        .add64(100) // amount
        .encrypt();

      const tx = await contract
        .connect(signers.alice)
        .createOrder(
          encInput.handles[0],
          encInput.inputProof,
          encInput.handles[1],
          encInput.inputProof,
          false, // SELL
          "ETH/USDC",
          0, // no USDC deposit for SELL
          { value: ethDeposit },
        );

      await expect(tx)
        .to.emit(contract, "OrderCreated")
        .withArgs(0, signers.alice.address, "ETH/USDC", false, ethDeposit, 0);

      expect(await contract.orderCount()).to.eq(1);

      const order = await contract.getOrder(0);
      expect(order.maker).to.eq(signers.alice.address);
      expect(order.tokenPair).to.eq("ETH/USDC");
      expect(order.isBuy).to.eq(false);
      expect(order.status).to.eq(0); // Open
      expect(order.ethDeposit).to.eq(ethDeposit);
      expect(order.tokenDeposit).to.eq(0);
      expect(order.ethRemaining).to.eq(ethDeposit);
      expect(order.tokenRemaining).to.eq(0);
    });

    it("should revert SELL order with zero ETH", async function () {
      const encInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await expect(
        contract
          .connect(signers.alice)
          .createOrder(
            encInput.handles[0],
            encInput.inputProof,
            encInput.handles[1],
            encInput.inputProof,
            false,
            "ETH/USDC",
            0,
            { value: 0 },
          ),
      ).to.be.revertedWithCustomError(contract, "ZeroDeposit");
    });

    it("should revert SELL order if USDC deposit is non-zero", async function () {
      const encInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await expect(
        contract
          .connect(signers.alice)
          .createOrder(
            encInput.handles[0],
            encInput.inputProof,
            encInput.handles[1],
            encInput.inputProof,
            false,
            "ETH/USDC",
            1000000n,
            { value: ethers.parseEther("1.0") },
          ),
      ).to.be.revertedWithCustomError(contract, "InvalidDepositType");
    });
  });

  // =========================================================================
  //                        BUY ORDER CREATION (USDC deposit)
  // =========================================================================

  describe("createOrder - BUY (USDC deposit)", function () {
    it("should create a BUY order with USDC deposit", async function () {
      const depositAmount = 1000000n; // 1 USDC (6 decimals)
      await mintAndApprove(signers.alice, depositAmount);

      const encInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(1500) // price
        .add64(100) // amount
        .encrypt();

      const tx = await contract
        .connect(signers.alice)
        .createOrder(
          encInput.handles[0],
          encInput.inputProof,
          encInput.handles[1],
          encInput.inputProof,
          true, // BUY
          "ETH/USDC",
          depositAmount,
        );

      await expect(tx)
        .to.emit(contract, "OrderCreated")
        .withArgs(0, signers.alice.address, "ETH/USDC", true, 0, depositAmount);

      expect(await contract.orderCount()).to.eq(1);

      const order = await contract.getOrder(0);
      expect(order.maker).to.eq(signers.alice.address);
      expect(order.isBuy).to.eq(true);
      expect(order.status).to.eq(0); // Open
      expect(order.ethDeposit).to.eq(0);
      expect(order.tokenDeposit).to.eq(depositAmount);
      expect(order.ethRemaining).to.eq(0);
      expect(order.tokenRemaining).to.eq(depositAmount);
    });

    it("should revert BUY order with zero USDC deposit", async function () {
      const encInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await expect(
        contract
          .connect(signers.alice)
          .createOrder(
            encInput.handles[0],
            encInput.inputProof,
            encInput.handles[1],
            encInput.inputProof,
            true,
            "ETH/USDC",
            0,
          ),
      ).to.be.revertedWithCustomError(contract, "ZeroDeposit");
    });

    it("should revert BUY order if ETH is sent", async function () {
      const encInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      const depositAmount = 1000000n;
      await mintAndApprove(signers.alice, depositAmount);

      await expect(
        contract
          .connect(signers.alice)
          .createOrder(
            encInput.handles[0],
            encInput.inputProof,
            encInput.handles[1],
            encInput.inputProof,
            true,
            "ETH/USDC",
            depositAmount,
            { value: ethers.parseEther("0.1") },
          ),
      ).to.be.revertedWithCustomError(contract, "InvalidDepositType");
    });

    it("should revert if maker has not approved tokens", async function () {
      const encInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      // Mint but do NOT approve
      await (await token.mint(signers.alice.address, 1000000n)).wait();

      await expect(
        contract
          .connect(signers.alice)
          .createOrder(
            encInput.handles[0],
            encInput.inputProof,
            encInput.handles[1],
            encInput.inputProof,
            true,
            "ETH/USDC",
            1000000n,
          ),
      ).to.be.revertedWith("ERC20: insufficient allowance");
    });

    it("maker can decrypt their own order price and amount", async function () {
      const depositAmount = 2000000n; // 2 USDC
      await mintAndApprove(signers.alice, depositAmount);

      const encInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(2500)
        .add64(50)
        .encrypt();

      await (
        await contract
          .connect(signers.alice)
          .createOrder(
            encInput.handles[0],
            encInput.inputProof,
            encInput.handles[1],
            encInput.inputProof,
            true,
            "BTC/USDC",
            depositAmount,
          )
      ).wait();

      // Decrypt price
      const encPrice = await contract.getPrice(0);
      const decPrice = await fhevm.userDecryptEuint(FhevmType.euint64, encPrice, contractAddress, signers.alice);
      expect(decPrice).to.eq(2500);

      // Decrypt amount
      const encAmount = await contract.getAmount(0);
      const decAmount = await fhevm.userDecryptEuint(FhevmType.euint64, encAmount, contractAddress, signers.alice);
      expect(decAmount).to.eq(50);

      // Decrypt remaining amount (should equal initial amount)
      const encRemaining = await contract.getRemainingAmount(0);
      const decRemaining = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        encRemaining,
        contractAddress,
        signers.alice,
      );
      expect(decRemaining).to.eq(50);
    });

    it("should create multiple orders and track count", async function () {
      for (let i = 0; i < 3; i++) {
        const encInput = await fhevm
          .createEncryptedInput(contractAddress, signers.alice.address)
          .add64(1000 + i * 100)
          .add64(10 + i)
          .encrypt();

        const depositAmount = 500000n; // 0.5 USDC
        await mintAndApprove(signers.alice, depositAmount);

        await (
          await contract
            .connect(signers.alice)
            .createOrder(
              encInput.handles[0],
              encInput.inputProof,
              encInput.handles[1],
              encInput.inputProof,
              true,
              "ETH/USDC",
              depositAmount,
            )
        ).wait();
      }

      expect(await contract.orderCount()).to.eq(3);
    });
  });

  // =========================================================================
  //                   SELL ORDER FILL (Taker pays USDC, gets ETH)
  // =========================================================================

  describe("fillOrder - SELL Order (ETH->USDC swap)", function () {
    const ethDeposit = ethers.parseEther("1.0");
    const makerPrice = 1500;
    const makerAmount = 100;

    beforeEach(async function () {
      const encInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(makerPrice)
        .add64(makerAmount)
        .encrypt();

      await (
        await contract
          .connect(signers.alice)
          .createOrder(
            encInput.handles[0],
            encInput.inputProof,
            encInput.handles[1],
            encInput.inputProof,
            false, // SELL
            "ETH/USDC",
            0,
            { value: ethDeposit },
          )
      ).wait();
    });

    it("should fill SELL order: taker pays USDC, receives ETH", async function () {
      const takerUsdcAmount = 150000n; // USDC to pay maker
      const takerEthAmount = ethDeposit; // ETH taker wants

      // Mint USDC for bob (taker) and approve contract to transferFrom
      await mintAndApprove(signers.bob, takerUsdcAmount);

      const takerEncInput = await fhevm
        .createEncryptedInput(contractAddress, signers.bob.address)
        .add64(1500) // exact price match
        .add64(100) // full amount
        .encrypt();

      const bobEthBefore = await ethers.provider.getBalance(signers.bob.address);
      const aliceUsdcBefore = await token.balanceOf(signers.alice.address);

      const tx = await contract
        .connect(signers.bob)
        .fillOrder(
          0,
          takerEncInput.handles[0],
          takerEncInput.inputProof,
          takerEncInput.handles[1],
          takerEncInput.inputProof,
          takerEthAmount,
          takerUsdcAmount,
        );

      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      await expect(tx)
        .to.emit(contract, "OrderFilled")
        .withArgs(0, 0, takerEthAmount, takerUsdcAmount);

      // Order should be marked as Filled
      const order = await contract.getOrder(0);
      expect(order.status).to.eq(1); // Filled
      expect(order.ethRemaining).to.eq(0);

      // Bob (taker) should have received ETH
      const bobEthAfter = await ethers.provider.getBalance(signers.bob.address);
      expect(bobEthAfter).to.eq(bobEthBefore + takerEthAmount - gasUsed);

      // Alice (maker) should have received USDC
      const aliceUsdcAfter = await token.balanceOf(signers.alice.address);
      expect(aliceUsdcAfter).to.eq(aliceUsdcBefore + takerUsdcAmount);
    });

    it("should fill when taker price > maker price", async function () {
      const takerUsdcAmount = 200000n;
      const takerEthAmount = ethDeposit;
      await mintAndApprove(signers.bob, takerUsdcAmount);

      const takerEncInput = await fhevm
        .createEncryptedInput(contractAddress, signers.bob.address)
        .add64(2000) // higher than maker's 1500
        .add64(100)
        .encrypt();

      const tx = await contract
        .connect(signers.bob)
        .fillOrder(
          0,
          takerEncInput.handles[0],
          takerEncInput.inputProof,
          takerEncInput.handles[1],
          takerEncInput.inputProof,
          takerEthAmount,
          takerUsdcAmount,
        );

      await expect(tx).to.emit(contract, "OrderFilled");

      const order = await contract.getOrder(0);
      expect(order.status).to.eq(1); // Filled
    });

    it("should revert if taker sends ETH to fill SELL order", async function () {
      const takerUsdcAmount = 150000n;
      const takerEthAmount = ethDeposit;
      await mintAndApprove(signers.bob, takerUsdcAmount);

      const takerEncInput = await fhevm
        .createEncryptedInput(contractAddress, signers.bob.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await expect(
        contract
          .connect(signers.bob)
          .fillOrder(
            0,
            takerEncInput.handles[0],
            takerEncInput.inputProof,
            takerEncInput.handles[1],
            takerEncInput.inputProof,
            takerEthAmount,
            takerUsdcAmount,
            { value: ethers.parseEther("0.1") },
          ),
      ).to.be.revertedWithCustomError(contract, "InvalidDepositType");
    });

    it("should revert if takerEthAmount exceeds remaining", async function () {
      const takerUsdcAmount = 150000n;
      const takerEthAmount = ethDeposit + 1n; // more than deposited
      await mintAndApprove(signers.bob, takerUsdcAmount);

      const takerEncInput = await fhevm
        .createEncryptedInput(contractAddress, signers.bob.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await expect(
        contract
          .connect(signers.bob)
          .fillOrder(
            0,
            takerEncInput.handles[0],
            takerEncInput.inputProof,
            takerEncInput.handles[1],
            takerEncInput.inputProof,
            takerEthAmount,
            takerUsdcAmount,
          ),
      ).to.be.revertedWithCustomError(contract, "InsufficientRemaining");
    });

    it("maker cannot fill own order", async function () {
      const takerEncInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await expect(
        contract
          .connect(signers.alice)
          .fillOrder(
            0,
            takerEncInput.handles[0],
            takerEncInput.inputProof,
            takerEncInput.handles[1],
            takerEncInput.inputProof,
            ethDeposit,
            150000n,
          ),
      ).to.be.revertedWithCustomError(contract, "MakerCannotFill");
    });
  });

  // =========================================================================
  //                   BUY ORDER FILL (Taker pays ETH, gets USDC)
  // =========================================================================

  describe("fillOrder - BUY Order (USDC->ETH swap)", function () {
    const usdcDeposit = 1000000n; // 1 USDC
    const makerPrice = 1500;
    const makerAmount = 100;

    beforeEach(async function () {
      await mintAndApprove(signers.alice, usdcDeposit);

      const encInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(makerPrice)
        .add64(makerAmount)
        .encrypt();

      await (
        await contract
          .connect(signers.alice)
          .createOrder(
            encInput.handles[0],
            encInput.inputProof,
            encInput.handles[1],
            encInput.inputProof,
            true, // BUY
            "ETH/USDC",
            usdcDeposit,
          )
      ).wait();
    });

    it("should fill BUY order: taker pays ETH, receives USDC", async function () {
      const takerEthAmount = ethers.parseEther("0.5");
      const takerUsdcAmount = usdcDeposit; // USDC taker wants from the order

      const takerEncInput = await fhevm
        .createEncryptedInput(contractAddress, signers.bob.address)
        .add64(1500) // exact price match
        .add64(100) // full amount
        .encrypt();

      const bobUsdcBefore = await token.balanceOf(signers.bob.address);
      const aliceEthBefore = await ethers.provider.getBalance(signers.alice.address);

      const tx = await contract
        .connect(signers.bob)
        .fillOrder(
          0,
          takerEncInput.handles[0],
          takerEncInput.inputProof,
          takerEncInput.handles[1],
          takerEncInput.inputProof,
          takerEthAmount,
          takerUsdcAmount,
          { value: takerEthAmount },
        );

      await expect(tx)
        .to.emit(contract, "OrderFilled")
        .withArgs(0, 0, takerEthAmount, takerUsdcAmount);

      // Order should be marked as Filled
      const order = await contract.getOrder(0);
      expect(order.status).to.eq(1); // Filled
      expect(order.tokenRemaining).to.eq(0);

      // Bob (taker) should have received USDC
      const bobUsdcAfter = await token.balanceOf(signers.bob.address);
      expect(bobUsdcAfter).to.eq(bobUsdcBefore + takerUsdcAmount);

      // Alice (maker) should have received ETH
      const aliceEthAfter = await ethers.provider.getBalance(signers.alice.address);
      expect(aliceEthAfter).to.eq(aliceEthBefore + takerEthAmount);
    });

    it("should revert if msg.value != takerEthAmount for BUY fill", async function () {
      const takerEncInput = await fhevm
        .createEncryptedInput(contractAddress, signers.bob.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await expect(
        contract
          .connect(signers.bob)
          .fillOrder(
            0,
            takerEncInput.handles[0],
            takerEncInput.inputProof,
            takerEncInput.handles[1],
            takerEncInput.inputProof,
            ethers.parseEther("0.5"),
            usdcDeposit,
            { value: ethers.parseEther("0.3") }, // mismatch
          ),
      ).to.be.revertedWithCustomError(contract, "InvalidDepositType");
    });

    it("should revert if takerUsdcAmount exceeds remaining for BUY fill", async function () {
      const takerEncInput = await fhevm
        .createEncryptedInput(contractAddress, signers.bob.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await expect(
        contract
          .connect(signers.bob)
          .fillOrder(
            0,
            takerEncInput.handles[0],
            takerEncInput.inputProof,
            takerEncInput.handles[1],
            takerEncInput.inputProof,
            ethers.parseEther("0.5"),
            usdcDeposit + 1n, // exceeds remaining
            { value: ethers.parseEther("0.5") },
          ),
      ).to.be.revertedWithCustomError(contract, "InsufficientRemaining");
    });

    it("cannot fill a non-open order", async function () {
      // First fill the order
      const takerEncInput1 = await fhevm
        .createEncryptedInput(contractAddress, signers.bob.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await (
        await contract
          .connect(signers.bob)
          .fillOrder(
            0,
            takerEncInput1.handles[0],
            takerEncInput1.inputProof,
            takerEncInput1.handles[1],
            takerEncInput1.inputProof,
            ethers.parseEther("0.5"),
            usdcDeposit,
            { value: ethers.parseEther("0.5") },
          )
      ).wait();

      // Try to fill again
      const takerEncInput2 = await fhevm
        .createEncryptedInput(contractAddress, signers.carol.address)
        .add64(1500)
        .add64(50)
        .encrypt();

      await expect(
        contract
          .connect(signers.carol)
          .fillOrder(
            0,
            takerEncInput2.handles[0],
            takerEncInput2.inputProof,
            takerEncInput2.handles[1],
            takerEncInput2.inputProof,
            ethers.parseEther("0.1"),
            500000n,
            { value: ethers.parseEther("0.1") },
          ),
      ).to.be.revertedWithCustomError(contract, "OrderNotOpen");
    });

    it("should revert with InvalidOrderId for non-existent order", async function () {
      const takerEncInput = await fhevm
        .createEncryptedInput(contractAddress, signers.bob.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await expect(
        contract
          .connect(signers.bob)
          .fillOrder(
            999,
            takerEncInput.handles[0],
            takerEncInput.inputProof,
            takerEncInput.handles[1],
            takerEncInput.inputProof,
            ethers.parseEther("0.5"),
            usdcDeposit,
            { value: ethers.parseEther("0.5") },
          ),
      ).to.be.revertedWithCustomError(contract, "InvalidOrderId");
    });
  });

  // =========================================================================
  //                       ENCRYPTED PARTIAL FILLS
  // =========================================================================

  describe("fillOrder - Encrypted Partial Fills (SELL order)", function () {
    it("should compute partial fill using FHE.min when taker wants less", async function () {
      const ethDeposit = ethers.parseEther("1.0");

      // Maker creates SELL order for 100 units with 1 ETH
      const makerInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await (
        await contract
          .connect(signers.alice)
          .createOrder(
            makerInput.handles[0],
            makerInput.inputProof,
            makerInput.handles[1],
            makerInput.inputProof,
            false, // SELL
            "ETH/USDC",
            0,
            { value: ethDeposit },
          )
      ).wait();

      // Taker wants only 30 units at matching price (partial ETH)
      const partialEth = ethers.parseEther("0.3");
      const partialUsdc = 45000n;
      await mintAndApprove(signers.bob, partialUsdc);

      const takerInput = await fhevm
        .createEncryptedInput(contractAddress, signers.bob.address)
        .add64(1500)
        .add64(30) // partial fill
        .encrypt();

      await (
        await contract
          .connect(signers.bob)
          .fillOrder(
            0,
            takerInput.handles[0],
            takerInput.inputProof,
            takerInput.handles[1],
            takerInput.inputProof,
            partialEth,
            partialUsdc,
          )
      ).wait();

      // Verify the fill amount is 30 (min of 30, 100)
      const encFillAmount = await contract.getFillAmount(0);
      const decFillAmount = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        encFillAmount,
        contractAddress,
        signers.bob,
      );
      expect(decFillAmount).to.eq(30);

      // Order should still be Open (partial fill)
      const order = await contract.getOrder(0);
      expect(order.status).to.eq(0); // Open
      expect(order.ethRemaining).to.eq(ethDeposit - partialEth);
    });

    it("fill amount should be capped at remaining when taker wants more", async function () {
      const ethDeposit = ethers.parseEther("0.5");

      // Maker creates SELL order for 50 units with 0.5 ETH
      const makerInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(1000)
        .add64(50)
        .encrypt();

      await (
        await contract
          .connect(signers.alice)
          .createOrder(
            makerInput.handles[0],
            makerInput.inputProof,
            makerInput.handles[1],
            makerInput.inputProof,
            false,
            "ETH/USDC",
            0,
            { value: ethDeposit },
          )
      ).wait();

      // Taker wants 200 units (more than available), but specifies full ETH deposit
      const takerUsdc = 100000n;
      await mintAndApprove(signers.bob, takerUsdc);

      const takerInput = await fhevm
        .createEncryptedInput(contractAddress, signers.bob.address)
        .add64(1000)
        .add64(200) // wants more than available (encrypted)
        .encrypt();

      await (
        await contract
          .connect(signers.bob)
          .fillOrder(
            0,
            takerInput.handles[0],
            takerInput.inputProof,
            takerInput.handles[1],
            takerInput.inputProof,
            ethDeposit, // take all remaining ETH
            takerUsdc,
          )
      ).wait();

      // Fill amount should be capped at 50 (min of 200, 50)
      const encFillAmount = await contract.getFillAmount(0);
      const decFillAmount = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        encFillAmount,
        contractAddress,
        signers.bob,
      );
      expect(decFillAmount).to.eq(50);
    });
  });

  // =========================================================================
  //                    ENCRYPTED SETTLEMENT TOTAL
  // =========================================================================

  describe("fillOrder - Encrypted Settlement Total", function () {
    it("should compute encrypted total as price * fillAmount", async function () {
      const price = 1500;
      const amount = 100;
      const usdcDeposit = 1000000n;
      await mintAndApprove(signers.alice, usdcDeposit);

      const makerInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(price)
        .add64(amount)
        .encrypt();

      await (
        await contract
          .connect(signers.alice)
          .createOrder(
            makerInput.handles[0],
            makerInput.inputProof,
            makerInput.handles[1],
            makerInput.inputProof,
            true, // BUY
            "ETH/USDC",
            usdcDeposit,
          )
      ).wait();

      const takerEthAmount = ethers.parseEther("0.5");
      const takerInput = await fhevm
        .createEncryptedInput(contractAddress, signers.bob.address)
        .add64(price) // exact match
        .add64(amount) // full fill
        .encrypt();

      await (
        await contract
          .connect(signers.bob)
          .fillOrder(
            0,
            takerInput.handles[0],
            takerInput.inputProof,
            takerInput.handles[1],
            takerInput.inputProof,
            takerEthAmount,
            usdcDeposit,
            { value: takerEthAmount },
          )
      ).wait();

      // Decrypt the settlement total
      const encTotal = await contract.getFillTotal(0);
      const decTotal = await fhevm.userDecryptEuint(FhevmType.euint64, encTotal, contractAddress, signers.bob);
      expect(decTotal).to.eq(BigInt(price) * BigInt(amount)); // 1500 * 100 = 150000
    });
  });

  // =========================================================================
  //                         TOKEN ESCROW
  // =========================================================================

  describe("Token Escrow - Dual Asset", function () {
    it("ETH should be held in contract after SELL order creation", async function () {
      const ethDeposit = ethers.parseEther("2.5");

      const encInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      const contractEthBefore = await ethers.provider.getBalance(contractAddress);

      await (
        await contract
          .connect(signers.alice)
          .createOrder(
            encInput.handles[0],
            encInput.inputProof,
            encInput.handles[1],
            encInput.inputProof,
            false,
            "ETH/USDC",
            0,
            { value: ethDeposit },
          )
      ).wait();

      const contractEthAfter = await ethers.provider.getBalance(contractAddress);
      expect(contractEthAfter).to.eq(contractEthBefore + ethDeposit);
    });

    it("USDC should be held in contract after BUY order creation", async function () {
      const depositAmount = 2500000n;
      await mintAndApprove(signers.alice, depositAmount);

      const encInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await (
        await contract
          .connect(signers.alice)
          .createOrder(
            encInput.handles[0],
            encInput.inputProof,
            encInput.handles[1],
            encInput.inputProof,
            true,
            "ETH/USDC",
            depositAmount,
          )
      ).wait();

      const contractBalance = await token.balanceOf(contractAddress);
      expect(contractBalance).to.eq(depositAmount);
    });

    it("SELL fill: ETH to taker, USDC to maker", async function () {
      const ethDeposit = ethers.parseEther("1.0");

      const makerInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await (
        await contract
          .connect(signers.alice)
          .createOrder(
            makerInput.handles[0],
            makerInput.inputProof,
            makerInput.handles[1],
            makerInput.inputProof,
            false,
            "ETH/USDC",
            0,
            { value: ethDeposit },
          )
      ).wait();

      const takerUsdc = 150000n;
      await mintAndApprove(signers.bob, takerUsdc);

      const bobEthBefore = await ethers.provider.getBalance(signers.bob.address);
      const aliceUsdcBefore = await token.balanceOf(signers.alice.address);

      const takerInput = await fhevm
        .createEncryptedInput(contractAddress, signers.bob.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      const tx = await contract
        .connect(signers.bob)
        .fillOrder(
          0,
          takerInput.handles[0],
          takerInput.inputProof,
          takerInput.handles[1],
          takerInput.inputProof,
          ethDeposit,
          takerUsdc,
        );

      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      // Bob received ETH
      const bobEthAfter = await ethers.provider.getBalance(signers.bob.address);
      expect(bobEthAfter).to.eq(bobEthBefore + ethDeposit - gasUsed);

      // Alice received USDC
      const aliceUsdcAfter = await token.balanceOf(signers.alice.address);
      expect(aliceUsdcAfter).to.eq(aliceUsdcBefore + takerUsdc);

      // Contract ETH should be 0
      const contractEth = await ethers.provider.getBalance(contractAddress);
      expect(contractEth).to.eq(0);
    });

    it("BUY fill: USDC to taker, ETH to maker", async function () {
      const usdcDeposit = 1000000n;
      await mintAndApprove(signers.alice, usdcDeposit);

      const makerInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await (
        await contract
          .connect(signers.alice)
          .createOrder(
            makerInput.handles[0],
            makerInput.inputProof,
            makerInput.handles[1],
            makerInput.inputProof,
            true,
            "ETH/USDC",
            usdcDeposit,
          )
      ).wait();

      const takerEth = ethers.parseEther("0.5");
      const bobUsdcBefore = await token.balanceOf(signers.bob.address);
      const aliceEthBefore = await ethers.provider.getBalance(signers.alice.address);

      const takerInput = await fhevm
        .createEncryptedInput(contractAddress, signers.bob.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await (
        await contract
          .connect(signers.bob)
          .fillOrder(
            0,
            takerInput.handles[0],
            takerInput.inputProof,
            takerInput.handles[1],
            takerInput.inputProof,
            takerEth,
            usdcDeposit,
            { value: takerEth },
          )
      ).wait();

      // Bob received USDC
      const bobUsdcAfter = await token.balanceOf(signers.bob.address);
      expect(bobUsdcAfter).to.eq(bobUsdcBefore + usdcDeposit);

      // Alice received ETH
      const aliceEthAfter = await ethers.provider.getBalance(signers.alice.address);
      expect(aliceEthAfter).to.eq(aliceEthBefore + takerEth);

      // Contract USDC should be 0
      const contractUsdc = await token.balanceOf(contractAddress);
      expect(contractUsdc).to.eq(0);
    });

    it("paymentToken address should be set correctly", async function () {
      expect(await contract.paymentToken()).to.eq(tokenAddress);
    });
  });

  // =========================================================================
  //                      CANCEL ORDER
  // =========================================================================

  describe("cancelOrder", function () {
    it("maker can cancel SELL order and get ETH refund", async function () {
      const ethDeposit = ethers.parseEther("1.0");

      const encInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await (
        await contract
          .connect(signers.alice)
          .createOrder(
            encInput.handles[0],
            encInput.inputProof,
            encInput.handles[1],
            encInput.inputProof,
            false,
            "ETH/USDC",
            0,
            { value: ethDeposit },
          )
      ).wait();

      const aliceEthBefore = await ethers.provider.getBalance(signers.alice.address);

      const tx = await contract.connect(signers.alice).cancelOrder(0);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      await expect(tx).to.emit(contract, "OrderCancelled").withArgs(0, ethDeposit, 0);

      const order = await contract.getOrder(0);
      expect(order.status).to.eq(2); // Cancelled
      expect(order.ethRemaining).to.eq(0);

      // Alice should get ETH back
      const aliceEthAfter = await ethers.provider.getBalance(signers.alice.address);
      expect(aliceEthAfter).to.eq(aliceEthBefore + ethDeposit - gasUsed);
    });

    it("maker can cancel BUY order and get USDC refund", async function () {
      const depositAmount = 1000000n;
      await mintAndApprove(signers.alice, depositAmount);

      const encInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await (
        await contract
          .connect(signers.alice)
          .createOrder(
            encInput.handles[0],
            encInput.inputProof,
            encInput.handles[1],
            encInput.inputProof,
            true,
            "ETH/USDC",
            depositAmount,
          )
      ).wait();

      const aliceTokenBefore = await token.balanceOf(signers.alice.address);

      await expect(contract.connect(signers.alice).cancelOrder(0))
        .to.emit(contract, "OrderCancelled")
        .withArgs(0, 0, depositAmount);

      const order = await contract.getOrder(0);
      expect(order.status).to.eq(2); // Cancelled
      expect(order.tokenRemaining).to.eq(0);

      const aliceTokenAfter = await token.balanceOf(signers.alice.address);
      expect(aliceTokenAfter).to.eq(aliceTokenBefore + depositAmount);
    });

    it("non-maker cannot cancel order", async function () {
      const ethDeposit = ethers.parseEther("1.0");

      const encInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await (
        await contract
          .connect(signers.alice)
          .createOrder(
            encInput.handles[0],
            encInput.inputProof,
            encInput.handles[1],
            encInput.inputProof,
            false,
            "ETH/USDC",
            0,
            { value: ethDeposit },
          )
      ).wait();

      await expect(contract.connect(signers.bob).cancelOrder(0)).to.be.revertedWithCustomError(contract, "NotMaker");
    });

    it("cannot cancel already filled order", async function () {
      const usdcDeposit = 1000000n;
      await mintAndApprove(signers.alice, usdcDeposit);

      const makerInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await (
        await contract
          .connect(signers.alice)
          .createOrder(
            makerInput.handles[0],
            makerInput.inputProof,
            makerInput.handles[1],
            makerInput.inputProof,
            true,
            "ETH/USDC",
            usdcDeposit,
          )
      ).wait();

      const takerInput = await fhevm
        .createEncryptedInput(contractAddress, signers.bob.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await (
        await contract
          .connect(signers.bob)
          .fillOrder(
            0,
            takerInput.handles[0],
            takerInput.inputProof,
            takerInput.handles[1],
            takerInput.inputProof,
            ethers.parseEther("0.5"),
            usdcDeposit,
            { value: ethers.parseEther("0.5") },
          )
      ).wait();

      await expect(contract.connect(signers.alice).cancelOrder(0)).to.be.revertedWithCustomError(
        contract,
        "OrderNotOpen",
      );
    });

    it("cannot cancel non-existent order", async function () {
      await expect(contract.connect(signers.alice).cancelOrder(999)).to.be.revertedWithCustomError(
        contract,
        "InvalidOrderId",
      );
    });
  });

  // =========================================================================
  //                    FAIR TIEBREAKING (RANDOMNESS)
  // =========================================================================

  describe("Fair Tiebreaking", function () {
    it("fill should have a random priority score", async function () {
      const usdcDeposit = 1000000n;
      await mintAndApprove(signers.alice, usdcDeposit);

      const makerInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(1000)
        .add64(100)
        .encrypt();

      await (
        await contract
          .connect(signers.alice)
          .createOrder(
            makerInput.handles[0],
            makerInput.inputProof,
            makerInput.handles[1],
            makerInput.inputProof,
            true,
            "ETH/USDC",
            usdcDeposit,
          )
      ).wait();

      const takerInput = await fhevm
        .createEncryptedInput(contractAddress, signers.bob.address)
        .add64(1000)
        .add64(100)
        .encrypt();

      await (
        await contract
          .connect(signers.bob)
          .fillOrder(
            0,
            takerInput.handles[0],
            takerInput.inputProof,
            takerInput.handles[1],
            takerInput.inputProof,
            ethers.parseEther("0.5"),
            usdcDeposit,
            { value: ethers.parseEther("0.5") },
          )
      ).wait();

      // The priority score handle should exist (non-zero)
      const encPriority = await contract.getFillPriorityScore(0);
      expect(encPriority).to.not.eq(ethers.ZeroHash);

      // Maker should be able to decrypt it
      const decPriority = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        encPriority,
        contractAddress,
        signers.alice,
      );
      // Just verify it's a valid number (random, so we can't predict exact value)
      expect(decPriority).to.be.gte(0);
    });
  });

  // =========================================================================
  //                   ENCRYPTED COUNTERPARTY (eaddress)
  // =========================================================================

  describe("Encrypted Counterparty", function () {
    it("taker address should be encrypted and decryptable by maker", async function () {
      const usdcDeposit = 1000000n;
      await mintAndApprove(signers.alice, usdcDeposit);

      const makerInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await (
        await contract
          .connect(signers.alice)
          .createOrder(
            makerInput.handles[0],
            makerInput.inputProof,
            makerInput.handles[1],
            makerInput.inputProof,
            true,
            "ETH/USDC",
            usdcDeposit,
          )
      ).wait();

      const takerInput = await fhevm
        .createEncryptedInput(contractAddress, signers.bob.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await (
        await contract
          .connect(signers.bob)
          .fillOrder(
            0,
            takerInput.handles[0],
            takerInput.inputProof,
            takerInput.handles[1],
            takerInput.inputProof,
            ethers.parseEther("0.5"),
            usdcDeposit,
            { value: ethers.parseEther("0.5") },
          )
      ).wait();

      // Maker should be able to decrypt the taker's encrypted address
      const encTaker = await contract.getEncryptedTaker(0);
      const decTaker = await fhevm.userDecryptEaddress(encTaker, contractAddress, signers.alice);
      expect(decTaker.toLowerCase()).to.eq(signers.bob.address.toLowerCase());
    });

    it("taker can decrypt their own encrypted address from the fill", async function () {
      const usdcDeposit = 1000000n;
      await mintAndApprove(signers.alice, usdcDeposit);

      const makerInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await (
        await contract
          .connect(signers.alice)
          .createOrder(
            makerInput.handles[0],
            makerInput.inputProof,
            makerInput.handles[1],
            makerInput.inputProof,
            true,
            "ETH/USDC",
            usdcDeposit,
          )
      ).wait();

      const takerInput = await fhevm
        .createEncryptedInput(contractAddress, signers.bob.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await (
        await contract
          .connect(signers.bob)
          .fillOrder(
            0,
            takerInput.handles[0],
            takerInput.inputProof,
            takerInput.handles[1],
            takerInput.inputProof,
            ethers.parseEther("0.5"),
            usdcDeposit,
            { value: ethers.parseEther("0.5") },
          )
      ).wait();

      // Bob can decrypt his own encrypted taker address from the fill record
      const encFillTaker = await contract.getFillEncryptedTaker(0);
      const decFillTaker = await fhevm.userDecryptEaddress(encFillTaker, contractAddress, signers.bob);
      expect(decFillTaker.toLowerCase()).to.eq(signers.bob.address.toLowerCase());
    });
  });

  // =========================================================================
  //               COMPLIANCE / AUDITOR ACCESS
  // =========================================================================

  describe("Auditor Compliance Access", function () {
    it("auditor can decrypt order details after being granted access", async function () {
      // Set auditor
      await (await contract.connect(signers.deployer).setAuditor(signers.auditor.address)).wait();

      const ethDeposit = ethers.parseEther("1.0");

      // Create SELL order
      const makerInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(5000)
        .add64(200)
        .encrypt();

      await (
        await contract
          .connect(signers.alice)
          .createOrder(
            makerInput.handles[0],
            makerInput.inputProof,
            makerInput.handles[1],
            makerInput.inputProof,
            false,
            "ETH/USDC",
            0,
            { value: ethDeposit },
          )
      ).wait();

      // Fill SELL order: taker pays USDC, gets ETH
      const takerUsdc = 1000000n;
      await mintAndApprove(signers.bob, takerUsdc);

      const takerInput = await fhevm
        .createEncryptedInput(contractAddress, signers.bob.address)
        .add64(5000)
        .add64(200)
        .encrypt();

      await (
        await contract
          .connect(signers.bob)
          .fillOrder(
            0,
            takerInput.handles[0],
            takerInput.inputProof,
            takerInput.handles[1],
            takerInput.inputProof,
            ethDeposit,
            takerUsdc,
          )
      ).wait();

      // Owner grants auditor access
      await expect(contract.connect(signers.deployer).grantAuditorAccess(0))
        .to.emit(contract, "AuditorAccessGranted")
        .withArgs(0);

      // Auditor can now decrypt everything
      const encPrice = await contract.getPrice(0);
      const decPrice = await fhevm.userDecryptEuint(FhevmType.euint64, encPrice, contractAddress, signers.auditor);
      expect(decPrice).to.eq(5000);

      const encAmount = await contract.getAmount(0);
      const decAmount = await fhevm.userDecryptEuint(FhevmType.euint64, encAmount, contractAddress, signers.auditor);
      expect(decAmount).to.eq(200);

      // Auditor can decrypt fill details too
      const encFillAmount = await contract.getFillAmount(0);
      const decFillAmount = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        encFillAmount,
        contractAddress,
        signers.auditor,
      );
      expect(decFillAmount).to.eq(200);

      // Auditor can decrypt the settlement total
      const encFillTotal = await contract.getFillTotal(0);
      const decFillTotal = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        encFillTotal,
        contractAddress,
        signers.auditor,
      );
      expect(decFillTotal).to.eq(BigInt(5000) * BigInt(200));
    });

    it("grantAuditorAccess reverts when no auditor is set", async function () {
      const ethDeposit = ethers.parseEther("1.0");

      const encInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await (
        await contract
          .connect(signers.alice)
          .createOrder(
            encInput.handles[0],
            encInput.inputProof,
            encInput.handles[1],
            encInput.inputProof,
            false,
            "ETH/USDC",
            0,
            { value: ethDeposit },
          )
      ).wait();

      await expect(contract.connect(signers.deployer).grantAuditorAccess(0)).to.be.revertedWithCustomError(
        contract,
        "ZeroAddress",
      );
    });

    it("non-owner cannot grant auditor access", async function () {
      await (await contract.connect(signers.deployer).setAuditor(signers.auditor.address)).wait();

      const usdcDeposit = 1000000n;
      await mintAndApprove(signers.alice, usdcDeposit);

      const encInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await (
        await contract
          .connect(signers.alice)
          .createOrder(
            encInput.handles[0],
            encInput.inputProof,
            encInput.handles[1],
            encInput.inputProof,
            true,
            "ETH/USDC",
            usdcDeposit,
          )
      ).wait();

      await expect(contract.connect(signers.alice).grantAuditorAccess(0)).to.be.revertedWithCustomError(
        contract,
        "NotOwner",
      );
    });
  });

  // =========================================================================
  //                    POST-TRADE TRANSPARENCY
  // =========================================================================

  describe("Post-Trade Transparency", function () {
    it("fill amount should be publicly decryptable after settlement", async function () {
      const ethDeposit = ethers.parseEther("0.5");

      const makerInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(1000)
        .add64(50)
        .encrypt();

      await (
        await contract
          .connect(signers.alice)
          .createOrder(
            makerInput.handles[0],
            makerInput.inputProof,
            makerInput.handles[1],
            makerInput.inputProof,
            false,
            "ETH/USDC",
            0,
            { value: ethDeposit },
          )
      ).wait();

      const takerUsdc = 50000n;
      await mintAndApprove(signers.bob, takerUsdc);

      const takerInput = await fhevm
        .createEncryptedInput(contractAddress, signers.bob.address)
        .add64(1000)
        .add64(50)
        .encrypt();

      await (
        await contract
          .connect(signers.bob)
          .fillOrder(
            0,
            takerInput.handles[0],
            takerInput.inputProof,
            takerInput.handles[1],
            takerInput.inputProof,
            ethDeposit,
            takerUsdc,
          )
      ).wait();

      // The fill amount was made publicly decryptable via FHE.makePubliclyDecryptable.
      const encFillAmount = await contract.getFillAmount(0);
      expect(encFillAmount).to.not.eq(ethers.ZeroHash);

      // Both maker and taker can decrypt
      const decFillByMaker = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        encFillAmount,
        contractAddress,
        signers.alice,
      );
      expect(decFillByMaker).to.eq(50);

      const decFillByTaker = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        encFillAmount,
        contractAddress,
        signers.bob,
      );
      expect(decFillByTaker).to.eq(50);
    });
  });

  // =========================================================================
  //                       GRANT ACCESS
  // =========================================================================

  describe("grantAccess", function () {
    it("maker can grant view access to third party", async function () {
      const ethDeposit = ethers.parseEther("1.0");

      const encInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(5000)
        .add64(200)
        .encrypt();

      await (
        await contract
          .connect(signers.alice)
          .createOrder(
            encInput.handles[0],
            encInput.inputProof,
            encInput.handles[1],
            encInput.inputProof,
            false,
            "ETH/USDC",
            0,
            { value: ethDeposit },
          )
      ).wait();

      await expect(contract.connect(signers.alice).grantAccess(0, signers.carol.address))
        .to.emit(contract, "AccessGranted")
        .withArgs(0, signers.carol.address);

      // Carol can now decrypt
      const encPrice = await contract.getPrice(0);
      const decPrice = await fhevm.userDecryptEuint(FhevmType.euint64, encPrice, contractAddress, signers.carol);
      expect(decPrice).to.eq(5000);

      const encAmount = await contract.getAmount(0);
      const decAmount = await fhevm.userDecryptEuint(FhevmType.euint64, encAmount, contractAddress, signers.carol);
      expect(decAmount).to.eq(200);
    });

    it("non-maker cannot grant access", async function () {
      const usdcDeposit = 1000000n;
      await mintAndApprove(signers.alice, usdcDeposit);

      const encInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await (
        await contract
          .connect(signers.alice)
          .createOrder(
            encInput.handles[0],
            encInput.inputProof,
            encInput.handles[1],
            encInput.inputProof,
            true,
            "ETH/USDC",
            usdcDeposit,
          )
      ).wait();

      await expect(
        contract.connect(signers.bob).grantAccess(0, signers.carol.address),
      ).to.be.revertedWithCustomError(contract, "NotMaker");
    });

    it("cannot grant access to zero address", async function () {
      const usdcDeposit = 1000000n;
      await mintAndApprove(signers.alice, usdcDeposit);

      const encInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await (
        await contract
          .connect(signers.alice)
          .createOrder(
            encInput.handles[0],
            encInput.inputProof,
            encInput.handles[1],
            encInput.inputProof,
            true,
            "ETH/USDC",
            usdcDeposit,
          )
      ).wait();

      await expect(
        contract.connect(signers.alice).grantAccess(0, ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(contract, "ZeroAddress");
    });
  });

  // =========================================================================
  //                        VIEW FUNCTIONS
  // =========================================================================

  describe("View Functions", function () {
    it("should return correct order count", async function () {
      expect(await contract.orderCount()).to.eq(0);
      expect(await contract.fillCount()).to.eq(0);
    });

    it("should revert getOrder for invalid orderId", async function () {
      await expect(contract.getOrder(0)).to.be.revertedWithCustomError(contract, "InvalidOrderId");
    });

    it("should revert getPrice for invalid orderId", async function () {
      await expect(contract.getPrice(0)).to.be.revertedWithCustomError(contract, "InvalidOrderId");
    });

    it("should revert getAmount for invalid orderId", async function () {
      await expect(contract.getAmount(0)).to.be.revertedWithCustomError(contract, "InvalidOrderId");
    });

    it("should revert getRemainingAmount for invalid orderId", async function () {
      await expect(contract.getRemainingAmount(0)).to.be.revertedWithCustomError(contract, "InvalidOrderId");
    });

    it("should revert getEncryptedTaker for invalid orderId", async function () {
      await expect(contract.getEncryptedTaker(0)).to.be.revertedWithCustomError(contract, "InvalidOrderId");
    });

    it("should revert getFill for invalid fillId", async function () {
      await expect(contract.getFill(0)).to.be.revertedWithCustomError(contract, "InvalidFillId");
    });

    it("should revert getFillAmount for invalid fillId", async function () {
      await expect(contract.getFillAmount(0)).to.be.revertedWithCustomError(contract, "InvalidFillId");
    });

    it("should revert getFillTotal for invalid fillId", async function () {
      await expect(contract.getFillTotal(0)).to.be.revertedWithCustomError(contract, "InvalidFillId");
    });

    it("should revert getFillPriorityScore for invalid fillId", async function () {
      await expect(contract.getFillPriorityScore(0)).to.be.revertedWithCustomError(contract, "InvalidFillId");
    });

    it("should revert getFillEncryptedTaker for invalid fillId", async function () {
      await expect(contract.getFillEncryptedTaker(0)).to.be.revertedWithCustomError(contract, "InvalidFillId");
    });

    it("getOrderFills should return fill IDs for an order", async function () {
      const usdcDeposit = 1000000n;
      await mintAndApprove(signers.alice, usdcDeposit);

      const makerInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await (
        await contract
          .connect(signers.alice)
          .createOrder(
            makerInput.handles[0],
            makerInput.inputProof,
            makerInput.handles[1],
            makerInput.inputProof,
            true,
            "ETH/USDC",
            usdcDeposit,
          )
      ).wait();

      const takerInput = await fhevm
        .createEncryptedInput(contractAddress, signers.bob.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await (
        await contract
          .connect(signers.bob)
          .fillOrder(
            0,
            takerInput.handles[0],
            takerInput.inputProof,
            takerInput.handles[1],
            takerInput.inputProof,
            ethers.parseEther("0.5"),
            usdcDeposit,
            { value: ethers.parseEther("0.5") },
          )
      ).wait();

      const fillIds = await contract.getOrderFills(0);
      expect(fillIds.length).to.eq(1);
      expect(fillIds[0]).to.eq(0);
    });
  });

  // =========================================================================
  //                   PROTOCOL VOLUME TRACKING
  // =========================================================================

  describe("Protocol Volume Tracking", function () {
    it("total volume should accumulate across fills", async function () {
      // Create and fill first order (SELL)
      const ethDeposit1 = ethers.parseEther("0.5");

      const maker1Input = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(1000)
        .add64(50)
        .encrypt();

      await (
        await contract
          .connect(signers.alice)
          .createOrder(
            maker1Input.handles[0],
            maker1Input.inputProof,
            maker1Input.handles[1],
            maker1Input.inputProof,
            false,
            "ETH/USDC",
            0,
            { value: ethDeposit1 },
          )
      ).wait();

      const taker1Usdc = 50000n;
      await mintAndApprove(signers.bob, taker1Usdc);

      const taker1Input = await fhevm
        .createEncryptedInput(contractAddress, signers.bob.address)
        .add64(1000)
        .add64(50)
        .encrypt();

      await (
        await contract
          .connect(signers.bob)
          .fillOrder(
            0,
            taker1Input.handles[0],
            taker1Input.inputProof,
            taker1Input.handles[1],
            taker1Input.inputProof,
            ethDeposit1,
            taker1Usdc,
          )
      ).wait();

      // Create and fill second order (BUY)
      const usdcDeposit2 = 300000n;
      await mintAndApprove(signers.alice, usdcDeposit2);

      const maker2Input = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(2000)
        .add64(30)
        .encrypt();

      await (
        await contract
          .connect(signers.alice)
          .createOrder(
            maker2Input.handles[0],
            maker2Input.inputProof,
            maker2Input.handles[1],
            maker2Input.inputProof,
            true,
            "BTC/USDC",
            usdcDeposit2,
          )
      ).wait();

      const taker2Input = await fhevm
        .createEncryptedInput(contractAddress, signers.bob.address)
        .add64(2000)
        .add64(30)
        .encrypt();

      await (
        await contract
          .connect(signers.bob)
          .fillOrder(
            1,
            taker2Input.handles[0],
            taker2Input.inputProof,
            taker2Input.handles[1],
            taker2Input.inputProof,
            ethers.parseEther("0.3"),
            usdcDeposit2,
            { value: ethers.parseEther("0.3") },
          )
      ).wait();

      expect(await contract.totalFillCount()).to.eq(2);

      // Total volume handle should exist
      const encVolume = await contract.getTotalVolume();
      expect(encVolume).to.not.eq(ethers.ZeroHash);
    });
  });

  // =========================================================================
  //                        EDGE CASES
  // =========================================================================

  describe("Edge Cases", function () {
    it("fill with zero taker amount should produce zero fill", async function () {
      const usdcDeposit = 1000000n;
      await mintAndApprove(signers.alice, usdcDeposit);

      const makerInput = await fhevm
        .createEncryptedInput(contractAddress, signers.alice.address)
        .add64(1500)
        .add64(100)
        .encrypt();

      await (
        await contract
          .connect(signers.alice)
          .createOrder(
            makerInput.handles[0],
            makerInput.inputProof,
            makerInput.handles[1],
            makerInput.inputProof,
            true,
            "ETH/USDC",
            usdcDeposit,
          )
      ).wait();

      const takerInput = await fhevm
        .createEncryptedInput(contractAddress, signers.bob.address)
        .add64(1500)
        .add64(0) // zero amount
        .encrypt();

      await (
        await contract
          .connect(signers.bob)
          .fillOrder(
            0,
            takerInput.handles[0],
            takerInput.inputProof,
            takerInput.handles[1],
            takerInput.inputProof,
            ethers.parseEther("0.1"),
            500000n, // partial USDC
            { value: ethers.parseEther("0.1") },
          )
      ).wait();

      // Fill amount should be 0
      const encFillAmount = await contract.getFillAmount(0);
      const decFillAmount = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        encFillAmount,
        contractAddress,
        signers.bob,
      );
      expect(decFillAmount).to.eq(0);
    });

    it("constructor should revert with zero address token", async function () {
      const factory = (await ethers.getContractFactory("ConfidentialOTC")) as ConfidentialOTC__factory;
      await expect(factory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(contract, "ZeroAddress");
    });
  });
});
