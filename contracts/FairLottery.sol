// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.34;

contract FairLottery {
    
    enum Phase {Registration, Commit, Reveal, Drawn, Finished }

    struct Participant {
        bool registrated;
        bytes32 commitHash;
        bool revealed;
    }

    struct Lottery {
        Phase phase;
        bytes32 merkleRoot; 
        uint256 deposit;
        uint256 availablePlaces;
        uint64 registrationEnd;
        uint64 commitEnd;
        uint64 revealEnd;
        bytes32 seed;
        address[] winners;
        mapping(address => Participant) participants;
    }

    Lottery private lottery;

}
