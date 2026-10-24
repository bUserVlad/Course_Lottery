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

    // Phases each lottery can have
    enum Phase {Registration, Commit, Reveal, Drawn, Finished}

    event Registered(address indexed participant);
    event Unregistered(address indexed participant);


    // Variables for the participants
    struct Participant {
        bool registered;
        bool won;
        bytes32 commitHash;
        bool revealed;
        bool depositRefunded;
        uint256 listIndex;
        uint256 winnersIndex;
    }

    // All variables that a lottery needs for a course participation
    struct Lottery {
        Phase phase;
        address owner;
        bytes32 merkleRoot; 
        uint256 deposit;
        uint256 refundPercentage;
        uint256 moneyDeposited;
        uint256 availablePlaces;
        uint64 registrationEnd;
        uint64 commitEnd;
        uint64 revealEnd;
        bytes32 seed;
        uint256 winnersRefunded;
        address[] winners;
        address[] waitingList;
        mapping(address => Participant) participants;
        address[] participantList;
    }

    Lottery private lottery;

    constructor(
        bytes32 merkleRoot_,
        uint256 deposit_,
        uint256 availablePlaces_,
        uint64 registrationEnd_,
        uint64 commitEnd_,
        uint64 revealEnd_
    ) {
        lottery.owner = msg.sender;
        lottery.merkleRoot = merkleRoot_;
        lottery.deposit = deposit_;
        lottery.availablePlaces = availablePlaces_;
        lottery.registrationEnd = registrationEnd_;
        lottery.commitEnd = commitEnd_;
        lottery.revealEnd = revealEnd_;
    }

    // Check current phase of the lottery
    function currentPhase() public view returns (Phase) {
        if (lottery.phase >= Phase.Drawn) return lottery.phase;
        if (block.timestamp < lottery.registrationEnd) return Phase.Registration;
        if (block.timestamp < lottery.commitEnd) return Phase.Commit;
        return Phase.Reveal;
    } 

    // Check current phase
    modifier inPhase(Phase expectedPhase) {
        if (currentPhase() != expectedPhase) revert WrongPhase();
        _;
    }

    function register(bytes32[] calldata proof) external payable inPhase(Phase.Registration){
        // if (block.timestamp > lottery.registrationEnd) revert RegistrationClosed(); 
        if (lottery.participants[msg.sender].registered) revert AlreadyRegistered();
        if (msg.value != lottery.deposit) revert WrongAmount();

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender))));
        if (!MerkleProof.verify(proof, lottery.merkleRoot, leaf)) revert NotEligible();

        lottery.participants[msg.sender].registered = true;
        lottery.participants[msg.sender].listIndex = lottery.participantList.length;
        lottery.participantList.push(msg.sender);
        lottery.moneyDeposited += msg.value;

        emit Registered(msg.sender);
    }

    // Take registration back before the end of the registration phase and get 100% refunded.
    function unregister() external payable inPhase(Phase.Registration) {
        // require(block.timestamp < lottery.registrationEnd, "Registration closed. Can't unregistrate.");
        Participant storage p = lottery.participants[msg.sender];
        if (!p.registered) revert NotRegistered();
        
        // Erasing participant from participant list and replacing his spot with the last person.
        uint256 pIndex = p.listIndex;
        address lastIndex = lottery.participantList[lottery.participantList.length - 1];
        lottery.participantList[pIndex] = lastIndex;
        lottery.participants[lastIndex].listIndex = pIndex;
        lottery.participantList.pop();
        lottery.participants[msg.sender].registered = false;
        lottery.moneyDeposited -= lottery.deposit;
        (bool ok, ) = payable(msg.sender).call{value: lottery.deposit}("");
        if (!ok) revert RefundFailed();
       }

        // TODO
        // Take registration back before the end of the registration phase and get 100% refunded.
        function refundAfterPlaceGranted() external payable inPhase(Phase.Drawn) {
        Participant storage p = lottery.participants[msg.sender];
        if (!p.won) revert NotRegistered();
        
        // Erasing participant from winners list and replacing his spot with first on the waiting list.
        uint256 pWinnersIndex = p.winnersIndex;
        if (lottery.waitingList.length - lottery.winnersRefunded > 0) {
            address firstWaiter = lottery.waitingList[lottery.winnersRefunded];
            lottery.winners[pWinnersIndex] = lottery.waitingList[lottery.winnersRefunded];
            lottery.participants[firstWaiter].won = true;
            lottery.participants[firstWaiter].winnersIndex = pWinnersIndex;
            lottery.winnersRefunded++;
        } else {
            address lastIndex = lottery.winners[lottery.winners.length - 1];
            lottery.participants[lastIndex].winnersIndex = pWinnersIndex;
            lottery.winners.pop();
        }
        lottery.participants[msg.sender].won = false;
        uint256 refund = lottery.deposit * lottery.refundPercentage;
        lottery.moneyDeposited -= refund;
        p.depositRefunded = true;
        (bool ok, ) = payable(msg.sender).call{value: refund}("");
        if (!ok) revert RefundFailed();
       }

    // https://github.com/0xHuzaifa/Simple-Lottery/blob/main/Lottery.sol
    // Generating random numbers unsave version
    /*
    function random() private view returns(uint) {
        return uint(keccak256( abi.encodePacked (
            block.prevrandao, block.timestamp, lottery.participants.length)));
    }
    */


    
}
