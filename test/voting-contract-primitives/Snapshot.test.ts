import { expect } from "chai";
import { ContractReceipt } from "ethers";
import { Result } from "ethers/lib/utils";
import { ethers } from "hardhat";

import {
    Snapshot
} from "../../typechain"

interface Contracts {
    snapshot: Snapshot
}

interface IdentifierAndTimestamp {
    identifier: number,
    timestamp: number
}

const abi = ethers.utils.defaultAbiCoder 

let VotingStatus = {
    "inactive": 0,
    "completed": 1,
    "failed": 2,
    "active": 3
}
let APPROVE = abi.encode(["bool"],[true])
let DISAPPROVE = abi.encode(["bool"],[false])

async function deploySnapshot(): Promise<Contracts> {
    let SnapshotFactory = await ethers.getContractFactory("Snapshot")
    let snapshot: Snapshot = await SnapshotFactory.deploy()
    await snapshot.deployed()
    return {
        snapshot
    }
}

async function startVotingInstance(snapshot: Snapshot): Promise<IdentifierAndTimestamp> {
    let tx = await snapshot.start("0x", "0x");
    let identifier: number = getEventArgs(await tx.wait())[0].toNumber()
    let timestamp = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
    return {
        identifier,
        timestamp
    }
}



function getEventArgs(receipt: ContractReceipt): Result {
    if (receipt.events !== undefined) {
        if (receipt.events[0].args !==undefined) {
            return receipt.events[0].args
        }
        throw("Args are undefined!")
    }
    throw("Events are undefined!")
}



