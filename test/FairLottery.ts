import { expect } from "chai";
import { network } from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

const { ethers, networkHelpers } = await network.create();

// Setup-Helper: deployt eine Lotterie, einzelne Werte lassen sich pro Test überschreiben
async function deployLottery(overrides = {}) {
  const [owner, anna, bruno, claudia, diego, elodie, florian, globi] = await ethers.getSigners();

  const tree = StandardMerkleTree.of(
    [[anna.address], [bruno.address], [claudia.address], [diego.address], [elodie.address]],
    ["address"]
  );

  // Parameters for the lottery 
  const params = {
    courseName: "Smart Contracts and Decentralized Finance",
    courseNumber: "52354-01",
    merkleRoot: tree.root,
    deposit: ethers.parseEther("0.0001"),
    refundPercentage: 50, // 50 %
    availablePlaces: 2,
    everyoneCommits: false,
    theCourseCosts: false,
    lateRegistration: false,
    registrationMinutes: 10,
    revealMinutes: 10,
    withdrawMinutes: 10,
    courseDuration: 10,
    registrationEnd: 0,
    revealEnd: 0,
    courseStart: 0,
    courseEnd: 0,
    ...overrides,
  };

  // console.log(params);

  // Deployment of the lottery with the previous created parameters
  const lottery = await ethers.deployContract("FairLottery", [
    params.courseName,
    params.courseNumber,
    params.deposit,
    params.refundPercentage,
    params.availablePlaces,
    params.merkleRoot,
    params.everyoneCommits,
    params.theCourseCosts,
    params.lateRegistration,
    {
      registrationMinutes: params.registrationMinutes,
      revealMinutes: params.revealMinutes,
      withdrawMinutes: params.withdrawMinutes,
      courseDuration: params.courseDuration,
    },
  ]);

  params.registrationEnd = Number(await lottery.registrationEnd());
  params.revealEnd = Number(await lottery.revealEnd());
  params.courseStart = Number(await lottery.courseStart());
  params.courseEnd = Number(await lottery.courseEnd());

  return { lottery, tree, params, owner, anna, bruno, claudia, diego, elodie, florian, globi };
}

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

  async function findNotPicked(lottery: any, candidates: any[]) {
    const winners = await lottery.getWinners();
    const waiting = await lottery.getWaitingList();
    return candidates.find(
      (s) => !winners.includes(s.address) && !waiting.includes(s.address)
    );
  }

  it("Can't claim the deposit twice", async function () {
    const deployment = await registerFive();
    const { lottery, params, anna, bruno, claudia, diego, elodie } = deployment;
    await lottery.draw();

    const notPicked = await findNotPicked(lottery, [anna, bruno, claudia, diego, elodie]);

    await expect(lottery.connect(notPicked).claimDeposit())
      .to.changeEtherBalance(ethers, notPicked, params.deposit);
    await expect(lottery.connect(notPicked).claimDeposit())
      .to.revertedWithCustomError(lottery, "NotRegistered");
  });
  
  it("Should be able to register again after the unregistration", async function () {
    const {lottery, tree, params, elodie} = await deployLottery();
    await registerAs(lottery, tree, elodie, params.deposit);
    await lottery.connect(elodie).unregister();

    await expect (lottery.connect(elodie).register(tree.getProof([elodie.address]), {value: params.deposit}))
      .to.emit(lottery, "Registered").withArgs(elodie.address);
  
    const listNew = await lottery.getParticipants();
    expect (listNew.length).to.equal(1);
    expect (listNew).to.include(elodie.address);
  });

  it("Should be able to register and claiming Deposit twice", async function () {
    const {lottery, tree, params, elodie} = await deployLottery();
    
    await registerAs(lottery, tree, elodie, params.deposit);
    const tx1 = lottery.connect(elodie).unregister();
    await expect(tx1).to.changeEtherBalance(ethers, elodie, params.deposit)

    await registerAs(lottery, tree, elodie, params.deposit);
    const tx2 = lottery.connect(elodie).unregister();
    await expect(tx2).to.changeEtherBalance(ethers, elodie, params.deposit)
  });

  it("Rejects claimDeposit from an address that never registered", async function () {
    const { lottery, globi } = await registerFive();
    await lottery.draw();

    await expect(lottery.connect(globi).claimDeposit())
      .to.be.revertedWithCustomError(lottery, "NotRegistered");
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

  describe("FairLottery: Decline Places", function() {
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

    it("Correct amount is refunded to winners after one declined", async function () {
        await networkHelpers.time.increaseTo(params.courseEnd);
        await lottery.finalize();
        const winnersNow = await lottery.getWinners();
        const winner = await ethers.getSigner(winnersNow[0]);
        const forfeited = (params.deposit * BigInt(100 - params.refundPercentage))/100n;
        const expectedRefundAmount = params.deposit + forfeited/BigInt(winnersNow.length);
        await expect (lottery.connect(winner).refundWinnersAfterDeadline())
          .to.changeEtherBalance(ethers, winner, expectedRefundAmount);
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
    const hashFromLottery = await lottery.connect(bruno).generateCommitHash(NUMBER, SECRET);
    const hashLocal = ethers.solidityPackedKeccak256(["address", "uint256", "string"], [bruno.address, NUMBER, SECRET]);

    expect (hashFromLottery).to.equal(hashLocal);
  })

  it("Registered participant can commit", async function() {
    const {lottery, tree, params, bruno} = await deployLottery();
    await registerAs(lottery, tree, bruno, params.deposit);

    const hash = await lottery.generateCommitHash(NUMBER, SECRET);

    await expect (lottery.connect(bruno).commit(hash))
      .to.emit(lottery, "Committed")
      .withArgs(bruno.address)
  });

  it("Rejecting a second commit", async function() {
    const {lottery, tree, params, bruno} = await deployLottery();
    await registerAs(lottery, tree, bruno, params.deposit);

    const hash = await lottery.generateCommitHash(NUMBER, SECRET);
    await lottery.connect(bruno).commit(hash);

    await expect(lottery.connect(bruno).commit(hash))
    .to.be.revertedWithCustomError(lottery, "AlreadyCommitted")
  });

  it("Reject commit of unregistrated participants", async function() {
    const {lottery, params, globi} = await deployLottery();
    const hash = await lottery.generateCommitHash(NUMBER, SECRET);

    await expect(lottery.connect(globi).commit(hash))
    .to.be.revertedWithCustomError(lottery, "NotRegistered")
  });

  it("Rejects an empty commit", async function() {
    const {lottery, tree, params, bruno} = await deployLottery();
    await registerAs(lottery, tree, bruno, params.deposit);

    await expect(lottery.connect(bruno).commit(ethers.ZeroHash))
    .to.be.revertedWithCustomError(lottery, "EmptyHash")
  });


  it("Rejects a commit after registration phase", async function() {
    const {lottery, tree, params, bruno} = await deployLottery();
    await registerAs(lottery, tree, bruno, params.deposit);
    await networkHelpers.time.increaseTo(params.registrationEnd+1);


    const hash = await lottery.connect(bruno).generateCommitHash(NUMBER, SECRET);
    
    await expect(lottery.connect(bruno).commit(hash))
    .to.be.revertedWithCustomError(lottery, "WrongPhase")
  });
});

describe("FairLottery: Reveal function", function () {

  // Commit values
  const NUMBER = 88888;
  const SECRET = "The best secret in the world!";

  async function commitAs(_lottery: any, signer: any, number = NUMBER, secret = SECRET) {
    const {lottery, tree, params} = _lottery;
    await registerAs(lottery, tree, signer, params.deposit);

    const hash = await lottery.connect(signer).generateCommitHash(number, secret);
    await lottery.connect(signer).commit(hash);
  };

  async function commitFive() {
    const deployment = await deployLottery()
    const { lottery, tree, params, anna, bruno, claudia, diego, elodie } = deployment;
    await registerAs(lottery, tree, anna, params.deposit);
    await registerAs(lottery, tree, bruno, params.deposit);
    await registerAs(lottery, tree, claudia, params.deposit);
    await registerAs(lottery, tree, diego, params.deposit);
    await registerAs(lottery, tree, elodie, params.deposit);
    return deployment;
  };
  
  async function startReveal(params: any) {
    await networkHelpers.time.increaseTo(params.registrationEnd);
  }

  it("Reveal works with a true commit", async function () {
    const deployment = await deployLottery();
    const {lottery, params, elodie} = deployment;
    await commitAs(deployment, elodie);

    await startReveal(params);

    
    await expect (lottery.connect(elodie).reveal(NUMBER, SECRET))
      .to.emit(lottery, "Revealed")
      .withArgs(elodie.address);

    const expectedSeed = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "uint256"], [ethers.ZeroHash, NUMBER]));
    expect (await lottery.seed()).to.equal(expectedSeed);
  });

  it("Reveals only correct values", async function() {
    const deployment = await deployLottery();
    const {lottery, params, elodie} = deployment;
    await commitAs(deployment, elodie);

    await startReveal(params);
    await expect (lottery.connect(elodie).reveal(42, SECRET))
      .to.be.revertedWithCustomError(lottery, "WrongInputs");
  });

  it("Reveals only own correct values", async function() {
    const deployment = await commitFive();
    const { lottery, params, bruno, diego, elodie } = deployment;

    const hashElodie = await lottery.connect(elodie).generateCommitHash(NUMBER, SECRET);
    await lottery.connect(elodie).commit(hashElodie);

    const hashBruno = await lottery.connect(bruno).generateCommitHash(42, SECRET);
    await lottery.connect(diego).commit(hashBruno);

    await startReveal(params);

    await expect (lottery.connect(elodie).reveal(42, SECRET))
      .to.be.revertedWithCustomError(lottery, "WrongInputs");
  });

  it("Reveals only own correct values 2", async function() {
    const deployment = await commitFive();
    const { lottery, params, bruno, diego, elodie } = deployment;

    const hashElodie = await lottery.connect(elodie).generateCommitHash(NUMBER, SECRET);
    await lottery.connect(elodie).commit(hashElodie);

    const hashBruno = await lottery.connect(bruno).generateCommitHash(42, SECRET);
    await lottery.connect(diego).commit(hashBruno);

    await networkHelpers.time.increaseTo(params.registrationEnd);

    await expect (lottery.connect(diego).reveal(42, SECRET))
      .to.be.revertedWithCustomError(lottery, "WrongInputs");
  });

  it("Rejects a second reveal", async function() {
    const deployment = await commitFive();
    const { lottery, params, elodie } = deployment;

    const hashElodie = await lottery.connect(elodie).generateCommitHash(NUMBER, SECRET);
    await lottery.connect(elodie).commit(hashElodie);

    await startReveal(params);

    await lottery.connect(elodie).reveal(NUMBER, SECRET);
    await expect (lottery.connect(elodie).reveal(NUMBER, SECRET))
      .to.be.revertedWithCustomError(lottery, "AlreadyRevealed");
  });

  it("Rejects reveal if never commited", async function() {
    const deployment = await commitFive();
    const { lottery, params, elodie } = deployment;

    await networkHelpers.time.increaseTo(params.registrationEnd);

    await expect (lottery.connect(elodie).reveal(NUMBER, SECRET))
      .to.be.revertedWithCustomError(lottery, "EmptyHash");
  });

  it("Lottery Seed gets adjusted corectly after two reveals", async function() {
    const deployment = await deployLottery();
    const { lottery, params, diego, elodie } = deployment;

    await commitAs(deployment, elodie);
    await commitAs(deployment, diego, 42, SECRET);

    await startReveal(params);

    await lottery.connect(elodie).reveal(NUMBER, SECRET);
    const seedElodie = await lottery.seed();
    await lottery.connect(diego).reveal(42, SECRET);
    const seedDiego = await lottery.seed();

    expect(seedElodie).to.not.equal(ethers.ZeroHash);
    expect(seedDiego).to.not.equal(seedElodie);

  });
});

