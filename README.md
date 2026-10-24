# Course Lottery for the Univerity

*Problem:* In courses with limited capacity, such as Media Studies, places are often given to those who are physically present first in the opening week. Students with a preceding lecture are disadvantaged, and the allocation cannot be verified by anyone. At the same time, many students register for every course with limited places and later do not show up, which makes the shortage worse. The same problem appears in UniSport courses, which are booked out within minutes, a disadvantage for those who are not available when registration opens.
Why a smart contract: A central allocation system run by the university could also hold a lottery, but its fairness would have to be trusted. A smart contract makes the rules public and the outcome verifiable: no lecturer, administrator or single participant can influence or change the result afterwards. Trust is replaced by verifiability.


## Project Overview

**Design:**
*Eligibility:* Students link their wallet address to their identity via the university login. The university publishes a Merkle root of eligible addresses, so only admitted students can register. Places are bound to the registered address and cannot be transferred, so friends cannot reserve places for others.
Registration deposit: Each registration requires a deposit of about CHF 20, low enough for all students to participate. This discourages registering for every course.
*Randomness:* Participants commit to a secret value at registration and reveal it after the registration period. The combined values determine the random ranking, so no single party controls the outcome. Not revealing leads to the loss of the deposit.
*Allocation:* The ranking assigns the available places and creates a waiting list. As a parameter, a share of the places can be allocated by registration order, which allows a comparison between a pure lottery and first come, first served.
Acceptance and replacement: Selected students must accept their place within a deadline. Otherwise, anyone can trigger the next person on the waiting list to move up.
*Refund rules:*
Not selected, or withdrawal before the deadline: full refund
Withdrawal within about two weeks after receiving a place: half refund
Accepting a place and not attending: deposit forfeited
Redistribution: Forfeited deposits are distributed to the admitted participants, since their deposits are returned later than those of others. Each participant claims their share individually.

*Limitations:* Eligibility still depends on the university, and attendance cannot be observed on-chain directly. It requires either an active acceptance step or a public absence report by the lecturer. These trust assumptions will be stated openly.


## Sources:
https://github.com/OpenZeppelin/merkle-tree