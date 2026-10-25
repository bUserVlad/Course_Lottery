import { expect } from "chai";
import { network } from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { Network } from "ethers";

const { ethers, networkHelpers } = await network.create();

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
    refundPercentage: 50, // 50 %
    availablePlaces: 2,
    registrationEnd: now + 1000, // now + 1_000 seconds
    commitEnd: now + 2000,
    revealEnd: now + 3000,
    ...overrides,
  };

  // console.log(params);

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

    // Only test the unregistration w/o registration since carol's address not part of the markle tree
    it("Can not unregister if address not part of markle tree", async function () {
        const { lottery, carol } = await deployLottery();

        const tx = lottery.connect(carol).unregister()
        await expect(tx).to.be.revertedWithCustomError(lottery, "NotRegistered");
    });

    it("Rejecting unregister durich the wrong phase", async function () {
        const { lottery, tree, params, alice } = await deployLottery();
        await registerAs(lottery, tree, alice, params.deposit);

        await networkHelpers.time.increaseTo(params.registrationEnd);
        
        const tx = lottery.connect(alice).unregister()
        await expect(tx).to.be.revertedWithCustomError(lottery, "WrongPhase");
    });

    it("Still accepting registration shorty before registration ends", async function() {
        const { lottery, tree, params, alice } = await deployLottery();
        await networkHelpers.time.increaseTo(params.registrationEnd - 10); // 10 secondes before registration ends

        await expect(
            lottery.connect(alice).register(tree.getProof([alice.address]), {value: params.deposit})
            ).to.emit(lottery, "Registered");
    });
});

// Testing if view function of the participations list works
describe("FairLottery: Participation list", function () {
    it("Participations list only the only participant", async function () {
        const { lottery, tree, params, alice, bob, carol } = await deployLottery();
        await registerAs(lottery, tree, alice, params.deposit);

        const list = await lottery.getParticipants()
        expect(list.length).to.equal(1);
        expect(list).to.include(alice.address);
        expect(list).not.to.include(bob.address);
        expect(list).not.to.include(carol.address);
    });

    it("Participations list only lists participants", async function () {
        const { lottery, tree, params, alice , bob, carol} = await deployLottery();
        await registerAs(lottery, tree, alice, params.deposit);
        await registerAs(lottery, tree, bob, params.deposit);

        const list = await lottery.getParticipants()
        expect(list.length).to.equal(2);
        expect(list).to.include(alice.address);
        expect(list).to.include(bob.address);
        expect(list).not.to.include(carol.address);
    });

    it("Participantions list starts empty", async function () {
        const { lottery } = await deployLottery();
        const list = await lottery.getParticipants();
        expect(list.length).to.equal(0);
    });
});