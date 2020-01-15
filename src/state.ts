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

export type State = number;

// Allowable states for a raft.ts node.
export const FOLLOWER: State = 1;
export const LEADER: State = 2;
export const CANDIDATE: State = 3;

// Convenience for printing, etc.
export function stateAsString(s: State): string {
    switch (s) {
        case FOLLOWER:
            return "Follower";
        case LEADER:
            return "Leader";
        case CANDIDATE:
            return "Candidate";
        default:
            return `Unknown[${s}]`;
    }
}
