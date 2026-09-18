// 探活共享常量/类型：客户端（logins-board）与服务端（xiaobei-probe）共用。
// 本文件不得 import node 内建模块——会被打 进浏览器 bundle。

export const PROBE_PLATFORMS = ["douyin", "bilibili", "kuaishou", "xhs-browse"] as const;
export type ProbePlatform = (typeof PROBE_PLATFORMS)[number];

export type ProbeServerState = "valid" | "server-expired" | "probe-unavailable";

export type ProbeResult = {
  platform: string;
  serverState: ProbeServerState;
  reason: string | null;
  checkedAt: number;
};
