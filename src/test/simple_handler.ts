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

import { IHandler } from "../node";
import { State, stateAsString } from "../state";

// SimpleHandler implements the IHandler interface by
// always granting a vote and just printing out the election results.
export class SimpleHandler implements IHandler {

    // CurrentState returns nil for default behavior.
    public currentState(): State | undefined {
        return;
    }

    // GrantVote always returns true for default behavior.
    public grantVote(position: number): boolean {
        return true;
    }

    public asyncError(error: Error): void {
        // tslint:disable-next-line: no-console
        console.error(error);
    }
    public stateChange(from: State, to: State): void {
        // tslint:disable-next-line: no-console
        console.info(`Change state from [${stateAsString(from)}] to [${stateAsString(to)}]`);
    }

}
