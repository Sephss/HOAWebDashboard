/* ============================================================
   imageUpload.js — Reusable image upload helper.
   Mirrors the Android app's addImage.compressBitmap(): resizes
   to a max of 1280x1280 (no upscaling) and re-encodes as JPEG
   at ~75% quality, client-side, before uploading.

   Uploads go through our own /api/upload-image serverless
   function — the browser never talks to Cloudinary directly and
   never sees the API key/secret.

   Usage (any module):
     import { uploadImage } from "./imageUpload.js";
     const url = await uploadImage(fileInput.files[0]);
   ============================================================ */

const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.75;

/**
 * Resizes an image file down to MAX_DIMENSION (preserving aspect ratio,
 * never upscaling) and re-encodes it as JPEG at JPEG_QUALITY.
 * @param {File} file
 * @returns {Promise<string>} a "data:image/jpeg;base64,…" data URI
 */
export async function compressImageFile(file) {
  const bitmap = await createImageBitmap(file);

  let { width, height } = bitmap;
  const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height, 1);
  width = Math.round(width * ratio);
  height = Math.round(height * ratio);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to compress image."));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      },
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}

/**
 * Compresses then uploads an image file through /api/upload-image.
 * @param {File} file
 * @returns {Promise<string>} the uploaded image's URL
 */
export async function uploadImage(file) {
  const dataUri = await compressImageFile(file);

  const res = await fetch("/api/upload-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: dataUri }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || "Image upload failed.");
  }

  return data.url;
}
