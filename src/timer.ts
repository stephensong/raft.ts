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
import { TIMER_EVENT } from "./const";

export class Timer {
    private eventEmitter: EventEmitter;
    private timeout?: NodeJS.Timeout;
    constructor(private timerMilliseconds: number) {
        this.eventEmitter = new EventEmitter();
        this.reset(timerMilliseconds);
    }
    public getEmitter() {
        return this.eventEmitter;
    }
    public reset(timerMilliseconds: number) {
        const eventEmitter = this.eventEmitter;
        if (this.timeout) {
            clearTimeout(this.timeout);
        }
        this.timeout = setInterval(() => {
            eventEmitter.emit(TIMER_EVENT);
        }, this.timerMilliseconds);
    }
    public stop() {
        if (this.timeout) {
            clearTimeout(this.timeout);
        }
        delete this.timeout;
    }
}
