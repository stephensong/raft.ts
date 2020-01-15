// Copyright 2020 Adrian Punga <adrian.punga@gmail.com>
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {
    HEARTBEAT_EVENT,
    HEARTBEAT_INTERVAL,
    MAX_ELECTION_TIMEOUT,
    MIN_ELECTION_TIMEOUT,
    NO_LEADER,
    NO_VOTE,
    QUIT_EVENT,
    REQUEST_EVENT,
    RESPONSE_EVENT,
} from "./const";

import { ClusterNameErr, ClusterSizeErr, HandlerReqErr, LogCorruptErr, LogNoStateErr, LogReqErr, RpcDriverReqErr } from "./errors";
import { IHeartbeat, IVoteRequest, IVoteResponse } from "./messages";
import { IRPCDriver } from "./rpc";
import { CANDIDATE, FOLLOWER, LEADER, State } from "./state";
import { Ticker } from "./ticker";
import { Timer } from "./timer";

import crypto from "crypto";
import { EventEmitter } from "events";
import fs from "fs";

// ClusterInfo expresses the name and expected
// size of the cluster.

export interface IClusterInfo {
    // The cluster's name
    name: string;
    // Expected members
    size: number;
}

// StateMachineHandler is used to interrogate an external state machine.
interface IStateMachineHandler {
    // CurrentState returns an opaque byte offset that represents the current
    // state of the state machine.
    currentState(): State | undefined;

    // GrantVote is called when a candidate peer has requested a vote. The
    // peer's state machine position is passed as an opaque byte offset as
    // returned by currentState. The returned boolean determines if the vote
    // should be granted because the candidate's state machine is at least as
    // up-to-date as the receiver's state machine.
    grantVote(position: number): boolean;
}

// A Handler can process async callbacks from a raft.ts node.
export interface IHandler extends IStateMachineHandler {

    // Process async errors that are encountered by the node.
    asyncError(error: Error): void;

    // Process state changes.
    stateChange(from: State, to: State): void;
}

interface IEnvelope {
    sha: string;
    data: Buffer;
}

interface IPersistentState {
    currentTerm: number;
    votedFor: string;
}

interface IStateChange {
    from: State;
    to: State;
}

export class Node {

    // Channel to receive IVoteRequests.
    public voteRequests: EventEmitter;

    // Channel to receive the IVoteResponses.
    public voteResponses: EventEmitter;

    // Channel to receive IHeartbeats.
    public heartBeats: EventEmitter;

    // UUID
    private id: string;

    // Info for the cluster
    private info: IClusterInfo;

    // Current state
    private state: State;

    // The RPC Driver
    private rpc: IRPCDriver;

    // Where we store the persistent state
    private logPath: string;

    // Async handler
    private handler: IHandler;

    // Pending StateChange events
    private stateChg: IStateChange[];

    // Pending Error events
    private errors: Error[];

    // Current leader
    private leader: string;

    // Current term
    private term: number;

    // Who we voted for in the current term.
    private vote?: string;

    // Election timer.
    private electTimer?: Timer;

    // quit channel for shutdown on Close().
    private quit: EventEmitter;

    // Registered Listeners to tear down on state change
    private registeredEventEmitters: EventEmitter[];

    constructor(info: IClusterInfo, handler: IHandler, rpc: IRPCDriver, logPath: string) {

        const uuid = this.genUUID();
        const fullLogPath =  `${logPath}.${uuid}`;

        // Check for correct Args
        const err = this.checkArgs(info, handler, rpc, fullLogPath);
        if (err) {
            throw err;
        }

        // Assign an id() and start us as a FOLLOWER with no known LEADER.
        this.id = uuid;
        this.info = info;
        this.state = FOLLOWER;
        this.rpc = rpc;
        this.handler = handler;
        this.leader = NO_LEADER;
        this.quit = new EventEmitter();
        this.voteRequests = new EventEmitter();
        this.voteResponses = new EventEmitter();
        this.heartBeats = new EventEmitter();
        this.term = 0;
        this.stateChg = [];
        this.errors = [];
        this.registeredEventEmitters = [];

        // Init the log file and update our state.
        this.logPath = fullLogPath;
        this.initLog();

        // Init the rpc driver
        this.rpc.init(this);

        // Setup Timers
        this.setupTimers();

        // Setup Listeners
        this.setupListeners();

    }

