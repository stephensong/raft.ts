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

export const ClusterNameErr = new Error("raft.ts: Cluster name can not be empty");
export const ClusterSizeErr = new Error("raft.ts: Cluster size can not be 0");
export const HandlerReqErr = new Error("raft.ts: Handler is required");
export const RpcDriverReqErr = new Error("raft.ts: RPCDriver is required");
export const LogReqErr = new Error("raft.ts: Log is required");
export const LogNoExistErr = new Error("raft.ts: Log file does not exist");
export const LogNoStateErr = new Error("raft.ts: Log file does not have any state");
export const LogCorruptErr = new Error("raft.ts: Encountered corrupt log file");
export const NotImplErr = new Error("raft.ts: Not implemented");
