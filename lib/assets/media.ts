import "server-only";

export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
export const MIN_GENERATED_IMAGE_BYTES = 1024;

export type InspectedImage = {
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  extension: "png" | "jpg" | "webp";
  width: number;
  height: number;
};

export function inspectImage(bytes: Uint8Array): InspectedImage {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const png = inspectPng(buffer);
  if (png) return png;
  const jpeg = inspectJpeg(buffer);
  if (jpeg) return jpeg;
  const webp = inspectWebp(buffer);
  if (webp) return webp;
  throw new Error("UNSUPPORTED_OR_CORRUPT_IMAGE");
}

export function validateProductImage(input: {
  bytes: Uint8Array;
  declaredMimeType: string;
  fileName: string;
}): InspectedImage {
  if (input.bytes.byteLength <= 0 || input.bytes.byteLength > MAX_PRODUCT_IMAGE_BYTES) {
    throw new Error("PRODUCT_IMAGE_SIZE_INVALID");
  }
  const inspected = inspectImage(input.bytes);
  if (inspected.mimeType !== input.declaredMimeType) throw new Error("PRODUCT_IMAGE_MIME_MISMATCH");
  const extension = input.fileName.split(".").pop()?.toLowerCase();
  const accepted = inspected.extension === "jpg" ? ["jpg", "jpeg"] : [inspected.extension];
  if (!extension || !accepted.includes(extension)) throw new Error("PRODUCT_IMAGE_EXTENSION_MISMATCH");
  return inspected;
}

export function validateGeneratedImage(input: {
  bytes: Uint8Array;
  responseContentType?: string | null;
}): InspectedImage {
  if (input.bytes.byteLength < MIN_GENERATED_IMAGE_BYTES) throw new Error("GENERATED_IMAGE_TOO_SMALL");
  const inspected = inspectImage(input.bytes);
  const declared = input.responseContentType?.split(";")[0]?.trim().toLowerCase();
  if (declared && declared !== "application/octet-stream" && declared !== inspected.mimeType) {
    throw new Error("GENERATED_IMAGE_CONTENT_TYPE_MISMATCH");
  }
  return inspected;
}

export function hasMp4Signature(bytes: Uint8Array): boolean {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp";
}

export function hasSupportedAudioSignature(bytes: Uint8Array, mimeType: string): boolean {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.length < 12) return false;
  if (["audio/mpeg", "audio/mp3"].includes(mimeType)) {
    return buffer.subarray(0, 3).toString("ascii") === "ID3" || (buffer[0] === 0xff && (buffer[1]! & 0xe0) === 0xe0);
  }
  if (["audio/wav", "audio/x-wav"].includes(mimeType)) {
    return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WAVE";
  }
  if (["audio/mp4", "audio/aac"].includes(mimeType)) {
    return mimeType === "audio/aac"
      ? buffer[0] === 0xff && (buffer[1]! & 0xf0) === 0xf0
      : buffer.subarray(4, 8).toString("ascii") === "ftyp";
  }
  return false;
}

function inspectPng(buffer: Buffer): InspectedImage | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature) || buffer.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return validDimensions(width, height) ? { mimeType: "image/png", extension: "png", width, height } : null;
}

function inspectJpeg(buffer: Buffer): InspectedImage | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1]!;
    if (marker === 0xd9 || marker === 0xda) break;
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + length + 2 > buffer.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return validDimensions(width, height) ? { mimeType: "image/jpeg", extension: "jpg", width, height } : null;
    }
    offset += length + 2;
  }
  return null;
}

function inspectWebp(buffer: Buffer): InspectedImage | null {
  if (buffer.length < 30 || buffer.subarray(0, 4).toString("ascii") !== "RIFF" || buffer.subarray(8, 12).toString("ascii") !== "WEBP") return null;
  const chunk = buffer.subarray(12, 16).toString("ascii");
  let width = 0;
  let height = 0;
  if (chunk === "VP8X") {
    width = 1 + buffer.readUIntLE(24, 3);
    height = 1 + buffer.readUIntLE(27, 3);
  } else if (chunk === "VP8 " && buffer.length >= 30) {
    width = buffer.readUInt16LE(26) & 0x3fff;
    height = buffer.readUInt16LE(28) & 0x3fff;
  } else if (chunk === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    width = (bits & 0x3fff) + 1;
    height = ((bits >>> 14) & 0x3fff) + 1;
  }
  return validDimensions(width, height) ? { mimeType: "image/webp", extension: "webp", width, height } : null;
}

function validDimensions(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= 32_768 && height <= 32_768;
}