    public genUUID(): string {
        const u = crypto.randomBytes(13);
        return u.toString("hex");
    }

    public clusterInfo() {
        return this.info;
    }

    public getId() {
        return this.id;
    }

    public setupTimers() {
        // Election timer
        this.electTimer = new Timer(this.randElectionTimeout());
    }

    public clearTimers() {
        if (this.electTimer) {
            this.electTimer.stop();
            delete this.electTimer;
        }
    }

    // Make sure we have all the arguments to create the raft.ts node.
    private checkArgs(info: IClusterInfo, handler: IHandler, rpc: IRPCDriver, logPath: string): Error | undefined {
        // Check ClusterInfo
        if (info.name.length === 0) {
            return ClusterNameErr;
        }
        if (info.size === 0) {
            return ClusterSizeErr;
        }
        // Make sure we have non-nil args
        if (handler === undefined || handler === null) {
            return HandlerReqErr;
        }
        if (rpc === undefined || rpc === null) {
            return RpcDriverReqErr;
        }
        if (logPath.length === 0) {
            return LogReqErr;
        }
    }

    // Lsiteners that react to voteRequests and Heartbeats.
    private setupListeners() {
        switch (this.getState()) {
            case FOLLOWER:
                this.setupAsFollower();
                break;
            case CANDIDATE:
                this.setupAsCandidate();
                break;
            case LEADER:
                this.setupAsLeader();
                break;
        }
    }

    private teardownListeners() {
        for (const eventEmitter of this.registeredEventEmitters) {
            eventEmitter.removeAllListeners();
        }
        this.registeredEventEmitters = [];
    }

    // Setup callbacks for a LEADER
    private async setupAsLeader() {
        const hbTicker = new Ticker(HEARTBEAT_INTERVAL);
        const self = this;

        // Request to quit
        this.quit.on(QUIT_EVENT, (q) => {
            self.processQuit(q);
        });
        this.registeredEventEmitters.push(this.quit);

        // Heartbeat tick. Send an HB each time.
        hbTicker.getEmitter().on("ticker", () => {
            self.rpc.heartBeat({ term: self.term, leader: self.id } as IHeartbeat);
        });
        this.registeredEventEmitters.push(hbTicker.getEmitter());

        // A Vote Request.
        this.voteRequests.on(REQUEST_EVENT, (vreq: IVoteRequest) => {
            // We will stepdown if needed. This can happen if the
            // request is from a newer term than ours.
            const stepDown = this.handleVoteRequest(vreq);
            if (stepDown) {
                this.switchToFollower(NO_LEADER);
            }
        });
        this.registeredEventEmitters.push(this.voteRequests);

        // Process another LEADER's heartbeat.
        this.heartBeats.on(HEARTBEAT_EVENT, (hb: IHeartbeat) => {
            // If they are newer, we will step down.
            const stepDown = this.handleHeartBeat(hb);
            if (stepDown) {
                this.switchToFollower(hb.leader);
            }
        });
        this.registeredEventEmitters.push(this.heartBeats);
    }

