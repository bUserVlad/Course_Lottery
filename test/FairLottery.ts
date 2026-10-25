import { expect } from "chai";
import { network } from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

const { ethers } = await network.create();

// Setup-Helper: deployt eine Lotterie, einzelne Werte lassen sich pro Test überschreiben
async function deployLottery(overrides = {}) {
  const [owner, alice, bob, carol] = await ethers.getSigners();

  // Eligible are only Alice and Bob 
  const tree = StandardMerkleTree.of(
    [[alice.address], [bob.address]],
    ["address"]
  );

  // Parameters for the lottery 
  const now = (await ethers.provider.getBlock("latest"))!.timestamp;
  const params = {
    merkleRoot: tree.root,
    deposit: ethers.parseEther("0.0001"),
    refundPercentage: 50,
    availablePlaces: 2,
    registrationEnd: now + 1000, // now + 1_000 seconds
    commitEnd: now + 2000,
    revealEnd: now + 3000,
    ...overrides,
  };

  console.log(params);

  // Deployment of the lottery with the previous created parameters
  const lottery = await ethers.deployContract("FairLottery", [
    params.merkleRoot,
    params.deposit,
    params.refundPercentage,
    params.availablePlaces,
    params.registrationEnd,
    params.commitEnd,
    params.revealEnd,
  ]);

  return { lottery, tree, params, owner, alice, bob, carol };
}

describe("FairLottery: Merkle-Elegible", function () {
  it("Allowed are only registrations with a valide proof", async function () {
    const { lottery, tree, params, alice } = await deployLottery();
    const proof = tree.getProof([alice.address]);

    await expect(
      lottery.connect(alice).register(proof, { value: params.deposit })
    )
      .to.emit(lottery, "Registered")
      .withArgs(alice.address);
  });

  it("Rejects a not elegible address", async function () {
    const { lottery, tree, params, alice, carol } = await deployLottery();
    const aliceProof = tree.getProof([alice.address]);

    await expect(
      lottery.connect(carol).register(aliceProof, { value: params.deposit })
    ).to.be.revertedWithCustomError(lottery, "NotEligible");
  });

  it("Rejects an empty proof", async function () {
    const { lottery, params, carol } = await deployLottery();

    await expect(
      lottery.connect(carol).register([], { value: params.deposit })
    ).to.be.revertedWithCustomError(lottery, "NotEligible");
  });
});

// Register function
async function registerAs(lottery: any, tree: any, signer: any, deposit: bigint) {
  const proof = tree.getProof([signer.address]);
  await lottery.connect(signer).register(proof, { value: deposit });
}

// Testing if only registered people can unregister during the registration period
describe("FairLottery: Unregister", function () {
    it("Can only unregister if already registerd", async function () {
        const { lottery, tree, params, alice } = await deployLottery();
        await registerAs(lottery, tree, alice, params.deposit); // succesfully registerd

        const tx = lottery.connect(alice).unregister()
        await expect(tx).to.changeEtherBalance(ethers, alice, params.deposit)
        await expect(tx).and.to.emit(lottery, "Unregistered").withArgs(alice.address)
    });

    it("Can not unregister if already unregisterd before a new registration", async function () {
        const { lottery, tree, params, alice } = await deployLottery();
        await registerAs(lottery, tree, alice, params.deposit); // succesfully registerd

        await lottery.connect(alice).unregister()

        const tx = lottery.connect(alice).unregister()
        await expect(tx).to.be.revertedWithCustomError(lottery, "NotRegistered");
    });
});
