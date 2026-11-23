# FairLottery: A Verifiable Lottery for Limited Course Places

Smart contract project for the course *Smart Contracts and Decentralized Finance* (University of Basel, FS 2026).

## Problem

In courses with limited capacity, such as Media Studies, places are often given to those who are physically present first in the opening week. Students with a preceding lecture are disadvantaged, and nobody can verify how the places were allocated. At the same time, many students register for every course with limited places and later do not show up, which makes the shortage worse. UniSport courses show the same problem: they are booked out within minutes.

**Why a smart contract:** a central lottery run by the university would have to be trusted. A smart contract makes the rules public and fixed at deployment, and anyone can verify the outcome. Trust is replaced by verifiability.

## How it works

- **Eligibility:** the university publishes a Merkle root of eligible wallet addresses. Only these addresses can register, and a place is bound to the address that registered.
- **Deposit:** every registration locks a refundable deposit. This makes registering for every course costly.
- **Randomness:** participants commit to the hash of a secret number during registration and reveal it afterwards. The revealed numbers form the seed. In the default mode, block randomness (`block.prevrandao`, previous block hash) is mixed in as well.
- **Draw:** a partial Fisher-Yates shuffle selects the winners and a waiting list of the same length.
- **Declining and replacement:** winners can decline until the course starts and get `refundPercentage` of their deposit back. The next person on the waiting list moves up in the same transaction.
- **Redistribution:** forfeited amounts go into a pool that is split equally among the final winners after the course ends. Every participant collects their own payment (pull payments).
- **Phases:** Registration, Reveal, ReadyToDraw, Drawn, CourseStarted, Finished. Most phases follow from timestamps, so no administrator can extend or skip them. `draw` and `finalize` can be called by anyone.

### Modes (set at deployment)

| Mode | Effect |
| --- | --- |
| `everyoneCommits` | Only participants who reveal are drawn; not revealing forfeits the deposit. No block randomness. |
| `theCourseCosts` | The winners' deposits are kept as the course fee and withdrawn by the owner. |
| `lateRegistration` | Places still free after the draw can be taken on a first come, first served basis. |

### Refund rules

| Situation | Payout |
| --- | --- |
| Unregistering during registration | 100% |
| Not drawn, or leaving the waiting list | 100% |
| Declining a place before the course starts | `refundPercentage` |
| Not revealing in the `everyoneCommits` mode | 0% |
| Winner after the course ends | deposit plus share of the pool (only the share if `theCourseCosts`) |

## Repository structure

```
contracts/FairLottery.sol   the lottery contract
test/FairLottery.ts         Hardhat tests (TypeScript, ethers, chai)
scripts/                    Merkle tree script and tree.json
```

## Setup and tests

Requires Node.js and Hardhat 3.

```
npm install
npx hardhat test                 # run all tests
npx hardhat test --coverage      # code coverage
npx hardhat test --gas-stats     # gas usage per function
```

## Deployment

1. Add the eligible addresses to the Merkle tree script and run it. It prints the Merkle root and saves the tree to `scripts/tree.json`, from which each address can derive its proof.
2. Deploy `FairLottery` (for example with Remix and MetaMask on Sepolia) with these constructor arguments, in this order:

   `courseName`, `courseNumber`, `deposit` (in wei), `refundPercentage` (0 to 100), `availablePlaces`, `merkleRoot`, `everyoneCommits`, `theCourseCosts`, `lateRegistration`, and the durations in minutes as one struct `[registrationMinutes, revealMinutes, withdrawMinutes, courseDuration]`.

3. Students call `register(proof)` with exactly the deposit, from the address the proof belongs to.

## Known limitations

- **Eligibility:** admission depends on the university's list, and the owner can update the Merkle root during registration.
- **Randomness in the default mode:** `draw` uses the current block's randomness and can be called by a contract that reverts if the result is unfavourable. A future block fixed before the draw would prevent this.
- **Collusion in the `everyoneCommits` mode:** participants who withhold their reveals until the end can choose between a limited number of outcomes, at the cost of their deposits.
- **Attendance:** the contract cannot observe whether a winner attends the course.
- **Gas limit:** `draw` copies the whole participant list into memory, so a very large number of participants could exceed the block gas limit.
- **Currency:** the deposit is in ETH and fluctuates in Swiss francs.

## Sources

- Commit-reveal scheme based on the course repository: [cifunibas/Smart-Contracts-DeFi, sealedBidAuctionB.sol](https://github.com/cifunibas/Smart-Contracts-DeFi/blob/main/contracts/sealedBidAuctionB.sol)
- Fisher-Yates shuffle: [Ethereum Stack Exchange, question 129364](https://ethereum.stackexchange.com/questions/129364/randomly-shuffling-a-mapping-in-solidity)
- Block randomness: [Speedrun Ethereum, Blockchain randomness in Solidity](https://speedrunethereum.com/guides/blockchain-randomness-solidity)
- Merkle proofs: [OpenZeppelin Contracts (MerkleProof)](https://github.com/OpenZeppelin/openzeppelin-contracts) and [OpenZeppelin merkle-tree (StandardMerkleTree)](https://github.com/OpenZeppelin/merkle-tree)
- `call` instead of `transfer`: [chima, Understanding send, transfer, and call in Solidity](https://dev.to/ceasermikes002/understanding-send-transfer-and-call-in-solidity-security-implications-and-preferences-4pog)

## AI assistance

Claude (Anthropic) was used as an assistant: to review the contract and the tests, suggest missing test cases, explain design questions and the "Stack too deep" error, compute Merkle proofs and gas statistics, and draft the short paper and this README. The contract design and every change are my own; all suggestions were checked and tested before they were adopted. Details are listed in the submitted statement on references and external assistance.
