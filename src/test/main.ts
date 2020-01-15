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

import { Client, connect } from "ts-nats";
import { Nats } from "../drivers/nats";
import { IClusterInfo, Node } from "../node";
import { SimpleHandler } from "./simple_handler";

async function connectToNATS() {
    let nc: Client;
    try {
        nc = await connect({
            servers: ["nats://127.0.0.1:4222"],
        });
    } catch (e) {
        // tslint:disable-next-line: no-console
        console.error(e);
        process.exit(1);
    }
    // tslint:disable-next-line: no-console
    console.info("Test connected to NATS");
    return nc;
}

async function main() {
    try {
        const nc = await connectToNATS();
        const nats = new Nats(nc);
        const handler = new SimpleHandler();
        const node = new Node({name: "cronos", size: 3} as IClusterInfo, handler, nats, "/tmp/raft.log");
    } catch (err) {
        throw err;
    }
}

main()
    .then()
    // tslint:disable-next-line: no-console
    .catch(console.error);
