/**
 * Imported audio for the editor: stored in OPFS per recording, decoded once at
 * the mix rate, and kept decoded until the editor closes (so undoing a track's
 * removal brings its sound back).
 */
import type { EditProject } from "@/db/dexie";
import { newId } from "@/lib/id";
import { duckingEnvelope, voiceLevels } from "./ducking";
import type { Layout } from "./timeline";
import type { ExportAudio, SourceInfo } from "./export/protocol";

const ROOT = "editor-audio";
/** All decoded added audio together: about 35 minutes of stereo at 48 kHz. */
export const MAX_DECODED_BYTES = 400 * 1024 * 1024;

async function dir(recordingId: string, create: boolean): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(ROOT, { create });
    return await root.getDirectoryHandle(recordingId, { create });
  } catch {
    return null;
  }
}

const cache = new Map<string, AudioBuffer>();
const bytes = (b: AudioBuffer) => b.length * b.numberOfChannels * 4;
export const decodedBytes = () => [...cache.values()].reduce((n, b) => n + bytes(b), 0);
export const cachedAsset = (assetId: string) => cache.get(assetId) ?? null;

async function decode(data: ArrayBuffer, rate: number): Promise<AudioBuffer> {
  // An OfflineAudioContext at the mix rate resamples while decoding.
  return new OfflineAudioContext(1, 1, rate).decodeAudioData(data);
}

/** Decodes, checks the memory cap, then stores the file. Throws a message naming the file. */
export async function importAudio(recordingId: string, file: File, rate: number): Promise<{ assetId: string; buffer: AudioBuffer }> {
  let buffer: AudioBuffer;
  try {
    buffer = await decode(await file.arrayBuffer(), rate);
  } catch {
    throw new Error(`"${file.name}" can't be read as audio by this browser.`);
  }
  if (decodedBytes() + bytes(buffer) > MAX_DECODED_BYTES) {
    throw new Error(`"${file.name}" is too long to add: added audio is limited to about 35 minutes in all, to keep memory in check.`);
  }
  const d = await dir(recordingId, true);
  if (!d) throw new Error("This browser can't store the file.");
  const assetId = newId();
  const w = await (await d.getFileHandle(assetId, { create: true })).createWritable();
  await w.write(file);
  await w.close();
  cache.set(assetId, buffer);
  return { assetId, buffer };
}

/** A stored file, decoded (from the cache if it's there). Null if the file is gone. */
export async function loadAsset(recordingId: string, assetId: string, rate: number): Promise<AudioBuffer | null> {
  const hit = cache.get(assetId);
  if (hit) return hit;
  const d = await dir(recordingId, false);
  if (!d) return null;
  try {
    const f = await (await d.getFileHandle(assetId)).getFile();
    const b = await decode(await f.arrayBuffer(), rate);
    cache.set(assetId, b);
    return b;
  } catch {
    return null;
  }
}

/** On leaving the editor: forget decodes, and delete stored files the project no longer uses. */
export async function closeAssets(recordingId: string, project: EditProject | null) {
  cache.clear();
  const d = await dir(recordingId, false);
  if (!d) return;
  const used = new Set((project?.audio.tracks ?? []).map((t) => t.assetId));
  for await (const [name] of (d as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) if (!used.has(name)) await d.removeEntry(name).catch(() => undefined);
}

/** With the recording: every file added to its edits. */
export async function deleteRecordingAssets(recordingId: string) {
  try {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(ROOT);
    await root.removeEntry(recordingId, { recursive: true });
  } catch {
    /* none */
  }
}

/** The mix's format: the recording's rate (else 48 kHz), and the most channels of anything in it, at most 2. */
export function mixFormat(info: SourceInfo, project: EditProject): { rate: number; channels: number } {
  const rate = info.hasAudio ? info.sampleRate : 48000;
  let channels = info.hasAudio && project.audio.original.on ? info.channels : 1;
  for (const t of project.audio.tracks) channels = Math.max(channels, cache.get(t.assetId)?.numberOfChannels ?? 1);
  return { rate, channels: Math.min(2, Math.max(1, channels)) };
}

/** The music dip over the whole output, or null if no track dips. The same for the preview and the export. */
export function buildEnvelope(project: EditProject, l: Layout, original: { samples: Float32Array; rate: number } | null): Float32Array | null {
  if (!project.audio.tracks.some((t) => t.duck)) return null;
  const voiceTracks = project.audio.tracks
    .filter((t) => t.voice && cache.has(t.assetId))
    .map((t) => {
      const b = cache.get(t.assetId)!;
      return { samples: b.getChannelData(0), rate: b.sampleRate, start: t.start, trimIn: t.trimIn, length: t.length, loop: t.loop };
    });
  const levels = voiceLevels({
    layout: l,
    original: original && project.audio.original.on ? { ...original, offset: project.audio.original.offsetMs / 1000, mutes: project.audio.mutes } : null,
    voiceTracks,
  });
  return duckingEnvelope(levels, project.audio.ducking.depthDb);
}

/** What the export needs to make the sound. Track samples are copied: the page keeps its own for the preview. */
export function buildExportAudio(project: EditProject, info: SourceInfo, l: Layout, original: { samples: Float32Array; rate: number } | null): ExportAudio {
  const { rate, channels } = mixFormat(info, project);
  const tracks = project.audio.tracks
    .filter((t) => cache.has(t.assetId))
    .map((t) => {
      const b = cache.get(t.assetId)!;
      const planes = Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c).slice());
      return { planes, start: t.start, trimIn: t.trimIn, length: t.length, volumeDb: t.volumeDb, fadeIn: t.fadeIn, fadeOut: t.fadeOut, loop: t.loop, duck: t.duck };
    });
  return { rate, channels, tracks, envelope: buildEnvelope(project, l, original) };
}
