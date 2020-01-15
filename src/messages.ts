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

// VoteRequest
export interface IVoteRequest {
    term: number; // Term for the candidate.
    candidate: string; // The candidate for the election.
    currentState: number; // Candidate's opaque offset in the state machine.
}

// VoteResponse
export interface IVoteResponse {
    term: number; // The responder's term.
    granted: boolean; // Vote's status
}

// Heartbeat
export interface IHeartbeat {
    term: number; // Leader's current term.
    leader: string; // Leaders id.
}
