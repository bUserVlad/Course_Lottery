import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import fs from "fs";

// Eligble Address to take part of the course registration
const values = [
  ["0xCEbe026bF6307D817AD6527A9e91c37024C467E0"],
  ["0xE26c6B5243c764775C73CF2a41720dB01Db54F22"],
  ["0xbb1268C9602a883c176dDBFF7cCD374875a88022"]
];

// (2)
const tree = StandardMerkleTree.of(values, ["address"]);

// (3)
console.log('Merkle Root:', tree.root);

// Deployment of the tree
fs.writeFileSync("scripts/tree.json", JSON.stringify(tree.dump()));