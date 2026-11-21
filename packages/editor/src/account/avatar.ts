import { AVATAR_SIZE, AvatarRefusalSchema, MAX_AVATAR_BYTES } from '@boombapbot/contracts';
import { ANY_ANSWER, ask } from './ask';
import type { Failure } from './client';

// The picture of the account that is logged in. A picture is cropped to a
// square and shrunk on the page, so the file somebody picks never leaves the
// device: only the small square made from it does.

/** The largest file the page will open to make a picture from. */
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
/** What shows through a picture with clear parts, and a JPEG has none: the modal's own ground. */
const GROUND = '#171513';
/** Tried in turn until one comes out small enough. A browser that cannot write WebP writes something else, which is passed over. */
const ENCODINGS = [
  { type: 'image/webp', quality: 0.86 },
  { type: 'image/jpeg', quality: 0.86 },
  { type: 'image/jpeg', quality: 0.7 },
] as const;

const NOT_A_PICTURE: Failure = { message: 'I could not open that as a picture. Try a JPEG, a PNG or a WebP.' };
const SOURCE_TOO_LARGE: Failure = { message: 'That file is too large to open here. Try one under 20 MB.' };
const WOULD_NOT_SHRINK: Failure = { message: 'I could not make that picture small enough to keep. Try another.' };

/** The middle square of a picture, as large as the picture allows. */
export function middleSquare(width: number, height: number): { x: number; y: number; side: number } {
  const side = Math.min(width, height);
  return { x: (width - side) / 2, y: (height - side) / 2, side };
}

const encode = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/** The square the server keeps, made from a file somebody picked, or why it could not be made. */
async function squared(file: Blob): Promise<Blob | Failure> {
  if (file.size > MAX_SOURCE_BYTES) return SOURCE_TOO_LARGE;
  const picture = await createImageBitmap(file).catch(() => null);
  if (!picture) return NOT_A_PICTURE;
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext('2d');
  if (!context) return NOT_A_PICTURE;
  const { x, y, side } = middleSquare(picture.width, picture.height);
  context.fillStyle = GROUND;
  context.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  context.imageSmoothingQuality = 'high';
  context.drawImage(picture, x, y, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  picture.close();
  for (const { type, quality } of ENCODINGS) {
    const made = await encode(canvas, type, quality);
    if (made && made.type === type && made.size <= MAX_AVATAR_BYTES) return made;
  }
  return WOULD_NOT_SHRINK;
}

const address = (baseUrl: string) => `${baseUrl}api/account/avatar`;

/** Makes a file somebody picked the account's picture. Answers with what went wrong, or null. */
export async function uploadAvatar(baseUrl: string, file: Blob): Promise<Failure | null> {
  const square = await squared(file);
  if (!(square instanceof Blob)) return square;
  const asked = await ask(address(baseUrl), ANY_ANSWER, AvatarRefusalSchema, 'PUT', square);
  return asked.ok ? null : asked.failure;
}

/** Takes the account's picture away. Answers with what went wrong, or null. */
export async function removeAvatar(baseUrl: string): Promise<Failure | null> {
  const asked = await ask(address(baseUrl), ANY_ANSWER, AvatarRefusalSchema, 'DELETE');
  return asked.ok ? null : asked.failure;
}
