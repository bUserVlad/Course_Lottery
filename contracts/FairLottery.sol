// SPDX-License-Identifier: MIT

pragma solidity ^0.8.34;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract FairLottery {
    
    // Errors
    error AlreadyRegistered();
    error NotRegistered();
    error WrongAmount();
    error WrongPhase();
    error NotEligible();
    error RefundFailed();
    error NotOnWaitingList();
    error InvalidRefundPercentage();
    error NotDrawnYet();
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
    error NoCourseFee();
    error AlreadyWithdrawn();
    error NotRevealed();
    error UseRefundWinnersAfterDeadline();
    error CantRegisterAnymore();
    error LateRegistrationDisabled();


    // Phases each lottery can have
    enum Phase {Registration, Reveal, ReadyToDraw, Drawn, CourseStarted, Finished}

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
    event ClaimedDeposit(address indexed participant, uint256 amount);
    event WinnerRefunded(address indexed participant, uint256 amount);
    event Finalized(uint256 forfeitedPool, uint256 sharePerWinner);
    event CourseFeesWithdrawn(uint256 participant);
    event UndistributedAmountWithdawn(uint256 amount);

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
    address public immutable owner;
    uint256 public immutable deposit;
    uint256 public immutable refundPercentage;
    uint256 public immutable availablePlaces;
    uint64 public immutable registrationEnd;
    uint64 public immutable commitEnd;
    uint64 public immutable revealEnd;
    uint64 public immutable courseStart;
    uint64 public immutable courseEnd;
    
    Phase private phase;
    
    bytes32 public seed;
    bytes32 public merkleRoot; 
    uint256 public moneyDeposited;
    uint256 public forfeitedPoolPayOutToWinners;
    uint256 public forfeitedPool;
    uint256 public nextWaiting;

    bool public immutable everyoneCommits;
    bool public immutable theCourseCosts;
    bool public immutable lateRegistration;
    bool private feesWithdrawn;
    bool private undistributedWithdrawn;
    
    address[] private winners;
    address[] private waitingList;
    address[] private participantList;
    address[] private revealedList;
    mapping(address => Participant) private participants;

    // Putting constructor variable into a struct because stack got too deep 
    constructor (
        uint256 deposit_,
        uint256 refundPercentage_,
        uint256 availablePlaces_,
        bytes32 merkleRoot_,
        bool everyoneCommits_,
        bool theCourseCosts_,
        bool lateRegistration_,
        uint256 registrationMinutes_,
        uint256 revealMinutes_,
        uint256 withdrawMinutes_,
        uint256 courseDuration_
        ) {
        owner = msg.sender;
        if (merkleRoot_ == bytes32(0)) revert EmptyMerkleRoot();
        merkleRoot = merkleRoot_;
        deposit = deposit_;
        if (refundPercentage_ > 100) revert InvalidRefundPercentage();
        refundPercentage = refundPercentage_;
        if (availablePlaces_ == 0) revert NoPlaces();
        availablePlaces = availablePlaces_;
        everyoneCommits = everyoneCommits_;
        theCourseCosts = theCourseCosts_;
        lateRegistration = lateRegistration_;
        if (registrationMinutes_ == 0 || revealMinutes_ == 0 ||
            withdrawMinutes_ == 0 || courseDuration_ == 0) revert WrongTimeline();
        registrationEnd = uint64(block.timestamp + registrationMinutes_ * 1 minutes);
        // commitEnd = registrationEnd + uint64(commitMinutes * 1 minutes);
        revealEnd = registrationEnd + uint64(revealMinutes_ * 1 minutes);
        courseStart = revealEnd + uint64(withdrawMinutes_ * 1 minutes);
        courseEnd = courseStart + uint64(courseDuration_ * 1 minutes);
    }

    // Updating the merkle root if a new student registers and wants to participate
    function updateMerkleTree(bytes32 newRoot) external inPhase(Phase.Registration) {
        if (msg.sender != owner) revert NotOwner();
        if (newRoot == bytes32(0)) revert EmptyMerkleRoot();
        emit UpdateMerkleTree(merkleRoot, newRoot);
        merkleRoot = newRoot;
    }

    // Check current phase of the lottery
    function currentPhase() public view returns (Phase) {
        if (phase == Phase.Finished) return Phase.Finished;
        if (phase >= Phase.Drawn) {
            return block.timestamp < courseStart ? Phase.Drawn : Phase.CourseStarted;
        }
        if (block.timestamp < registrationEnd) return Phase.Registration;
        // if (block.timestamp < commitEnd) return Phase.Commit;
        if (block.timestamp < revealEnd) return Phase.Reveal;
        return Phase.ReadyToDraw;
    } 

    // Check current phase
    modifier inPhase(Phase expectedPhase) {
        if (currentPhase() != expectedPhase) revert WrongPhase();
        _;
    }

    function register(bytes32[] calldata proof) external payable inPhase(Phase.Registration){
        Participant storage p = participants[msg.sender];
        if (p.registered) revert AlreadyRegistered();
        if (msg.value != deposit) revert WrongAmount();

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender))));
        if (!MerkleProof.verify(proof, merkleRoot, leaf)) revert NotEligible();

        p.depositRefunded = false;
        p.registered = true;
        p.listIndex = participantList.length;
        participantList.push(msg.sender);
        moneyDeposited += msg.value;

        emit Registered(msg.sender);
    }

    // If available places are left after the draw because not enough people registered or
    // too many unregistered people can register late
    function lateRegister(bytes32[] calldata proof) external payable inPhase(Phase.Drawn){
        if (!lateRegistration) revert LateRegistrationDisabled();
        if (winners.length >= availablePlaces) revert CantRegisterAnymore();
        Participant storage p = participants[msg.sender];
        if (p.registered) revert AlreadyRegistered();
        if (msg.value != deposit) revert WrongAmount();

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender))));
        if (!MerkleProof.verify(proof, merkleRoot, leaf)) revert NotEligible();

        p.depositRefunded = false;
        p.registered = true;
        moneyDeposited += msg.value;
        
        p.won = true;
        p.winnersIndex = winners.length;
        winners.push(msg.sender);

        emit Registered(msg.sender);
        emit Winner(msg.sender);
    }

    // Take registration back before the end of the registration phase and get 100% refunded.
    function unregister() external inPhase(Phase.Registration) {
        _unregister(msg.sender);
    }

    // Private unregister function of the external unregister
    function _unregister(address who) private {
        Participant storage p = participants[who];
        if (!p.registered) revert NotRegistered();
        
        // Erasing participant from participant list and replacing his spot with the last person.
        uint256 pIndex = p.listIndex;
        address last = participantList[participantList.length - 1];
        participantList[pIndex] = last;
        participants[last].listIndex = pIndex;
        participantList.pop();
        
        refundDeposit(who, deposit);

        emit Unregistered(who);
    }

    // Take registration back after the end of the registration phase and get a percentage refunded.
    function refundAfterPlaceGranted() external inPhase(Phase.Drawn) {
        Participant storage p = participants[msg.sender];
        if (!p.won) revert NotWinner();
        
        // Erasing participant from winners list and replacing his spot with first on the waiting list.
        uint256 pWinnersIndex = p.winnersIndex;
        // Check if there is someone on the waitinglist
        address firstWaiter = nextWaiter();
        if (firstWaiter != address(0)) {
            winners[pWinnersIndex] = firstWaiter;
            participants[firstWaiter].won = true;
            participants[firstWaiter].winnersIndex = pWinnersIndex;
            participants[firstWaiter].waiting = false;

        } else {
            address lastIndex = winners[winners.length - 1];
            participants[lastIndex].winnersIndex = pWinnersIndex;
            winners[pWinnersIndex] = lastIndex;
            winners.pop();
        }
        participants[msg.sender].won = false;
        participants[msg.sender].registered = false;
        uint256 refund = deposit * refundPercentage / 100;
        forfeitedPool += (deposit-refund);

        refundDeposit(msg.sender, refund);

        emit PlaceDeclined(msg.sender);
    }

    // Leaving the waiting list and getting the full amount back
    function leaveWaitingList() external inPhase(Phase.Drawn) {
        Participant storage p = participants[msg.sender];
        if (!p.waiting) revert NotOnWaitingList();    
        p.waiting = false;

        refundDeposit(msg.sender, deposit);

        emit LeftWaitingList(msg.sender);
    }

    // Claim deposit if not won
    function claimDeposit() external {
        if (currentPhase() < Phase.Drawn) revert WrongPhase();
        Participant storage p = participants[msg.sender];
        if (!p.registered) revert NotRegistered();
        if (everyoneCommits && !p.revealed) revert NotRevealed();
        if (p.won) revert UseRefundWinnersAfterDeadline();
        if (p.waiting && currentPhase() == Phase.Drawn) revert UseLeaveWaitingList();
        if (p.depositRefunded) revert AlreadyRefunded();

        refundDeposit(msg.sender, deposit);

        emit ClaimedDeposit(msg.sender, deposit);
    }

    // Looking for the next address in the waiting list and ignoring participants who already left.
    // Could be costly if many participants leave but in this situation it should be feasible.
    function nextWaiter() private returns (address) {
        while (nextWaiting < waitingList.length) {
            address candidate = waitingList[nextWaiting];
            nextWaiting++;
            if (participants[candidate].waiting) {
                return candidate;
            }
        }
        return address(0); 
    }

    // Refunding deposit to the corresponding address
    function refundDeposit(address receivingAddress, uint256 amount) private {
        Participant storage p = participants[receivingAddress];
        if (p.depositRefunded) revert AlreadyRefunded();
        p.depositRefunded = true;
        p.registered = false;
        moneyDeposited -= amount;
        
        // Make sure to revert the statements above if deposit is not payable
        (bool ok, ) = payable(receivingAddress).call{value: amount}("");
        if (!ok) revert RefundFailed();
    }

    // As an inspiration:
    // https://github.com/cifunibas/Smart-Contracts-DeFi/blob/main/contracts/sealedBidAuctionB.sol
    function commit(bytes32 commitHash) external inPhase(Phase.Registration) {
        Participant storage p = participants[msg.sender];
        if (!p.registered) revert NotRegistered();
        if (p.commitHash != bytes32(0)) revert AlreadyCommitted();
        if (commitHash == bytes32(0)) revert EmptyHash();

        p.commitHash = commitHash;

        emit Committed (msg.sender);
    }

    // https://github.com/cifunibas/Smart-Contracts-DeFi/blob/main/contracts/sealedBidAuctionB.sol
    function generateCommitHash(uint _number, string memory _secret) public view returns (bytes32 sealedHash) {
        sealedHash = keccak256(abi.encodePacked(msg.sender, _number, _secret));
    }

    // Not everyone has to reveal
    function reveal(uint256 number, string  memory secret) public inPhase(Phase.Reveal){
        Participant storage p = participants[msg.sender];
        if (!p.registered) revert NotRegistered();
        if (p.commitHash == bytes32(0) ) revert EmptyHash();
        if (p.revealed) revert AlreadyRevealed();
        if (p.commitHash != generateCommitHash(number, secret)) revert WrongInputs();
        p.revealed = true;
        revealedList.push(msg.sender);

        // Hashing instead of adding: with seed + number, revealing type(uint256).max
        // would cause an overflow and make every later reveal revert
        seed = keccak256(abi.encode(seed, number));
        emit Revealed(msg.sender);
    }

    function draw() external inPhase(Phase.ReadyToDraw){
        drawWinnersShuffleArray();
        phase = Phase.Drawn;

        // Deposit of not revealed participants gets int othe forfeitedPool if everyone has to commit
        if (everyoneCommits) {
            forfeitedPool += (participantList.length - revealedList.length) * deposit;
        }

        emit Drawn(seed);
    }

    /*
    Fisher-Yates-Shuffle
    https://ethereum.stackexchange.com/questions/129364/randomly-shuffling-a-mapping-in-solidity
    */
    function drawWinnersShuffleArray() private {
        // If everyone has to commit, then we take the revealedList otherwise participantList
        address[] memory pool = everyoneCommits ? revealedList : participantList; 
        uint256 remaining = pool.length;
        uint256 maxPicks = availablePlaces * 2; // Waiting list will be as long as the winners list
        uint256 picks = remaining < maxPicks ? remaining : maxPicks; // min(remaining, maxPicks)
        
        // https://speedrunethereum.com/guides/blockchain-randomness-solidity
        bytes32 seedAddOn;
        if (!everyoneCommits) {
            seedAddOn = keccak256(abi.encode(block.prevrandao, blockhash(block.number - 1)));
            seed = keccak256(abi.encode(seed, seedAddOn));
        }

        for (uint256 i; i < picks; i++) {
            // Pick a remaining element
            uint256 randId = uint256(keccak256(abi.encode(seed, i))) % remaining; 
            address picked = pool[randId];

            remaining--;
            pool[randId] = pool[remaining];

            Participant storage p = participants[picked];
            if (i < availablePlaces) { // If is there is space for a winner
                p.won = true;
                p.winnersIndex = winners.length;
                winners.push(picked);
                emit Winner(picked);
            } else { // waitings list
                p.waiting = true;
                p.waitingIndex = waitingList.length;
                waitingList.push(picked);
                emit Waiter(picked);
            }
        }
    }

    
    // Anyone can close the after the course has started
    function finalize() external inPhase(Phase.CourseStarted) {
        if (block.timestamp < courseEnd) revert WrongPhase();
        phase = Phase.Finished;
        if (winners.length > 0) {
            forfeitedPoolPayOutToWinners = forfeitedPool / winners.length;
        }

        emit Finalized(forfeitedPool, forfeitedPoolPayOutToWinners);
    }

    // Refunding winner with the deposit and forfeited amount or only forfeited amout if the course costs
    function refundWinnersAfterDeadline() external inPhase(Phase.Finished){
        Participant storage p = participants[msg.sender];
        if (!p.won) revert NotWinner();
        if (p.depositRefunded) revert AlreadyRefunded();

        uint256 amount = theCourseCosts ? forfeitedPoolPayOutToWinners : forfeitedPoolPayOutToWinners + deposit;
        refundDeposit(msg.sender, amount);

        emit WinnerRefunded(msg.sender, amount);
    }

    // Paying the course owner the course cost
    function withdrawCourseFees() external inPhase(Phase.Finished) {
        if (msg.sender != owner) revert NotOwner();
        if (!theCourseCosts) revert NoCourseFee();
        if (feesWithdrawn) revert AlreadyWithdrawn();
        feesWithdrawn = true;

        // paying out the total course amount plus the remainder of the forfeitedPool
        uint256 amount = winners.length * deposit;
        moneyDeposited -= amount;

        (bool ok, ) = payable(owner).call{value: amount}("");
        if (!ok) revert RefundFailed();

        emit CourseFeesWithdrawn(amount);
    }

    // Paying the course owner the undistributed amout if everyone backs up
    function withdrawUndistributed() external inPhase(Phase.Finished) {
        if (msg.sender != owner) revert NotOwner();
        if (undistributedWithdrawn) revert AlreadyWithdrawn();
        undistributedWithdrawn = true;

        // paying out the total course amount plus the remainder of the forfeitedPool
        uint256 amount = forfeitedPool - forfeitedPoolPayOutToWinners * winners.length;
        moneyDeposited -= amount;

        (bool ok, ) = payable(owner).call{value: amount}("");
        if (!ok) revert RefundFailed();
        
        emit UndistributedAmountWithdawn(amount);
    }

    // Overview of the participant list
    function getParticipants() external view returns (address[] memory) {
      return participantList;
    }

    // Overview of the winner list
    function getWinners() external view returns (address[] memory) {
      return winners;
    }

    // Overview of the waiting list
    function getWaitingList() external view returns (address[] memory) {
      return waitingList;
    }

    // Check if a selected participant has won
    function checkIfWon(address participant) external view returns (bool) {
        if(currentPhase() < Phase.Drawn) revert NotDrawnYet();
        return participants[participant].won;
    }

    // Check if a selected participant is on the waiting list
    function checkIfWaitingList(address participant) external view returns (bool) {
        if(currentPhase() < Phase.Drawn) revert NotDrawnYet();
        return participants[participant].waiting;
    }

}
