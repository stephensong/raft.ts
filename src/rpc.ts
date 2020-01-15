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

import { IHeartbeat, IVoteRequest, IVoteResponse } from "./messages";
import { Node } from "./node";

export interface IRPCDriver {
    // Used to initialize the driver
    init(node: Node): void;
    // Used to close down any state
    close(): void;
    // Used to respond to VoteResponses to candidates
    sendVoteResponse(candidate: string, voteResponse: IVoteResponse): void;
    // Used by Candidate Nodes to issue a new vote for a leader.
    requestVote(voteRequest: IVoteRequest): void;
    // Used by Leader Nodes to Heartbeat
    heartBeat(heartbeat: IHeartbeat): void;
}
