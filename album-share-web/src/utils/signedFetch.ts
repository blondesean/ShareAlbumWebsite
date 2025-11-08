import { SignatureV4 } from "@aws-sdk/signature-v4";
import { Sha256 } from "@aws-crypto/sha256-js";
import { HttpRequest } from "@aws-sdk/protocol-http";

const signer = new SignatureV4({
    credentials: {
        accessKeyId: import.meta.env.VITE_AWS_ACCESS_KEY_ID!,
        secretAccessKey: import.meta.env.VITE_AWS_SECRET_ACCESS_KEY!,
    },
    region: import.meta.env.VITE_AWS_REGION!,
    service: "execute-api",
    sha256: Sha256,
});

export async function signedFetch(url: string) {
    const request = new HttpRequest({
        method: "GET",
        headers: { host: new URL(url).host },
        hostname: new URL(url).host,
        protocol: "https:",
        path: new URL(url).pathname + new URL(url).search,
    });

    const signed = await signer.sign(request);
    const res = await fetch(url, {
        method: "GET",
        headers: signed.headers as Record<string, string>,
    });

    return res;
}
