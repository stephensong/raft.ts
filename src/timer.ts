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

import { EventEmitter } from "events";

export class Timer {
    private eventEmitter: EventEmitter;
    private timeout: NodeJS.Timeout;
    constructor(private timerMilliseconds: number) {
        const eventEmitter = this.eventEmitter = new EventEmitter();
        this.timeout = setInterval(() => {
            eventEmitter.emit("timer");
        }, this.timerMilliseconds);
    }
    public getEmitter() {
        return this.eventEmitter;
    }
    public stop() {
        clearTimeout(this.timeout);
        delete this.timeout;
    }
}
