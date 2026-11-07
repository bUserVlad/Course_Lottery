import { expect } from "chai";
import { network } from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { keccak256, Network } from "ethers";

const { ethers, networkHelpers } = await network.create();

// Setup-Helper: deployt eine Lotterie, einzelne Werte lassen sich pro Test überschreiben
async function deployLottery(overrides = {}) {
  const [owner, anna, bruno, claudia, diego, elodie, florian, globi] = await ethers.getSigners();

  // Eligible are only anna and bruno 
  const tree = StandardMerkleTree.of(
    [[anna.address], [bruno.address], [claudia.address], [diego.address], [elodie.address]],
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

  return { lottery, tree, params, owner, anna, bruno, claudia, diego, elodie, florian, globi};
}

describe("FairLottery: Merkle-Elegible", function () {
  it("Allowed are only registrations with a valide proof", async function () {
    const { lottery, tree, params, anna } = await deployLottery();
    const proof = tree.getProof([anna.address]);

    await expect(
      lottery.connect(anna).register(proof, { value: params.deposit })
    )
      .to.emit(lottery, "Registered")
      .withArgs(anna.address);
  });

  it("Rejects a not elegible address", async function () {
    const { lottery, tree, params, anna, globi } = await deployLottery();
    const annaProof = tree.getProof([anna.address]);

    await expect(
      lottery.connect(globi).register(annaProof, { value: params.deposit })
    ).to.be.revertedWithCustomError(lottery, "NotEligible");
  });

  it("Rejects an empty proof", async function () {
    const { lottery, params, globi } = await deployLottery();

    await expect(
      lottery.connect(globi).register([], { value: params.deposit })
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
        const { lottery, tree, params, anna } = await deployLottery();
        await registerAs(lottery, tree, anna, params.deposit); // succesfully registerd

        const tx = lottery.connect(anna).unregister()
        await expect(tx).to.changeEtherBalance(ethers, anna, params.deposit)
        await expect(tx).and.to.emit(lottery, "Unregistered").withArgs(anna.address)
    });

    it("Can not unregister if already unregisterd before a new registration", async function () {
        const { lottery, tree, params, anna } = await deployLottery();
        await registerAs(lottery, tree, anna, params.deposit); // succesfully registerd

        await lottery.connect(anna).unregister()

        const tx = lottery.connect(anna).unregister()
        await expect(tx).to.be.revertedWithCustomError(lottery, "NotRegistered");
    });

    // Only test the unregistration w/o registration since globi's address not part of the markle tree
    it("Can not unregister if address not part of markle tree", async function () {
        const { lottery, globi } = await deployLottery();

        const tx = lottery.connect(globi).unregister()
        await expect(tx).to.be.revertedWithCustomError(lottery, "NotRegistered");
    });

    it("Rejecting unregister durich the wrong phase", async function () {
        const { lottery, tree, params, anna } = await deployLottery();
        await registerAs(lottery, tree, anna, params.deposit);

        await networkHelpers.time.increaseTo(params.registrationEnd);
        
        const tx = lottery.connect(anna).unregister()
        await expect(tx).to.be.revertedWithCustomError(lottery, "WrongPhase");
    });

    it("Still accepting registration shorty before registration ends", async function() {
        const { lottery, tree, params, anna } = await deployLottery();
        await networkHelpers.time.increaseTo(params.registrationEnd - 10); // 10 secondes before registration ends

        await expect(
            lottery.connect(anna).register(tree.getProof([anna.address]), {value: params.deposit})
            ).to.emit(lottery, "Registered");
    });
  });
  describe("FairLottery: Deposit claim", function () {
    it("Can't claim the deposit twice", async function () {
      const {lottery, tree, params, elodie} = await deployLottery();
      await registerAs(lottery, tree, elodie, params.deposit);
      await lottery.connect(elodie).claimDeposit();
      await expect (lottery.connect(elodie).claimDeposit()).to.be.revertedWithCustomError(lottery, "AlreadyRefunded()");
    });
    
    it("Should be able to register again after claiming Deposit", async function () {
      const {lottery, tree, params, elodie} = await deployLottery();
      await registerAs(lottery, tree, elodie, params.deposit);
      await lottery.connect(elodie).claimDeposit();

      await expect (await lottery.connect(elodie).register(tree.getProof([elodie.address]), {value: params.deposit})
      ).to.emit(lottery, "Registered").withArgs(elodie.address);
    
      const listNew = await lottery.getParticipants();
      expect (listNew.length).to.equal(1);
      expect (listNew).to.include(elodie.address);
    });

    it("Should be able to register and claiming Deposit twice", async function () {
      const {lottery, tree, params, elodie} = await deployLottery();
      
      await registerAs(lottery, tree, elodie, params.deposit);
      const tx1 = lottery.connect(elodie).claimDeposit();
        await expect(tx1).to.changeEtherBalance(ethers, elodie, params.deposit)

      await registerAs(lottery, tree, elodie, params.deposit);
      const tx2 = lottery.connect(elodie).claimDeposit();
        await expect(tx2).to.changeEtherBalance(ethers, elodie, params.deposit)

    });
});

// Testing if view function of the participations list works
describe("FairLottery: Participation list", function () {
  it("Participations list only the only participant", async function () {
      const { lottery, tree, params, anna, bruno, globi } = await deployLottery();
      await registerAs(lottery, tree, anna, params.deposit);

      const list = await lottery.getParticipants()
      expect(list.length).to.equal(1);
      expect(list).to.include(anna.address);
      expect(list).not.to.include(bruno.address);
      expect(list).not.to.include(globi.address);
  });

  it("Participations list only lists participants", async function () {
      const { lottery, tree, params, anna , bruno, globi} = await deployLottery();
      await registerAs(lottery, tree, anna, params.deposit);
      await registerAs(lottery, tree, bruno, params.deposit);

      const list = await lottery.getParticipants()
      expect(list.length).to.equal(2);
      expect(list).to.include(anna.address);
      expect(list).to.include(bruno.address);
      expect(list).not.to.include(globi.address);
  });

  it("Participantions list starts empty", async function () {
      const { lottery } = await deployLottery();
      const list = await lottery.getParticipants();
      expect(list.length).to.equal(0);
  });
});


// Testing if draw function works
describe("FairLottery: Fisher-Yates-Shuffle", function () {

  
  async function registerFive() {
    const deployment = await deployLottery()
    const { lottery, tree, params, anna, bruno, claudia, diego, elodie } = deployment;
    await registerAs(lottery, tree, anna, params.deposit);
    await registerAs(lottery, tree, bruno, params.deposit);
    await registerAs(lottery, tree, claudia, params.deposit);
    await registerAs(lottery, tree, diego, params.deposit);
    await registerAs(lottery, tree, elodie, params.deposit);

    await networkHelpers.time.increaseTo(params.revealEnd);

    return deployment;
  }
  it("Correct Amount of winners are drawn", async function () {
    const {lottery, params} = await registerFive();
    await lottery.draw();

    const winners = await lottery.getWinners();
    const waiter = await lottery.getWaitingList();

    expect(winners.length).to.equal(params.availablePlaces);
    expect(waiter.length).to.equal(params.availablePlaces);
  });

  it("Nobody can be picked twice", async function() {
    const { lottery } = await registerFive();
    await lottery.draw();

    const winners = await lottery.getWinners();
    const waiter = await lottery.getWaitingList();

    const all = [...winners, ...waiter]; // Combining both arrays
    expect(new Set(all).size).to.equal(all.length); // Checks if there are only unique Addresses 
  });

    it("No waiting list if there are not enough participants", async function() {
    const { lottery, tree, params, anna, bruno} = await deployLottery();
    await registerAs(lottery, tree, anna, params.deposit);
    await registerAs(lottery, tree, bruno, params.deposit);

    await networkHelpers.time.increaseTo(params.revealEnd);

    await lottery.draw();
    
    const winner = await lottery.getWinners();
    const waiter = await lottery.getWaitingList();

    expect (winner.length).to.be.equal(2);
    expect (waiter.length).to.be.equal(0);
  });

  it("Rejects a second draw", async function() {
    const { lottery, tree, params, elodie} = await deployLottery();
    await registerAs(lottery, tree, elodie, params.deposit);

    await networkHelpers.time.increaseTo(params.revealEnd);
    await lottery.draw();
    await expect (lottery.draw()).to.be.revertedWithCustomError(lottery, "WrongPhase");
  });

  it("No winner if there is no participant", async function() {
    const { lottery, params} = await deployLottery();

    await networkHelpers.time.increaseTo(params.revealEnd);
    await lottery.draw();

    const winner = await lottery.getWinners();
    const waiter = await lottery.getWaitingList();

    expect (winner.length).to.be.equal(0);
    expect (waiter.length).to.be.equal(0);
  });

  describe("FairLottery: Decline Places", async function() {
    let lottery: any;
    let params: any;
    let decliner: any;
    let firstWaiter: any;
    let winnersStart: string[];
    let waiterStart: string[];
    let expectedRefund: bigint;
    let tree: any;
    let tx: any;

    // Calling before each it
    beforeEach(async function () {
      ({ lottery, tree, params } = await registerFive());
      await lottery.draw();

      winnersStart = await lottery.getWinners();
      decliner = await ethers.getSigner(winnersStart[0]);
      waiterStart = await lottery.getWaitingList();
      firstWaiter = await ethers.getSigner(waiterStart[0]);

      expectedRefund = (params.deposit * BigInt(params.refundPercentage)) / 100n;
      tx = await lottery.connect(decliner).refundAfterPlaceGranted();
    });

    it("Correct amount should be refunded after place was granted", async function () {
      await expect(tx).to.be.changeEtherBalance(ethers, decliner, expectedRefund);
    });

    it("Check if winners list is updated", async function () {
      const winnersEnd = await lottery.getWinners();
      expect (winnersEnd.length).to.be.equal(params.availablePlaces);
      expect (winnersEnd).not.to.include(decliner.address);
      expect (winnersEnd).to.include(firstWaiter.address);
    });

    it("Check if the second winners place heritage is correct", async function() {
      const winnersNow = await lottery.getWinners();
      const declinerSecond = await ethers.getSigner(winnersNow[1]);
      const secondWaiter = waiterStart[1];

      const txSecond = await lottery.connect(declinerSecond).refundAfterPlaceGranted();
      await expect(txSecond).to.be.changeEtherBalance(ethers, declinerSecond, expectedRefund);

      const winnersEnd = await lottery.getWinners();
      expect (winnersEnd.length).to.be.equal(params.availablePlaces);
      expect (winnersEnd).to.include(secondWaiter);
      expect (winnersEnd).not.to.include(declinerSecond.address);
      expect (secondWaiter).to.not.equal(declinerSecond.address);

      expect (await lottery.checkIfWon(secondWaiter)).to.be.equal(true);
      expect (await lottery.checkIfWaitingList(secondWaiter)).to.be.equal(false);
    });

    it("Check if refunded Winner can't be refunded again", async function () {
      await expect (lottery.connect(decliner).refundAfterPlaceGranted()).to.be.revertedWithCustomError(lottery, "NotWinner");
    });

    it("Check if refunded Winner can't registrate again", async function () {
      const proof = tree.getProof([decliner.address])

      await expect (
        lottery.connect(decliner).register(proof, {value: params.deposit}))
        .to.be.revertedWithCustomError(lottery, "WrongPhase");
    });

    it("Check if parameters of participants were updated", async function () {
      expect (await lottery.checkIfWon(decliner.address)).to.equal(false);
      expect (await lottery.checkIfWaitingList(firstWaiter.address)).to.equal(false);
      expect (await lottery.checkIfWon(firstWaiter.address)).to.equal(true);
    });

    it("CheckIfWon should include the winner", async function () {
      const {lottery} = await registerFive();
      await lottery.draw();

      const winners = await lottery.getWinners();
      for (const w of winners) {
        expect (await lottery.checkIfWon(w)).to.be.equal(true);
      }
    });

    it("Check if won is not available before the draw", async function () {
      const {lottery, tree, elodie, params} = await deployLottery();
      await registerAs(lottery, tree, elodie, params.deposit);

      await expect(lottery.checkIfWon(elodie.address)).to.be.revertedWithCustomError(lottery, "NotDrawnYet")
    });
  });
});
  // Testing if draw function works
describe("FairLottery: Commit function", function () {

  // Commit values
  const NUMBER = 88888;
  const SECRET = "The best secret in the world!";

  it("Hash function matches", async function () {
    const {lottery, bruno} = await deployLottery();
    const hashFromLottery = await lottery.generateCommitHash(bruno.address, NUMBER, SECRET);
    const hashLocal = ethers.solidityPackedKeccak256(["address", "uint256", "string"], [bruno.address, NUMBER, SECRET]);

    expect (hashFromLottery).to.equal(hashLocal);
  })

  it("Registered participant can commit", async function() {
    const {lottery, tree, params, bruno} = await deployLottery();
    await registerAs(lottery, tree, bruno, params.deposit);
    await networkHelpers.time.increaseTo(params.registrationEnd + 1);

    const hash = await lottery.generateCommitHash(bruno.address, NUMBER, SECRET);

    await expect (lottery.connect(bruno).commit(hash))
      .to.emit(lottery, "Committed")
      .withArgs(bruno.address)
  });

  it("Rejecting a second commit", async function() {
    const {lottery, tree, params, bruno} = await deployLottery();
    await registerAs(lottery, tree, bruno, params.deposit);
    await networkHelpers.time.increaseTo(params.registrationEnd + 1);

    const hash = await lottery.generateCommitHash(bruno.address, NUMBER, SECRET);
    await lottery.connect(bruno).commit(hash);

    await expect(lottery.connect(bruno).commit(hash))
    .to.be.revertedWithCustomError(lottery, "AlreadyCommitted")
  });

  it("Reject commit of unregistrated participants", async function() {
    const {lottery, params, globi} = await deployLottery();
    
    await networkHelpers.time.increaseTo(params.registrationEnd + 1);
    const hash = await lottery.generateCommitHash(globi.address, NUMBER, SECRET);

    await expect(lottery.connect(globi).commit(hash))
    .to.be.revertedWithCustomError(lottery, "NotRegistered")
  });

  it("Rejects an empty commit", async function() {
    const {lottery, tree, params, bruno} = await deployLottery();
    await registerAs(lottery, tree, bruno, params.deposit);
    await networkHelpers.time.increaseTo(params.registrationEnd + 1);

    await expect(lottery.connect(bruno).commit(ethers.ZeroHash))
    .to.be.revertedWithCustomError(lottery, "EmptyHash")
  });

  it("Rejects a commit during registration phase", async function() {
    const {lottery, tree, params, bruno} = await deployLottery();
    await registerAs(lottery, tree, bruno, params.deposit);

    const hash = await lottery.generateCommitHash(bruno.address, NUMBER, SECRET);
    
    await expect(lottery.connect(bruno).commit(hash))
    .to.be.revertedWithCustomError(lottery, "WrongPhase")
  });

  it("Rejects a commit after commit phase", async function() {
    const {lottery, tree, params, bruno} = await deployLottery();
    await registerAs(lottery, tree, bruno, params.deposit);
    await networkHelpers.time.increaseTo(params.commitEnd);


    const hash = await lottery.generateCommitHash(bruno.address, NUMBER, SECRET);
    
    await expect(lottery.connect(bruno).commit(hash))
    .to.be.revertedWithCustomError(lottery, "WrongPhase")
  });
});

describe("FairLottery: Reveal function", function () {

  // Commit values
  const NUMBER = 88888;
  const SECRET = "The best secret in the world!";

   async function commitAs(_lottery: any, signer: any, number = Number, secret = SECRET) {
    const {lottery, tree, params} = _lottery;
    await registerAs(lottery, tree, signer, params.deposit);
    await networkHelpers.time.increaseTo(params.registrationEnd + 1);

    const hash = await lottery.generateCommitHash(signer.address, NUMBER, SECRET);
    await lottery.connect(signer).commit(hash);

    await networkHelpers.time.increaseTo(params.commitEnd + 1);
  };

  it("Reveal works with a true commit", async function () {
    const deployment = await deployLottery();
    const {lottery, elodie} = await deployment;
    await commitAs(deployment, elodie);

    await expect (lottery.connect(elodie).reveal(NUMBER, SECRET))
      .to.emit(lottery, "Revealed")
      .withArgs(elodie.address);

    const expectedSeed = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "int256"], [ethers.ZeroHash, NUMBER]));
    expect (await lottery.getSeed()).to.equal(expectedSeed);
  });

  it("Reveals only correct values", async function() {
    const deployment = await deployLottery();
    const {lottery, elodie} = deployment;
    await commitAs(deployment, elodie);

    await expect (lottery.connect(elodie).reveal(NUMBER, SECRET))
      .to.emit(lottery, "Revealed")
      .withArgs(elodie.address);
    const expectedSeed = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "int256"], [ethers.ZeroHash, 42]));
    expect (await lottery.getSeed()).to.be.revertedWithCustomError(lottery, "WrongInputs");
  });
});