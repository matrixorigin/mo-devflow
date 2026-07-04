import { describe, expect, it } from "vitest";
import { getDbConfig } from "./client";

describe("database client configuration", () => {
  it("uses bounded defaults for MatrixOne connection behavior", () => {
    expect(getDbConfig({})).toMatchObject({
      host: "127.0.0.1",
      port: 6001,
      user: "root",
      password: "",
      database: "mo_devflow",
      connectTimeoutMs: 3_000,
      connectionLimit: 10
    });
  });

  it("maps explicit connection timeout and pool size overrides", () => {
    expect(
      getDbConfig({
        MO_DEVFLOW_DB_HOST: "matrixone.internal",
        MO_DEVFLOW_DB_PORT: "16001",
        MO_DEVFLOW_DB_USER: "devflow",
        MO_DEVFLOW_DB_PASSWORD: "secret",
        MO_DEVFLOW_DB_NAME: "devflow_prod",
        MO_DEVFLOW_DB_CONNECT_TIMEOUT_MS: "750",
        MO_DEVFLOW_DB_CONNECTION_LIMIT: "4"
      })
    ).toMatchObject({
      host: "matrixone.internal",
      port: 16001,
      user: "devflow",
      password: "secret",
      database: "devflow_prod",
      connectTimeoutMs: 750,
      connectionLimit: 4
    });
  });

  it("falls back when numeric values are invalid or unsafe", () => {
    expect(
      getDbConfig({
        MO_DEVFLOW_DB_PORT: "not-a-port",
        MO_DEVFLOW_DB_CONNECT_TIMEOUT_MS: "10",
        MO_DEVFLOW_DB_CONNECTION_LIMIT: "0"
      })
    ).toMatchObject({
      port: 6001,
      connectTimeoutMs: 3_000,
      connectionLimit: 10
    });
  });
});
