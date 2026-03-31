// upload-to-r2.js
// Run from D:\Claude Projects\Stock APP\stock-webapp\
// Command: node upload-to-r2.js

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const fs = require("fs");
const path = require("path");

// R2 credentials
const r2 = new S3Client({
  region: "auto",
  endpoint: "https://cd5a55aca305cdfa04cb1c76d4837a74.r2.cloudflarestorage.com",
  credentials: {
    accessKeyId: "9313c77bbb45ad8c4cb87b8ab1ba515b",
    secretAccessKey: "87bf99f399188ad30c01f8fb0550dd2c040434464f7e2ece9951dec98b0ec662",
  },
});

const BUCKET = "stock-atsl";

// Files to upload — old location → R2 key
const FILES = [
  {
    local: path.join(__dirname, "..", "stocks_bought-atsl.xlsx"),
    key: "stocks_bought-atsl.xlsx",
  },
  {
    local: path.join(__dirname, "..", "trade_history.xlsx"),
    key: "trade_history.xlsx",
  },
  {
    local: path.join(__dirname, "..", "option_executed.xlsx"),
    key: "option_executed.xlsx",
  },
  {
    local: path.join(__dirname, "..", "EQUITY_L_NIFTY200.csv"),
    key: "EQUITY_L_NIFTY200.csv",
  },
];

async function uploadFile(localPath, key) {
  if (!fs.existsSync(localPath)) {
    console.log(`⚠️  Skipping (not found): ${localPath}`);
    return;
  }

  const body = fs.readFileSync(localPath);
  const ext = path.extname(localPath).toLowerCase();
  const contentType =
    ext === ".xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : ext === ".csv"
      ? "text/csv"
      : "application/octet-stream";

  try {
    await r2.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );
    console.log(`✅ Uploaded: ${key} (${(body.length / 1024).toFixed(1)} KB)`);
  } catch (e) {
    console.error(`❌ Failed: ${key} — ${e.message}`);
  }
}

async function main() {
  console.log("🚀 Uploading files to Cloudflare R2 bucket: stock-atsl\n");
  for (const file of FILES) {
    await uploadFile(file.local, file.key);
  }
  console.log("\n✅ Done! Check your R2 bucket at:");
  console.log("https://dash.cloudflare.com/cd5a55aca305cdfa04cb1c76d4837a74/r2/default/buckets/stock-atsl");
}

main().catch(console.error);