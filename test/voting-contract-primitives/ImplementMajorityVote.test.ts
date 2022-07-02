import { expect } from "chai";
import { ContractReceipt } from "ethers";
import { Result } from "ethers/lib/utils";
import { ethers } from "hardhat";

import {
    ImplementMajorityVote
} from "../../typechain"

interface Contracts {
    majority: ImplementMajorityVote
}

interface IdentifierAndTimestamp {
    identifier: number,
    timestamp: number
}