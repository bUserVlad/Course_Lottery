// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.34;

contract FairLottery {
    
    // Errors
    error RegistrationClosed();
    error AlreadyRegistered();
    error WrongAmount();
    error WrongPhase();

    // Phases each lottery can have
    enum Phase {Registration, Commit, Reveal, Drawn, Finished}

    event Registered(address indexed participant);


    // Variables for the participants
    struct Participant {
        bool registered;
        bytes32 commitHash;
        bool revealed;
        bool depositRefunded;
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

    function register() external payable inPhase(Phase.Registration){
        // if (block.timestamp > lottery.registrationEnd) revert RegistrationClosed(); 
        if (lottery.participants[msg.sender].registered) revert AlreadyRegistered();
        if (msg.value != lottery.deposit) revert WrongAmount();
        lottery.participants[msg.sender].registered = true;
        lottery.participantList.push(msg.sender);
        lottery.moneyDeposited += msg.value;

        emit Registered(msg.sender);
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
