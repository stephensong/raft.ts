import { Client, Subscription, SubscriptionOptions } from "ts-nats";
import { HEARTBEAT_EVENT, REQUEST_EVENT, RESPONSE_EVENT } from "../const";
import { IHeartbeat, IVoteRequest, IVoteResponse } from "../messages";
import { Node } from "../node";
import { IRPCDriver } from "../rpc";

const MY_NAME = "raft_ts";
const HEARTBEAT_SUB = "heartbeat";
const VOTE_REQ_SUB = "vote_request";
const VOTE_RESP_SUB = "vote_response";

export class Nats implements IRPCDriver {

    // Heartbeat subscription.
    private hbSub?: Subscription;

    // Vote request subscription.
    private vreqSub?: Subscription;

    // Vote response subscription.
    private vrespSub?: Subscription;

    // Graft node.
    private node?: Node;

    constructor(private natsClient: Client) {
    }

    public init(node: Node): void {

        this.node = node;
        const self = this;

        // Create the heartbeat subscription.
        const hbSubName = this.hbSubject();
        if (hbSubName) {
            this.natsClient.subscribe(hbSubName, (err, msg) => {
                if (err) {
                    // tslint:disable-next-line: no-console
                    console.error(err);
                }
                const hb = JSON.parse(msg.data) as IVoteRequest;
                node.heartBeats.emit(HEARTBEAT_EVENT, hb);
            }).then((value: Subscription) => {
                self.hbSub = value;
            }).catch((err) => {
                // tslint:disable-next-line: no-console
                console.error(err);
            });
        }

        // Create the voteRequest subscription.
        const vreqSubject = this.vreqSubject();
        if (vreqSubject) {
            this.natsClient.subscribe(vreqSubject, (err, msg) => {
                if (err) {
                    // tslint:disable-next-line: no-console
                    console.error(err);
                }
                const vreq = JSON.parse(msg.data) as IVoteRequest;
                // Don't respond to our own request.
                if (vreq.candidate !== node.getId()) {
                    node.voteRequests.emit(REQUEST_EVENT, vreq);
                }
            }).then((value: Subscription) => {
                self.vreqSub = value;
            }).catch((err) => {
                // tslint:disable-next-line: no-console
                console.error(err);
            });
        }

    }

    public close(): void {
        if (this.hbSub) {
            this.hbSub.unsubscribe();
            delete this.hbSub;
        }
        if (this.vreqSub) {
            this.vreqSub.unsubscribe();
            delete this.vreqSub;
        }
        if (this.vrespSub) {
            this.vrespSub.unsubscribe();
            delete this.vrespSub;
        }
        if (this.natsClient) {
            this.natsClient.close();
        }
    }

    public sendVoteResponse(candidate: string, voteResponse: IVoteResponse): void {
        const vrespSubName = this.vrespSubject(candidate);
        if (vrespSubName) {
            // tslint:disable-next-line: no-console
            // console.log(`sendVoteResponse => ${vrespSubName} = [${JSON.stringify(voteResponse)}]`);
            this.natsClient.publish(vrespSubName, JSON.stringify(voteResponse));
        }
    }

    public requestVote(voteRequest: IVoteRequest): void {
        if (!this.node) {
            return;
        }
        const self = this;
        const node = this.node;
        // Create a new response subscription for each outstanding
        // RequestVote and cancel the previous.
        if (this.vrespSub) {
            this.vrespSub.unsubscribe();
            delete this.vrespSub;
        }
        const inbox = this.vrespSubject(this.node.getId());
        // If we can auto-unsubscribe to max number of expected responses
        // which will be the cluster size.
        const size = node.clusterInfo().size;
        const subscriptionOptions = {} as SubscriptionOptions;
        if (size > 0) {
            subscriptionOptions.max = size;
        }
        this.natsClient.subscribe(inbox, (err, msg) => {
            if (err) {
                // tslint:disable-next-line: no-console
                console.error(err);
            }
            const vresp = JSON.parse(msg.data) as IVoteResponse;
            node.voteResponses.emit(RESPONSE_EVENT, vresp);
        }, subscriptionOptions).then((value: Subscription) => {
            // hold to cancel later.
            self.vrespSub = value;
            // Fire off the request.
            const vreqSubName = self.vreqSubject();
            if (vreqSubName) {
                // tslint:disable-next-line: no-console
                // console.log(`requestVote => ${vreqSubName} = [${JSON.stringify(voteRequest)}]`);
                self.natsClient.publish(vreqSubName, JSON.stringify(voteRequest), inbox);
            }
        }).catch((err) => {
            // tslint:disable-next-line: no-console
            console.error(err);
        });
    }

    public heartBeat(heartbeat: IHeartbeat): void {
        const hbSubName = this.hbSubject();
        if (hbSubName) {
            // tslint:disable-next-line: no-console
            // console.log(`heartBeat => ${hbSubName} = [${JSON.stringify(heartbeat)}]`);
            this.natsClient.publish(hbSubName, JSON.stringify(heartbeat));
        }
    }

    // Convenience funstion for generating the vote request subject.
    private hbSubject(): string | undefined {
        if (this.node) {
            return `${MY_NAME}.${this.node.clusterInfo().name}.${HEARTBEAT_SUB}`;
        }
    }

    // Convenience function for generating the directed response
    // subject for vote requests. We will use the candidate's id
    // to form a directed response
    private vrespSubject(candidate: string): string {
        return `${MY_NAME}.${candidate}.${VOTE_RESP_SUB}`;
    }

    // Convenience funstion for generating the vote request subject.
    private vreqSubject(): string | undefined {
        if (this.node) {
            return `${MY_NAME}.${this.node.clusterInfo().name}.${VOTE_REQ_SUB}`;
        }
    }

}