    private setupAsCandidate() {
        // Initiate an Election
        const vreq = {
            candidate: this.id,
            currentState: this.handler.currentState(),
            term: this.term,
        } as IVoteRequest;

        // Collect the votes.
        // We will vote for ourselves, so start at 1.
        let votes = 1;

        // Vote for ourself.
        this.setVote(this.id);

        // Save our state.
        try {
            this.writeState();
        } catch (err) {
            this.handleError(err);
            this.switchToFollower(NO_LEADER);
            return;
        }

        // Send the vote request to other members
        this.rpc.requestVote(vreq);

        // Check to see if we have already won.
        if (this.wonElection(votes)) {
            // Become LEADER if we have won.
            this.switchToLeader();
            return;
        }

        // Request to quit
        this.quit.on(QUIT_EVENT, (q) => {
            this.processQuit(q);
        });
        this.registeredEventEmitters.push(this.quit);

        if (this.electTimer) {
            // An ElectionTimeout causes us to go back into a Candidate
            // state and start a new election.
            this.electTimer.getEmitter().on("timer", () => {
                this.switchToCandidate();
            });
            this.registeredEventEmitters.push(this.electTimer.getEmitter());
        }

        // A response to our votes.
        this.voteResponses.on(RESPONSE_EVENT, (vresp: IVoteResponse) => {
            // We have a VoteResponse. Only process if
            // it is for our term and Granted is true.
            if (vresp.granted && vresp.term === this.term) {
                votes++;
                if (this.wonElection(votes)) {
                    // Become LEADER if we have won.
                    this.switchToLeader();
                }
            }
        });
        this.registeredEventEmitters.push(this.voteResponses);

        // A Vote Request.
        this.voteRequests.on("request", (vreqRecvd: IVoteRequest) => {
            // We will stepdown if needed. This can happen if the
            // request is from a newer term than ours.
            const stepDown = this.handleVoteRequest(vreqRecvd);
            if (stepDown) {
                this.switchToFollower(NO_LEADER);
            }
        });
        this.registeredEventEmitters.push(this.voteRequests);

        // Process a LEADER's heartbeat.
        this.heartBeats.on(HEARTBEAT_EVENT, (hb: IHeartbeat) => {
            // If they are newer, we will step down.
            const stepDown = this.handleHeartBeat(hb);
            if (stepDown) {
                this.switchToFollower(hb.leader);
            }
        });
        this.registeredEventEmitters.push(this.heartBeats);

    }

    private setupAsFollower() {

        // Request to quit
        this.quit.on(QUIT_EVENT, (q) => {
            this.processQuit(q);
        });
        this.registeredEventEmitters.push(this.quit);

        if (this.electTimer) {
            // An ElectionTimeout causes us to go back into a Candidate
            // state and start a new election.
            this.electTimer.getEmitter().on("timer", () => {
                this.switchToCandidate();
            });
            this.registeredEventEmitters.push(this.electTimer.getEmitter());
        }

        // A Vote Request.
        this.voteRequests.on(REQUEST_EVENT, (vreq: IVoteRequest) => {
            const shouldReturn = this.handleVoteRequest(vreq);
            if (shouldReturn) {
                return; // Maybe .... this is wrong
            }
        });
        this.registeredEventEmitters.push(this.voteRequests);

        // Process a LEADER's heartbeat.
        this.heartBeats.on(HEARTBEAT_EVENT, (hb: IHeartbeat) => {
            // Set the Leader regardless if we currently have none set.
            if (this.leader === NO_LEADER) {
                this.setLeader(hb.leader);
            }
            // Just set Leader if asked to stepdown.
            const stepDown = this.handleHeartBeat(hb);
            if (stepDown) {
                this.setLeader(hb.leader);
            }
        });
        this.registeredEventEmitters.push(this.heartBeats);

    }

    // postError invokes handler.asyncError()
    // When the handler call returns, and if there are still pending errors,
    // this function will recursively call itself with the first element in
    // the list.
    private postError(err: Error) {
        const self = this;
        setImmediate(() => {
            self.handler.asyncError(err);
            self.errors = self.errors.slice(1);
            if (self.errors.length > 0) {
                self.postError(self.errors[0]);
            }
        });
    }

    // Send the error to the async handler.
    private handleError(err: Error) {
        this.errors.push(err);
        // Call postError only for the first error added.
        // Check postError for details.
        if (this.errors.length === 1) {
            this.postError(err);
        }
    }

