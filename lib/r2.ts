// Dunne lees-laag voor de S3-compatibele objectopslag (R2). Server-side; leest de
// door de ingestie voorberekende bestanden (bv. het arrows-pijlenveld). Generieke
// STORAGE_*-env, net als de Python-kant. Alleen lezen — schrijven doet de ingestie.
import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

function env(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set (see .env.example / repo-secrets).`);
  return v;
}

let client: S3Client | null = null;
function s3(): S3Client {
  if (!client)
    client = new S3Client({
      region: "auto", // 'auto' werkt voor R2, onschadelijk voor andere S3-backends
      endpoint: env("STORAGE_ENDPOINT"),
      credentials: {
        accessKeyId: env("STORAGE_ACCESS_KEY_ID"),
        secretAccessKey: env("STORAGE_SECRET_ACCESS_KEY"),
      },
    });
  return client;
}

export async function listKeys(prefix: string): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  do {
    const r = await s3().send(new ListObjectsV2Command({
      Bucket: env("STORAGE_BUCKET"), Prefix: prefix, ContinuationToken: token,
    }));
    for (const o of r.Contents ?? []) if (o.Key) out.push(o.Key);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}

export async function getText(key: string): Promise<string> {
  const r = await s3().send(new GetObjectCommand({ Bucket: env("STORAGE_BUCKET"), Key: key }));
  return r.Body!.transformToString();
}
