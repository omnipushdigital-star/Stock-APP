// lib/r2.js — Cloudflare R2 storage (S3-compatible, replaces AWS S3)
// Falls back to local .r2-store/ folder when CF is not configured (local dev)

import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import * as XLSX from "xlsx";
import fs from "fs";
import path from "path";

const CF_CONFIGURED =
  process.env.CF_R2_ENDPOINT &&
  process.env.CF_R2_ACCESS_KEY_ID &&
  process.env.CF_R2_SECRET_ACCESS_KEY;

const LOCAL_R2_DIR = path.join(process.cwd(), ".r2-store");

function localPath(key) {
  const p = path.join(LOCAL_R2_DIR, key.replace(/\//g, "__"));
  fs.mkdirSync(LOCAL_R2_DIR, { recursive: true });
  return p;
}

// ─── R2 client (only when configured) ───────────────────────
let r2 = null;
if (CF_CONFIGURED) {
  r2 = new S3Client({
    region: "auto",
    endpoint: process.env.CF_R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.CF_R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY,
    },
  });
}

const BUCKET = process.env.CF_R2_BUCKET_NAME || "stock-atsl";

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// ─── JSON helpers ────────────────────────────────────────────

export async function getJSON(key) {
  if (!CF_CONFIGURED) {
    try { return JSON.parse(fs.readFileSync(localPath(key + ".json"), "utf-8")); }
    catch { return null; }
  }
  try {
    const res = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const buf = await streamToBuffer(res.Body);
    return JSON.parse(buf.toString("utf-8"));
  } catch (e) {
    if (e.name === "NoSuchKey") return null;
    throw e;
  }
}

export async function putJSON(key, data) {
  if (!CF_CONFIGURED) {
    fs.writeFileSync(localPath(key + ".json"), JSON.stringify(data, null, 2));
    return;
  }
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key,
    Body: JSON.stringify(data, null, 2),
    ContentType: "application/json",
  }));
}

// ─── Excel helpers ───────────────────────────────────────────

export async function getExcel(key) {
  if (!CF_CONFIGURED) {
    try {
      const buf = fs.readFileSync(localPath(key));
      const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      return XLSX.utils.sheet_to_json(ws, { defval: null });
    } catch { return []; }
  }
  try {
    const res = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const buf = await streamToBuffer(res.Body);
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { defval: null });
  } catch (e) {
    if (e.name === "NoSuchKey") return [];
    throw e;
  }
}

export async function putExcel(key, rows, sheetName = "Sheet1") {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  if (!CF_CONFIGURED) {
    fs.writeFileSync(localPath(key), buf);
    return;
  }
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: buf,
    ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }));
}

// ─── Flag helpers ─────────────────────────────────────────────

export async function flagExists(key) {
  if (!CF_CONFIGURED) return fs.existsSync(localPath(key));
  try {
    await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch { return false; }
}

export async function setFlag(key, body = "1") {
  if (!CF_CONFIGURED) { fs.writeFileSync(localPath(key), body); return; }
  await r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body }));
}

export async function isEODFlagSet(dateStr) {
  return flagExists(`eod_flags/eod_${dateStr}.flag`);
}

export async function setEODFlag(dateStr) {
  return setFlag(`eod_flags/eod_${dateStr}.flag`, "EOD summary sent");
}

// ─── List keys ────────────────────────────────────────────────

export async function listKeys(prefix = "") {
  if (!CF_CONFIGURED) {
    try {
      return fs.readdirSync(LOCAL_R2_DIR)
        .filter(f => f.startsWith(prefix.replace(/\//g, "__")))
        .map(f => ({ key: f, size: fs.statSync(path.join(LOCAL_R2_DIR, f)).size }));
    } catch { return []; }
  }
  const res = await r2.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix }));
  return (res.Contents || []).map((c) => ({ key: c.Key, size: c.Size, lastModified: c.LastModified }));
}