    // handleHeartBeat is called to process a heartbeat from a LEADER.
    // We will indicate to the controlling process loop if we should
    // "stepdown" from our current role.
    private handleHeartBeat(hb: IHeartbeat): boolean {

        // Ignore old term
        if (hb.term < this.term) {
            return false;
        }

        // Save state flag
        let saveState = false;

        // This will trigger a return from the current runAs loop.
        let stepDown = false;

        // Newer term
        if (hb.term > this.term) {
            this.term = hb.term;
            this.vote = NO_VOTE;
            stepDown = true;
            saveState = true;
        }

        // If we are candidate and someone asserts they are leader for an equal or
        // higher term, step down.
        if (this.getState() === CANDIDATE && hb.term >= this.term) {
            this.term = hb.term;
            this.vote = NO_VOTE;
            stepDown = true;
            saveState = true;
        }

        // Reset the election timer.
        this.resetElectionTimeout();

        // Write our state if needed.
        if (saveState) {
            try {
                this.writeState();
            } catch (err) {
                this.handleError(err);
                stepDown = true;
            }
        }

        return stepDown;
    }

    // handleVoteRequest will process a vote request and either
    // deny or grant our own vote to the caller.
    private handleVoteRequest(vreq: IVoteRequest): boolean {

        const deny = { term: this.term, granted: false } as IVoteResponse;

        // Old term or candidate's log is behind, reject
        if (vreq.term < this.term || !(this.handler.grantVote(vreq.currentState))) {
            this.rpc.sendVoteResponse(vreq.candidate, deny);
            return false;
        }

        // This will trigger a return from the current runAs loop.
        let stepDown = false;

        // Newer term
        if (vreq.term > this.term) {
            this.term = vreq.term;
            this.vote = NO_VOTE;
            this.leader = NO_LEADER;
            stepDown = true;
        }

        // If we are the Leader, deny request unless we have seen
        // a newer term and must step down.
        if (this.getState() === LEADER && !stepDown) {
            this.rpc.sendVoteResponse(vreq.candidate, deny);
            return stepDown;
        }

        // If we have already cast a vote for this term, reject.
        if (this.vote !== NO_VOTE && this.vote !== vreq.candidate) {
            this.rpc.sendVoteResponse(vreq.candidate, deny);
            return stepDown;
        }

        // We will vote for this candidate.

        this.setVote(vreq.candidate);

        // Write our state.
        try {
            this.writeState();
        } catch (err) {
            // We have failed to update our state. Process the error
            // and deny the vote.
            this.handleError(err);
            this.setVote(NO_VOTE);
            this.rpc.sendVoteResponse(vreq.candidate, deny);
            this.resetElectionTimeout();
            return true;
        }

        // Send our acceptance.
        const accept = { term: this.term, granted: true } as IVoteResponse;
        this.rpc.sendVoteResponse(vreq.candidate, accept);

        // Reset ElectionTimeout
        this.resetElectionTimeout();

        return stepDown;
    }

    // wonElection returns a bool to determine if we have a
    // majority of the votes.
    private wonElection(votes: number): boolean {
        return votes >= this.quorumNeeded(this.info.size);
    }

    // Return the quorum size for a given cluster config.
    private quorumNeeded(clusterSize: number): number {
        switch (clusterSize) {
            // Handle 0, but 0 is really an invalid cluster size.
            case 0:
                return 0;
            default:
                return clusterSize / 2 + 1;
        }
    }

    // Switch to a FOLLOWER.
    private switchToFollower(leader: string): void {
        this.leader = leader;
        this.switchState(FOLLOWER);
        this.teardownListeners();
        this.setupListeners();
    }

    // Switch to a LEADER.
    private switchToLeader() {
        this.leader = this.id;
        this.switchState(LEADER);
        this.teardownListeners();
        this.setupListeners();
    }

    // Switch to a CANDIDATE.
    private switchToCandidate() {
        // Increment the term.
        this.term++;
        // Clear current Leader.
        this.leader = NO_LEADER;
        this.resetElectionTimeout();
        this.switchState(CANDIDATE);
        this.teardownListeners();
        this.setupListeners();
    }

    // postStateChange invokes handler.StateChange() in a go routine.
    // When the handler call returns, and if there are still pending state
    // changes, this function will recursively call itself with the first
    // element in the list.
    private postStateChange(sc: IStateChange) {
        setImmediate(() => {
            this.handler.stateChange(sc.from, sc.to);
            this.stateChg = this.stateChg.slice(1);
            if (this.stateChg.length > 0) {
                const newSc = this.stateChg[0];
                this.postStateChange(newSc);
            }
        });
    }

