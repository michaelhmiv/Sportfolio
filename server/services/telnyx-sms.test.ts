import { afterEach, describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { verifyTelnyxWebhookSignature } from "./telnyx-sms";

const ORIGINAL_PUBLIC_KEY = process.env.TELNYX_PUBLIC_KEY;

afterEach(() => {
  if (ORIGINAL_PUBLIC_KEY === undefined) {
    delete process.env.TELNYX_PUBLIC_KEY;
  } else {
    process.env.TELNYX_PUBLIC_KEY = ORIGINAL_PUBLIC_KEY;
  }
});

describe("telnyx-sms", () => {
  it("accepts a valid Telnyx Ed25519 signature", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    process.env.TELNYX_PUBLIC_KEY = publicKey.export({
      type: "spki",
      format: "pem",
    }) as string;

    const rawBody = Buffer.from(JSON.stringify({ data: { event_type: "message.received" } }));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = Buffer.concat([Buffer.from(timestamp), Buffer.from("|"), rawBody]);
    const signature = sign(null, payload, privateKey).toString("base64");

    const result = verifyTelnyxWebhookSignature({
      headers: {
        "telnyx-signature-ed25519": signature,
        "telnyx-timestamp": timestamp,
      },
      rawBody,
    });

    expect(result).toBe(true);
  });

  it("accepts the raw base64 public key format that Telnyx commonly provides", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const spkiDer = publicKey.export({
      type: "spki",
      format: "der",
    }) as Buffer;
    process.env.TELNYX_PUBLIC_KEY = spkiDer.subarray(spkiDer.length - 32).toString("base64");

    const rawBody = Buffer.from(JSON.stringify({ data: { event_type: "message.received" } }));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = Buffer.concat([Buffer.from(timestamp), Buffer.from("|"), rawBody]);
    const signature = sign(null, payload, privateKey).toString("base64");

    const result = verifyTelnyxWebhookSignature({
      headers: {
        "telnyx-signature-ed25519": signature,
        "telnyx-timestamp": timestamp,
      },
      rawBody,
    });

    expect(result).toBe(true);
  });

  it("rejects an invalid Telnyx signature", () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    process.env.TELNYX_PUBLIC_KEY = publicKey.export({
      type: "spki",
      format: "pem",
    }) as string;

    const result = verifyTelnyxWebhookSignature({
      headers: {
        "telnyx-signature-ed25519": "not-a-real-signature",
        "telnyx-timestamp": String(Math.floor(Date.now() / 1000)),
      },
      rawBody: Buffer.from("{}"),
    });

    expect(result).toBe(false);
  });

  it("rejects a stale timestamp even when a signature is otherwise well-formed", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    process.env.TELNYX_PUBLIC_KEY = publicKey.export({
      type: "spki",
      format: "pem",
    }) as string;

    const rawBody = Buffer.from(JSON.stringify({ data: { event_type: "message.received" } }));
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 601);
    const payload = Buffer.concat([Buffer.from(staleTimestamp), Buffer.from("|"), rawBody]);
    const signature = sign(null, payload, privateKey).toString("base64");

    const result = verifyTelnyxWebhookSignature({
      headers: {
        "telnyx-signature-ed25519": signature,
        "telnyx-timestamp": staleTimestamp,
      },
      rawBody,
    });

    expect(result).toBe(false);
  });
});
