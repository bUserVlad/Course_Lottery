// SPDX-License-Identifier: MIT

pragma solidity ^0.8.34;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract FairLottery {
    
    // Errors
    error RegistrationClosed();
    error AlreadyRegistered();
    error NotRegistered();
    error WrongAmount();
    error WrongPhase();
    error NotEligible();
    error RefundFailed();
    error NotOnWaitingList();
    error InvalidRefundPercentage();
    error NotDrawnYet();
    error UseRefundAfterPlaceGranted();
    error UseLeaveWaitingList();
    error AlreadyRefunded();
    error NotWinner();
    error AlreadyCommitted();
    error EmptyHash();
    error AlreadyRevealed();
    error WrongInputs();
    error WrongTimeline();
    error EmptyMerkleRoot();
    error NoPlaces();
    error NotOwner();


    // Phases each lottery can have
    enum Phase {Registration, Commit, Reveal, ReadyToDraw, Drawn, Finished}

    event Registered(address indexed participant);
    event Unregistered(address indexed participant);
    event LeftWaitingList(address indexed participant);
    event Winner(address indexed participant);
    event Waiter(address indexed participant);
    event PlaceDeclined(address indexed participant);
    event Committed(address indexed participant);
    event Revealed(address indexed participant);
    event Drawn(bytes32 seed);
    event UpdateMerkleTree(bytes32 oldRoot, bytes32 newRoot);

    // Variables for the participants
    struct Participant {
        bool registered;
        bool won;
        bool waiting;
        bytes32 commitHash;
        bool revealed;
        bool depositRefunded;
        uint256 listIndex;
        uint256 winnersIndex;
        uint256 waitingIndex;
    }

    // All variables that a lottery needs for a course participation
    struct Lottery {
        Phase phase;
        address owner;
        bytes32 merkleRoot; 
        uint256 deposit;
        uint256 refundPercentage;
        uint256 moneyDeposited;
        uint256 payOutToWinners;
        uint256 forfeitedPool;
        uint256 availablePlaces;
        uint256 nextWaiting;
        uint64 registrationEnd;
        uint64 commitEnd;
        uint64 revealEnd;
        uint64 courseEnd;
        bytes32 seed;
        address[] winners;
        address[] waitingList;
        mapping(address => Participant) participants;
        address[] participantList;
    }

    Lottery private lottery;


    constructor(
        bytes32 merkleRoot_,
        uint256 deposit_,
        uint256 refundPercentage_,
        uint256 availablePlaces_,
        uint256 registrationMinutes_,
        uint256 commitMinutes_,
        uint256 revealMinutes_,
        uint256 courseMinutes_
    ) { 
        lottery.owner = msg.sender;
        if (merkleRoot_ == bytes32(0)) revert EmptyMerkleRoot();
        lottery.merkleRoot = merkleRoot_;
        lottery.deposit = deposit_;
        if (refundPercentage_ > 100) revert InvalidRefundPercentage();
        lottery.refundPercentage = refundPercentage_;
        if (availablePlaces_ == 0) revert NoPlaces();
        lottery.availablePlaces = availablePlaces_;
        if (registrationMinutes_ == 0 || commitMinutes_ == 0 || revealMinutes_ == 0) revert WrongTimeline();
        lottery.registrationEnd = uint64(block.timestamp + registrationMinutes_ * 1 minutes);
        lottery.commitEnd = lottery.registrationEnd + uint64(commitMinutes_ * 1 minutes);
        lottery.revealEnd = lottery.commitEnd + uint64(revealMinutes_ * 1 minutes);
        lottery.courseEnd = lottery.revealEnd + uint64(courseMinutes_ * 1 minutes);
    }

    // Updating the merkle root if a new student registers and wants to participate
    function updateMerkleTree(bytes32 newRoot) external inPhase(Phase.Registration) {
        if (msg.sender != lottery.owner) revert NotOwner();
        if (newRoot == bytes32(0)) revert EmptyMerkleRoot();
        emit UpdateMerkleTree(lottery.merkleRoot, newRoot);
        lottery.merkleRoot = newRoot;
    }

    // Check current phase of the lottery
    function currentPhase() public view returns (Phase) {
        if (lottery.phase >= Phase.Drawn) return lottery.phase;
        if (block.timestamp < lottery.registrationEnd) return Phase.Registration;
        if (block.timestamp < lottery.commitEnd) return Phase.Commit;
        if (block.timestamp < lottery.revealEnd) return Phase.Reveal;
        return Phase.ReadyToDraw;
    } 

    // Check current phase
    modifier inPhase(Phase expectedPhase) {
        if (currentPhase() != expectedPhase) revert WrongPhase();
        _;
    }

    function register(bytes32[] calldata proof) external payable inPhase(Phase.Registration){
        // if (block.timestamp > lottery.registrationEnd) revert RegistrationClosed(); 
        Participant storage p = lottery.participants[msg.sender];
        if (p.registered) revert AlreadyRegistered();
        if (msg.value != lottery.deposit) revert WrongAmount();

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender))));
        if (!MerkleProof.verify(proof, lottery.merkleRoot, leaf)) revert NotEligible();

        p.depositRefunded = false;
        p.registered = true;
        p.listIndex = lottery.participantList.length;
        lottery.participantList.push(msg.sender);
        lottery.moneyDeposited += msg.value;

        emit Registered(msg.sender);
    }

    // Take registration back before the end of the registration phase and get 100% refunded.
    function unregister() external inPhase(Phase.Registration) {
        _unregister(msg.sender);
    }

    // Private unregister function of the external unregister and claimDeposit function
    function _unregister(address who) private {
        // require(block.timestamp < lottery.registrationEnd, "Registration closed. Can't unregistrate.");
        Participant storage p = lottery.participants[who];
        if (!p.registered) revert NotRegistered();
        
        // Erasing participant from participant list and replacing his spot with the last person.
        uint256 pIndex = p.listIndex;
        address last = lottery.participantList[lottery.participantList.length - 1];
        lottery.participantList[pIndex] = last;
        lottery.participants[last].listIndex = pIndex;
        lottery.participantList.pop();
        
        refundDeposit(who, lottery.deposit);

        emit Unregistered(who);
    }

    // Take registration back before the end of the registration phase and get 100% refunded.
    function refundAfterPlaceGranted() external inPhase(Phase.Drawn) {
        Participant storage p = lottery.participants[msg.sender];
        if (!p.won) revert NotWinner();
        
        // Erasing participant from winners list and replacing his spot with first on the waiting list.
        uint256 pWinnersIndex = p.winnersIndex;
        // Check if there is someone on the waitinglist
        address firstWaiter = nextWaiter();
        if (firstWaiter != address(0)) {
            lottery.winners[pWinnersIndex] = firstWaiter;
            lottery.participants[firstWaiter].won = true;
            lottery.participants[firstWaiter].winnersIndex = pWinnersIndex;
            lottery.participants[firstWaiter].waiting = false;

        } else {
            address lastIndex = lottery.winners[lottery.winners.length - 1];
            lottery.participants[lastIndex].winnersIndex = pWinnersIndex;
            lottery.winners[pWinnersIndex] = lastIndex;
            lottery.winners.pop();
        }
        lottery.participants[msg.sender].won = false;
        lottery.participants[msg.sender].registered = false;
        uint256 refund = lottery.deposit * lottery.refundPercentage / 100;
        lottery.forfeitedPool += (lottery.deposit-refund);

        refundDeposit(msg.sender, refund);

        emit PlaceDeclined(msg.sender);
    }

    // Leaving the waiting list and getting the full amount back
    function leaveWaitingList() external inPhase(Phase.Drawn) {
        Participant storage p = lottery.participants[msg.sender];
        if (!p.waiting) revert NotOnWaitingList();    
        p.waiting = false;

        refundDeposit(msg.sender, lottery.deposit);

        emit LeftWaitingList(msg.sender);
    }


    function claimDeposit() external {
        Participant storage p = lottery.participants[msg.sender];
        if (!p.registered) revert NotRegistered();
        if (p.won) revert UseRefundAfterPlaceGranted();
        if (p.waiting && currentPhase() == Phase.Drawn) revert UseLeaveWaitingList();
        if (p.depositRefunded) revert AlreadyRefunded();

        refundDeposit(msg.sender, lottery.deposit);
    }


    // Looking for the next address in the waiting list and ignoring participants who already left.
    // Could be costly if many participants leave but in this situation it should be feasible.
    function nextWaiter() private returns (address) {
        while (lottery.nextWaiting < lottery.waitingList.length) {
            address candidate = lottery.waitingList[lottery.nextWaiting];
            lottery.nextWaiting++;
            if (lottery.participants[candidate].waiting) {
                return candidate;
            }
        }
        return address(0); 
    }

    // Refunding deposit to the corresponding address
    function refundDeposit(address receivingAddress, uint256 amount) private {
        Participant storage p = lottery.participants[receivingAddress];
        if (p.depositRefunded) revert AlreadyRefunded();
        p.depositRefunded = true;
        p.registered = false;
        lottery.moneyDeposited -= amount;
        
        (bool ok, ) = payable(receivingAddress).call{value: amount}("");
        if (!ok) revert RefundFailed();
    }

    // As an inspiration:
    // https://github.com/cifunibas/Smart-Contracts-DeFi/blob/main/contracts/sealedBidAuctionB.sol
    function commit(bytes32 commitHash) external inPhase(Phase.Commit) {
        Participant storage p = lottery.participants[msg.sender];
        if (!p.registered) revert NotRegistered();
        if (p.commitHash != bytes32(0)) revert AlreadyCommitted();
        if (commitHash == bytes32(0)) revert EmptyHash();

        p.commitHash = commitHash;

        emit Committed (msg.sender);
    }

    // https://github.com/cifunibas/Smart-Contracts-DeFi/blob/main/contracts/sealedBidAuctionB.sol
    function generateCommitHash(address _who, uint _number, string memory _secret) public pure returns (bytes32 sealedHash) {
        sealedHash = keccak256(abi.encodePacked(_who, _number, _secret));
    }

    // Not everyone has to reveal
    function reveal(uint256 number, string  memory secret) public inPhase(Phase.Reveal){
        Participant storage p = lottery.participants[msg.sender];
        if (!p.registered) revert NotRegistered();
        if (p.commitHash == bytes32(0) ) revert EmptyHash();
        if (p.revealed) revert AlreadyRevealed();
        if (p.commitHash != generateCommitHash(msg.sender, number, secret)) revert WrongInputs();
        p.revealed = true;
        // to prevent that someone could bring the seed to the limit with type(uint256).max
        // like the OpenSSH issue
        lottery.seed = keccak256(abi.encode(lottery.seed, number));
        emit Revealed(msg.sender);
    }

    function draw() external inPhase(Phase.ReadyToDraw){
        drawWinnersShuffleArray();
        lottery.phase = Phase.Drawn;
        emit Drawn(lottery.seed);
    }

    /*
    Fisher-Yates-Shuffle
    https://ethereum.stackexchange.com/questions/129364/randomly-shuffling-a-mapping-in-solidity
    */
    function drawWinnersShuffleArray() private {
        address[] memory pool = lottery.participantList;

        uint256 remaining = pool.length;
        uint256 maxPicks = lottery.availablePlaces * 2; // Waiting list will be as long as the winners list
        uint256 picks = remaining < maxPicks ? remaining : maxPicks; // min(remaining, maxPicks)
        
        // https://speedrunethereum.com/guides/blockchain-randomness-solidity
        bytes32 seedAddOn = keccak256(abi.encode(block.prevrandao, blockhash(block.number - 1)));
        lottery.seed = keccak256(abi.encode(lottery.seed, seedAddOn));
        emit Drawn(lottery.seed);
        for (uint256 i; i < picks; i++) {
            // Pick a remaining element
            uint256 randId = uint256(keccak256(abi.encode(lottery.seed, i))) % remaining; 
            address picked = pool[randId];

            remaining--;
            pool[randId] = pool[remaining];

            Participant storage p = lottery.participants[picked];
            if (i < lottery.availablePlaces) { // If is there is space for a winner
                p.won = true;
                p.winnersIndex = lottery.winners.length;
                lottery.winners.push(picked);
                emit Winner(picked);
            } else { // waitings list
                p.waiting = true;
                p.waitingIndex = lottery.waitingList.length;
                lottery.waitingList.push(picked);
                emit Waiter(picked);
            }
        }
    }

    
    // Anyone can close the lottery after the course has ended
    function finalize() external inPhase(Phase.Drawn) {
        if (block.timestamp < lottery.courseEnd) revert WrongPhase();
        lottery.phase = Phase.Finished;
        if (lottery.winners.length > 0) {
            lottery.payOutToWinners = lottery.deposit + lottery.forfeitedPool / lottery.winners.length;
        }
    }


    function refundWinnersAfterDeadline() external inPhase(Phase.Finished){
        Participant storage p = lottery.participants[msg.sender];
        if (!p.won) revert NotWinner();
        if (p.depositRefunded) revert AlreadyRefunded();
        refundDeposit(msg.sender, lottery.payOutToWinners);    
    }

    
    function getRefundPercantage() external view returns (uint256) {
        return lottery.refundPercentage;
    }

    function getDepositToPay() external view returns (uint256) {
        return lottery.deposit;
    }

    function getAvailablePlaces() external view returns (uint256) {
        return lottery.availablePlaces;
    }

    // Overview of the participant list
    function getParticipants() external view returns (address[] memory) {
      return lottery.participantList;
    }

    // Overview of the winner list
    function getWinners() external view returns (address[] memory) {
      return lottery.winners;
    }

    // Overview of the waiting list
    function getWaitingList() external view returns (address[] memory) {
      return lottery.waitingList;
    }

    // Check if a selected participant has won
    function checkIfWon(address participant) external view returns (bool) {
        if(currentPhase() < Phase.Drawn) revert NotDrawnYet();
        return lottery.participants[participant].won;
    }

    // Check if a selected participant is on the waiting list
    function checkIfWaitingList(address participant) external view returns (bool) {
        if(currentPhase() < Phase.Drawn) revert NotDrawnYet();
        return lottery.participants[participant].waiting;
    }

    function getSeed() external view returns (bytes32) {
        return lottery.seed;
    }

    function getDeadlines() external view returns (uint64, uint64, uint64, uint256) {
        return (lottery.registrationEnd, lottery.commitEnd, lottery.revealEnd, lottery.courseEnd);
    }    
}