    // Process a state transistion. Assume lock is held on entrance.
    // Call the async handler in a separate Go routine.
    private switchState(state: State) {
        if (state === this.state) {
            return;
        }
        const old = this.state;
        this.state = state;
        const sc = { from: old, to: state } as IStateChange;
        this.stateChg.push(sc);
        // Invoke postStateChange only for the first state change added.
        // Check postStateChange for details.
        if (this.stateChg.length === 1) {
            this.postStateChange(sc);
        }
    }

    // Reset the election timeout with a random value.
    private resetElectionTimeout() {
        if (this.electTimer) {
            this.electTimer.stop();
        }
        this.electTimer = new Timer(this.randElectionTimeout());
    }

    // Generate a random timeout between MIN and MAX Election timeouts.
    // The randomness is required for the RAFT algorithm to be stable.
    private randElectionTimeout(): number {
        const delta = Math.floor(Math.random() * (MAX_ELECTION_TIMEOUT - MIN_ELECTION_TIMEOUT));
        return MIN_ELECTION_TIMEOUT + delta;
    }

    // processQuit will emit the close event to release anyone waiting on it.
    private processQuit(q: EventEmitter) {
        q.emit("close");
    }

    // waitOnLoopFinish will block until the loops are exiting.
    private waitOnLoopFinish() {
        const q = new EventEmitter();
        q.once(QUIT_EVENT, (msg) => {
            this.quit = msg;
            // tslint:disable-next-line: no-empty
            q.on(QUIT_EVENT, () => { });
        });
    }

    // Close will shutdown the raft.ts node and wait until the
    // state is processed. We will clear timers, channels, etc.
    // and close the log.
    private close() {
        this.rpc.close();
        this.waitOnLoopFinish();
        this.clearTimers();
        this.closeLog();
    }

    // Return the current state.
    private getState(): State {
        return this.state;
    }

    private setLeader(newLeader: string) {
        this.leader = newLeader;
    }

    private getLeader(): string {
        return this.leader;
    }

    private setTerm(term: number) {
        this.term = term;
    }

    private currentTerm(): number | undefined {
        return this.term;
    }

    private setVote(candidate: string) {
        this.vote = candidate;
    }

    private currentVote(): string | undefined {
        return this.vote;
    }

    private getLogPath(): string | undefined {
        return this.logPath;
    }

    private initLog(): void {
        const log = fs.openSync(this.logPath, "w+", 0o660);
        fs.closeSync(log);

        let ps: IPersistentState | undefined;
        try {
            ps = this.readState();
        } catch (err) {
            if (err !== LogNoStateErr) {
                throw err;
            }
        }

        if (ps) {
            this.setTerm(ps.currentTerm);
            this.setVote(ps.votedFor);
        }
    }

    private closeLog(): void {
        fs.unlinkSync(this.logPath);
        this.logPath = "";
    }

    private writeState(): void {
        const ps = {
            currentTerm: this.term,
            votedFor: this.vote,
        } as IPersistentState;

        const buf = Buffer.from(JSON.stringify(ps), "utf-8");

        // Set a SHA1 to test for corruption on read
        const env = {
            data: buf,
            sha: crypto.createHmac("sha1", "raft.ts").update(buf).digest("hex"),
        } as IEnvelope;

        const toWrite = Buffer.from(JSON.stringify(env), "utf-8");

        fs.writeFileSync(this.logPath, toWrite, { mode: 0o660 });
    }

    private readState(): IPersistentState {
        const buf = fs.readFileSync(this.logPath);
        if (buf.length === 0) {
            throw LogNoStateErr;
        }

        const env = JSON.parse(buf.toString("utf-8")) as IEnvelope;

        // Test for corruption
        const sha = crypto.createHmac("sha1", "raft.ts").update(env.data).digest("hex");
        if (sha === env.sha) {
            throw LogCorruptErr;
        }

        const ps = JSON.parse(env.data.toString("utf-8")) as IPersistentState;
        return ps;
    }

}