describe("FairLottery: Modes, payouts and edge cases", function () {

  async function registerFiveWith(overrides = {}) {
    const deployment = await deployLottery(overrides);
    const { lottery, tree, params, anna, bruno, claudia, diego, elodie } = deployment;
    for (const s of [anna, bruno, claudia, diego, elodie]) {
      await registerAs(lottery, tree, s, params.deposit);
    }
    await networkHelpers.time.increaseTo(params.revealEnd);
    return deployment;
  }

  async function balanceOf(lottery: any) {
    return ethers.provider.getBalance(await lottery.getAddress());
  }

  it("Lottery is empty after all payouts (one winner declined)", async function () {
    const { lottery, params, owner, anna, bruno, claudia, diego, elodie } = await registerFiveWith();
    await lottery.draw();

    const decliner = await ethers.getSigner((await lottery.getWinners())[0]);
    await lottery.connect(decliner).refundAfterPlaceGranted();

    await networkHelpers.time.increaseTo(params.courseEnd);
    await lottery.finalize();

    const winners = await lottery.getWinners();
    for (const s of [anna, bruno, claudia, diego, elodie]) {
      if (winners.includes(s.address)) {
        await lottery.connect(s).refundWinnersAfterDeadline();
      } else if (s.address !== decliner.address) {
        await lottery.connect(s).claimDeposit();
      }
    }
    await lottery.connect(owner).withdrawUndistributed();

    expect(await balanceOf(lottery)).to.equal(0n);
    expect(await lottery.moneyDeposited()).to.equal(0n);
  });

  it("Winner can't be refunded twice", async function () {
    const { lottery, params } = await registerFiveWith();
    await lottery.draw();
    await networkHelpers.time.increaseTo(params.courseEnd);
    await lottery.finalize();

    const winner = await ethers.getSigner((await lottery.getWinners())[0]);
    await lottery.connect(winner).refundWinnersAfterDeadline();
    await expect(lottery.connect(winner).refundWinnersAfterDeadline())
      .to.be.revertedWithCustomError(lottery, "AlreadyRefunded");
  });

  it("Only the owner can withdraw the course fees", async function () {
    const { lottery, params, anna } = await registerFiveWith({ theCourseCosts: true });
    await lottery.draw();
    await networkHelpers.time.increaseTo(params.courseEnd);
    await lottery.finalize();

    await expect(lottery.connect(anna).withdrawCourseFees())
      .to.be.revertedWithCustomError(lottery, "NotOwner");
  });

  it("theCourseCosts: owner gets the fees once, winners only the pool share", async function () {
    const { lottery, params, owner } = await registerFiveWith({ theCourseCosts: true });
    await lottery.draw();
    await networkHelpers.time.increaseTo(params.courseEnd);
    await lottery.finalize();

    const fees = params.deposit * BigInt(params.availablePlaces);
    await expect(lottery.connect(owner).withdrawCourseFees())
      .to.changeEtherBalance(ethers, owner, fees);
    await expect(lottery.connect(owner).withdrawCourseFees())
      .to.be.revertedWithCustomError(lottery, "AlreadyWithdrawn");

    const winner = await ethers.getSigner((await lottery.getWinners())[0]);
    await expect(lottery.connect(winner).refundWinnersAfterDeadline())
      .to.changeEtherBalance(ethers, winner, 0n);
  });

  it("withdrawCourseFees is rejected if the course is free", async function () {
    const { lottery, params, owner } = await registerFiveWith();
    await lottery.draw();
    await networkHelpers.time.increaseTo(params.courseEnd);
    await lottery.finalize();

    await expect(lottery.connect(owner).withdrawCourseFees())
      .to.be.revertedWithCustomError(lottery, "NoCourseFee");
  });

  it("If all winners decline the owner gets the whole pool once", async function () {
    const { lottery, tree, params, owner, anna, bruno } = await deployLottery();
    await registerAs(lottery, tree, anna, params.deposit);
    await registerAs(lottery, tree, bruno, params.deposit);
    await networkHelpers.time.increaseTo(params.revealEnd);
    await lottery.draw();

    await lottery.connect(anna).refundAfterPlaceGranted();
    await lottery.connect(bruno).refundAfterPlaceGranted();
    expect((await lottery.getWinners()).length).to.equal(0);

    await networkHelpers.time.increaseTo(params.courseEnd);
    await lottery.finalize();

    const pool = await lottery.forfeitedPool();
    await expect(lottery.connect(owner).withdrawUndistributed())
      .to.changeEtherBalance(ethers, owner, pool);
    await expect(lottery.connect(owner).withdrawUndistributed())
      .to.be.revertedWithCustomError(lottery, "AlreadyWithdrawn");
    expect(await balanceOf(lottery)).to.equal(0n);
  });

  it("everyoneCommits: only revealers are drawn, the others lose their deposit", async function () {
    const { lottery, tree, params, anna, bruno, claudia } = await deployLottery({ everyoneCommits: true });
    for (const s of [anna, bruno, claudia]) await registerAs(lottery, tree, s, params.deposit);

    const secretWord = "highLevelSecret";

    // Only Anna and Bruno are commiting and revealing
    for (const [s, n] of [[anna, 1], [bruno, 2]] as const) {
      const hash = await lottery.connect(s).generateCommitHash(n, secretWord);
      await lottery.connect(s).commit(hash);
    }
    await networkHelpers.time.increaseTo(params.registrationEnd);
    await lottery.connect(anna).reveal(1, secretWord);
    await lottery.connect(bruno).reveal(2, secretWord);
    await networkHelpers.time.increaseTo(params.revealEnd);
    await lottery.draw();

    const winners = await lottery.getWinners();
    expect(winners).to.have.members([anna.address, bruno.address]);
    expect(await lottery.forfeitedPool()).to.equal(params.deposit); // claudias deposit
    await expect(lottery.connect(claudia).claimDeposit())
      .to.be.revertedWithCustomError(lottery, "NotRevealed");
  });

  it("lateRegister is rejected if late registration is disabled", async function () {
    const { lottery, tree, params, anna, diego } = await deployLottery();
    await registerAs(lottery, tree, anna, params.deposit);
    await networkHelpers.time.increaseTo(params.revealEnd);
    await lottery.draw();

    await expect(lottery.connect(diego).lateRegister(tree.getProof([diego.address]), { value: params.deposit }))
      .to.be.revertedWithCustomError(lottery, "LateRegistrationDisabled");
  });

  it("lateRegister fills free places and stops when the course is full", async function () {
    const { lottery, tree, params, anna, bruno, claudia } = await deployLottery({ lateRegistration: true });
    await registerAs(lottery, tree, anna, params.deposit);
    await networkHelpers.time.increaseTo(params.revealEnd);
    await lottery.draw();

    await expect(lottery.connect(bruno).lateRegister(tree.getProof([bruno.address]), { value: params.deposit }))
      .to.emit(lottery, "Winner").withArgs(bruno.address);
    expect(await lottery.checkIfWon(bruno.address)).to.equal(true);

    await expect(lottery.connect(claudia).lateRegister(tree.getProof([claudia.address]), { value: params.deposit }))
      .to.be.revertedWithCustomError(lottery, "CantRegisterAnymore");
  });

  it("leaveWaitingList refunds fully and the person who left is skipped when a winner declines", async function () {
    const { lottery, params } = await registerFiveWith();
    await lottery.draw();

    const waiting = await lottery.getWaitingList();
    const leaver = await ethers.getSigner(waiting[0]);
    await expect(lottery.connect(leaver).leaveWaitingList())
      .to.changeEtherBalance(ethers, leaver, params.deposit);

    const decliner = await ethers.getSigner((await lottery.getWinners())[0]);
    await lottery.connect(decliner).refundAfterPlaceGranted();

    const winners = await lottery.getWinners();
    expect(winners).to.include(waiting[1]);
    expect(winners).not.to.include(leaver.address);
  });

  it("leaveWaitingList is rejected for someone not on the waiting list", async function () {
    const { lottery } = await registerFiveWith();
    await lottery.draw();

    const winner = await ethers.getSigner((await lottery.getWinners())[0]);
    await expect(lottery.connect(winner).leaveWaitingList())
      .to.be.revertedWithCustomError(lottery, "NotOnWaitingList");
  });

  it("Waiter must use leaveWaitingList before courseStart, claimDeposit after", async function () {
    const { lottery, params } = await registerFiveWith();
    await lottery.draw();

    const waiter = await ethers.getSigner((await lottery.getWaitingList())[0]);
    await expect(lottery.connect(waiter).claimDeposit())
      .to.be.revertedWithCustomError(lottery, "UseLeaveWaitingList");

    await networkHelpers.time.increaseTo(params.courseStart);
    await expect(lottery.connect(waiter).claimDeposit())
      .to.changeEtherBalance(ethers, waiter, params.deposit);
    expect(await lottery.checkIfWaitingList(waiter.address)).to.equal(false);
  });

  it("Winner can't use claimDeposit", async function () {
    const { lottery } = await registerFiveWith();
    await lottery.draw();

    const winner = await ethers.getSigner((await lottery.getWinners())[0]);
    await expect(lottery.connect(winner).claimDeposit())
      .to.be.revertedWithCustomError(lottery, "UseRefundWinnersAfterDeadline");
  });

  it("Declining and finalizing are only possible in the right time window", async function () {
    const { lottery, params } = await registerFiveWith();
    await lottery.draw();
    const winner = await ethers.getSigner((await lottery.getWinners())[0]);

    await networkHelpers.time.increaseTo(params.courseStart);
    await expect(lottery.connect(winner).refundAfterPlaceGranted())
      .to.be.revertedWithCustomError(lottery, "WrongPhase");
    await expect(lottery.finalize())
      .to.be.revertedWithCustomError(lottery, "WrongPhase");
  });

  it("Only the owner can update the Merkle root", async function () {
    const { lottery, params, owner, florian, globi } = await deployLottery();
    const newTree = StandardMerkleTree.of([[florian.address], [globi.address]], ["address"]);

    await expect(lottery.connect(florian).updateMerkleTree(newTree.root))
      .to.be.revertedWithCustomError(lottery, "NotOwner");
    await expect(lottery.connect(owner).updateMerkleTree(newTree.root))
      .to.emit(lottery, "UpdateMerkleTree");
    await expect(lottery.connect(globi).register(newTree.getProof([globi.address]), { value: params.deposit }))
      .to.emit(lottery, "Registered").withArgs(globi.address);
  });

  it("The owner can update the Merkle root only during registration", async function () {
    const { lottery, params, owner, florian, globi } = await deployLottery();
    const newTree = StandardMerkleTree.of([[florian.address], [globi.address]], ["address"]);

    await networkHelpers.time.increaseTo(params.registrationEnd);
    await expect(lottery.connect(owner).updateMerkleTree(newTree.root))
      .to.be.revertedWithCustomError(lottery, "WrongPhase");
  });

  it("After unregistering and registering again, a new commit is possible", async function () {
    const { lottery, tree, params, anna } = await deployLottery();
    await registerAs(lottery, tree, anna, params.deposit);
    await lottery.connect(anna).commit(await lottery.connect(anna).generateCommitHash(1, "old"));
    await lottery.connect(anna).unregister();

    await registerAs(lottery, tree, anna, params.deposit);
    await expect(lottery.connect(anna).commit(await lottery.connect(anna).generateCommitHash(2, "new")))
      .to.emit(lottery, "Committed").withArgs(anna.address);
  });
});