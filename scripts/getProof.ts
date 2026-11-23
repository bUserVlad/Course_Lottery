import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import fs from "fs";

// Address for which the proof is needed
const ADDRESS = "0xbb1268C9602a883c176dDBFF7cCD374875a88022";

const tree = StandardMerkleTree.load(JSON.parse(fs.readFileSync("scripts/tree.json", "utf8")));
const proof = tree.getProof([ADDRESS]);

console.log("Root: ", tree.root);
console.log("Proof:", JSON.stringify(proof));