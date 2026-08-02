/* ============================================================
   api/upload-image.js — Vercel serverless function
   Performs a SIGNED Cloudinary upload. Credentials never reach
   the browser — they're read from Vercel's environment variables
   on the server only.

   Required Vercel project environment variables:
     CLOUDINARY_CLOUD_NAME
     API_KEY
     API_SECRET
   ============================================================ */
const crypto = require("crypto");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { CLOUDINARY_CLOUD_NAME, API_KEY, API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !API_KEY || !API_SECRET) {
    res
      .status(500)
      .json({ error: "Cloudinary environment variables are not configured." });
    return;
  }

  const { image } = req.body || {};
  if (!image || typeof image !== "string") {
    res
      .status(400)
      .json({ error: "Missing 'image' (base64 data URI) in request body." });
    return;
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000);

    // Only params sent to Cloudinary besides file/api_key/signature go into
    // the signature string, alphabetically sorted (here it's just timestamp).
    const stringToSign = `timestamp=${timestamp}${API_SECRET}`;
    const signature = crypto
      .createHash("sha1")
      .update(stringToSign)
      .digest("hex");

    const body = new URLSearchParams({
      file: image,
      api_key: API_KEY,
      timestamp: String(timestamp),
      signature,
    });

    const cloudinaryRes = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
    );

    const data = await cloudinaryRes.json();

    if (!cloudinaryRes.ok) {
      res
        .status(cloudinaryRes.status)
        .json({ error: data?.error?.message || "Cloudinary upload failed." });
      return;
    }

    res.status(200).json({ url: data.secure_url || data.url });
  } catch (err) {
    res.status(500).json({ error: err.message || "Upload failed." });
  }
};
