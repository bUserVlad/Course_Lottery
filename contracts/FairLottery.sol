// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.34;

contract FairLottery {
    
    // Phases each lottery can have
    enum Phase {Registration, DeadlinePassed, Drawn, DecisionEnd, Finished}

    // Variables for the participants
    struct Participant {
        bool registrated;
        bytes32 commitHash;
        bool revealed;
    }

    // All variables that a lottery needs for a course participation
    struct Lottery {
        Phase phase;
        address owner;
        bytes32 merkleRoot; 
        uint256 deposit;
        uint256 availablePlaces;
        uint64 registrationEnd;
        uint64 commitEnd;
        uint64 revealEnd;
        bytes32 seed;
        address[] winners;
        address[] waitingList;
        mapping(address => Participant) participants;
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

    // https://github.com/0xHuzaifa/Simple-Lottery/blob/main/Lottery.sol
    // Generating random numbers unsave version
    /*
    function random() private view returns(uint) {
        return uint(keccak256( abi.encodePacked (
            block.prevrandao, block.timestamp, lottery.participants.length)));
    }
    */

    
}