describe("Snapshot", function(){
    it("should deploy", async ()=> {
        let contracts: Contracts =  await deploySnapshot();
        expect(await contracts.snapshot.VOTING_DURATION()).to.equal(ethers.BigNumber.from("432000"))
    });
    it("should start a new voting instance", async ()=> {
        let contracts: Contracts =  await deploySnapshot();
        let [Alice] = await ethers.getSigners()
        let firstIdentifier: number = 0;
        await expect(contracts.snapshot.connect(Alice).start("0x", "0x"))
            .to.emit(contracts.snapshot,'VotingInstanceStarted')
            .withArgs(firstIdentifier, Alice.address)
        let currentStatus = (await contracts.snapshot.getStatus(firstIdentifier)).toNumber()
        expect(currentStatus).to.equal(VotingStatus.active)

    });
    it("Should vote in favor of the motion and retrieve result", async function(){
        let contracts: Contracts =  await deploySnapshot();
        let instanceInfo: IdentifierAndTimestamp = await startVotingInstance(contracts.snapshot)
        let encodedVote = abi.encode(["bool"],[true])
        await contracts.snapshot.vote(instanceInfo.identifier, encodedVote)
        expect(await contracts.snapshot.result(instanceInfo.identifier))
            .to.equal(abi.encode(["int256"],[1]))

    });
    it("should revert on double voting attempt", async function(){

        let [Alice] = await ethers.getSigners()
        let contracts: Contracts =  await deploySnapshot();
        let instanceInfo: IdentifierAndTimestamp = await startVotingInstance(contracts.snapshot)
        await contracts.snapshot.connect(Alice).vote(instanceInfo.identifier, APPROVE)
        await expect(contracts.snapshot.connect(Alice).vote(instanceInfo.identifier, APPROVE))
            .to.be
            .revertedWith(`'AlreadyVoted(${instanceInfo.identifier}, "${Alice.address}")'`);
    });
    it("post-deadline-status after triggering 'conclude' should be *completed* for a non-zero result.", async()=>{
        let contracts: Contracts =  await deploySnapshot();
        let instanceInfo: IdentifierAndTimestamp = await startVotingInstance(contracts.snapshot)
        await contracts.snapshot.vote(instanceInfo.identifier, APPROVE)
        await ethers.provider.send(
            'evm_setNextBlockTimestamp',
            [instanceInfo.timestamp + (await contracts.snapshot.VOTING_DURATION()).toNumber() + 1]); 
        let beforeStatus = (await contracts.snapshot.getStatus(instanceInfo.identifier)).toNumber()
        expect(beforeStatus).to.equal(VotingStatus.active)
        await contracts.snapshot.conclude(instanceInfo.identifier);
        let afterStatus = (await contracts.snapshot.getStatus(instanceInfo.identifier)).toNumber()
        expect(afterStatus).to.equal(VotingStatus.completed)
    });
    it("post-deadline-status after triggering another vote should be *completed* for a non-zero result.", async()=>{
        let [Alice, Bob] = await ethers.getSigners()
        let contracts: Contracts =  await deploySnapshot();
        let instanceInfo: IdentifierAndTimestamp = await startVotingInstance(contracts.snapshot)
        await contracts.snapshot.connect(Alice).vote(instanceInfo.identifier, APPROVE)
        await ethers.provider.send(
            'evm_setNextBlockTimestamp',
            [instanceInfo.timestamp + (await contracts.snapshot.VOTING_DURATION()).toNumber() + 1]); 
        let beforeStatus = (await contracts.snapshot.getStatus(instanceInfo.identifier)).toNumber()
        expect(beforeStatus).to.equal(VotingStatus.active)
        await contracts.snapshot.connect(Bob).vote(instanceInfo.identifier, APPROVE)
        let afterStatus = (await contracts.snapshot.getStatus(instanceInfo.identifier)).toNumber()
        expect(afterStatus).to.equal(VotingStatus.completed)
    });
    it("post-deadline-status after triggering 'conclude' should become *failed* for a zero-result.", async ()=> {
        let [Alice, Bob] = await ethers.getSigners()
        let contracts: Contracts =  await deploySnapshot();
        let instanceInfo: IdentifierAndTimestamp = await startVotingInstance(contracts.snapshot)
        await contracts.snapshot.connect(Alice).vote(instanceInfo.identifier, APPROVE)
        await contracts.snapshot.connect(Bob).vote(instanceInfo.identifier, DISAPPROVE)
        await ethers.provider.send('evm_setNextBlockTimestamp',
            [instanceInfo.timestamp + (await contracts.snapshot.VOTING_DURATION()).toNumber() + 1]);

        expect((await contracts.snapshot.getStatus(instanceInfo.identifier)).toNumber())
            .to.equal(VotingStatus.active)
        await contracts.snapshot.conclude(instanceInfo.identifier);
        expect((await contracts.snapshot.getStatus(instanceInfo.identifier)).toNumber())
            .to.equal(VotingStatus.failed)
    });
    it("should not allow voting after the deadline has passed.", async ()=>{
        let [Alice, Bob] = await ethers.getSigners()
        let contracts: Contracts =  await deploySnapshot();
        let instanceInfo: IdentifierAndTimestamp = await startVotingInstance(contracts.snapshot)
        let deadline = instanceInfo.timestamp + (await contracts.snapshot.VOTING_DURATION()).toNumber()
        await contracts.snapshot.connect(Alice).vote(instanceInfo.identifier, APPROVE);
        await ethers.provider.send('evm_setNextBlockTimestamp',
            [deadline + 1]);
        await contracts.snapshot.conclude(instanceInfo.identifier);
        await expect(contracts.snapshot.connect(Bob).vote(instanceInfo.identifier, APPROVE))
            .to.be.
            revertedWith(`'StatusError(${instanceInfo.identifier}, ${VotingStatus.completed})'`);
    });
    it("should revert a 'conclude'-call when status is not active.", async ()=>{
        let [Alice, Bob] = await ethers.getSigners()
        let contracts: Contracts =  await deploySnapshot();
        let instanceInfo: IdentifierAndTimestamp = await startVotingInstance(contracts.snapshot)
        let deadline = instanceInfo.timestamp + (await contracts.snapshot.VOTING_DURATION()).toNumber()
        await contracts.snapshot.connect(Alice).vote(instanceInfo.identifier, APPROVE);
        await ethers.provider.send('evm_setNextBlockTimestamp',
            [deadline + 1]);
        await contracts.snapshot.connect(Alice).vote(instanceInfo.identifier, APPROVE);
        expect((await contracts.snapshot.getStatus(instanceInfo.identifier)).toNumber())
            .to.not.equal(VotingStatus.active)
        await expect(contracts.snapshot.connect(Alice).conclude(instanceInfo.identifier))
            .to.be.
            revertedWith(`'StatusError(${instanceInfo.identifier}, ${VotingStatus.completed})'`)
        
    });
    it("should revert a 'conclude'-call when status is active and the deadline has not passed.",async()=>{
        let [Alice, Bob] = await ethers.getSigners()
        let contracts: Contracts =  await deploySnapshot();
        let instanceInfo: IdentifierAndTimestamp = await startVotingInstance(contracts.snapshot)
        let deadline = instanceInfo.timestamp + (await contracts.snapshot.VOTING_DURATION()).toNumber()
        await expect(contracts.snapshot.connect(Alice).conclude(instanceInfo.identifier))
            .to.be.
            revertedWith(`'DeadlineHasNotPassed(${instanceInfo.identifier}, ${deadline})'`)

    });
    
});