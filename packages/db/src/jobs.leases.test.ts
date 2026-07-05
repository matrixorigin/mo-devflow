import { beforeEach, describe, expect, test, vi } from "vitest";
import { claimNextDueJob, completeLeasedJob } from "./jobs";

const mocks = vi.hoisted(() => ({
  execute: vi.fn()
}));

vi.mock("./client", () => ({
  getPool: () => ({
    execute: mocks.execute
  }),
  nowSql: () => "2026-07-06 03:30:00",
  sqlDate: (value: string | Date | null | undefined) => {
    if (!value) {
      return null;
    }
    if (value instanceof Date) {
      return "2026-07-06 03:31:00";
    }
    return value.replace("T", " ").replace(".000Z", "");
  },
  fromSqlDate: (value: unknown) => (value ? `${String(value).replace(" ", "T")}Z` : null)
}));

describe("job leases", () => {
  beforeEach(() => {
    mocks.execute.mockReset();
  });

  test("continues through claim candidates when another worker wins the first race", async () => {
    mocks.execute
      .mockResolvedValueOnce([[{ id: 1 }, { id: 2 }]])
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([
        [
          {
            id: 2,
            job_key: "matrixone:rules",
            job_type: "rules",
            attempts: 3,
            payload_json: "{}",
            lease_owner: "worker-a",
            lease_expires_at: "2026-07-06 03:31:00"
          }
        ]
      ]);

    const job = await claimNextDueJob({ leaseOwner: "worker-a", leaseSeconds: 60 });

    expect(job?.id).toBe(2);
    expect(mocks.execute).toHaveBeenCalledTimes(4);
    expect(String(mocks.execute.mock.calls[0]?.[0])).toContain("LIMIT 8");
    expect(String(mocks.execute.mock.calls[1]?.[0])).toContain("WHERE id = ?");
    expect(String(mocks.execute.mock.calls[2]?.[0])).toContain("WHERE id = ?");
  });

  test("requires a still-running unexpired lease before completing a job", async () => {
    mocks.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

    await completeLeasedJob({
      jobId: 7,
      leaseOwner: "worker-a",
      nextRunAt: "2026-07-06T04:30:00.000Z",
      payload: { ok: true }
    });

    const [sql, params] = mocks.execute.mock.calls[0] ?? [];
    expect(String(sql)).toContain("AND status = 'running'");
    expect(String(sql)).toContain("AND lease_owner = ?");
    expect(String(sql)).toContain("AND lease_expires_at >= ?");
    expect(params).toEqual([
      JSON.stringify({ ok: true }),
      "2026-07-06 04:30:00",
      "2026-07-06 03:30:00",
      7,
      "worker-a",
      "2026-07-06 03:30:00"
    ]);
  });
});
