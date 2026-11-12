// Minimal dependency-free MP4 (ISO BMFF) muxer for a single H.264 video track.
//
// Designed for WebCodecs `VideoEncoder` output configured with
// `avc: { format: 'avc' }`: every chunk is one AVCC sample (4-byte big-endian
// length before each NAL unit) and `metadata.decoderConfig.description` is the
// avcC record. Frames must arrive in presentation order (no B-frames), and
// every frame lasts exactly 1/fps.
//
// File layout: ftyp, moov, mdat ("fast start"). finalize() returns the header
// as one Uint8Array followed by the caller's per-frame Uint8Arrays untouched,
// so sample data is never copied into one big buffer.

const TICKS_PER_FRAME = 1000; // media timescale = fps * TICKS_PER_FRAME
const MAX_U32 = 0xffffffff;

// ---------------------------------------------------------------- byte helpers

function concat(parts) {
  let size = 0;
  for (const p of parts) size += p.byteLength;
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

const u8 = (...values) => Uint8Array.from(values);

function u16(...values) {
  const out = new Uint8Array(values.length * 2);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setUint16(i * 2, v));
  return out;
}

function u32(...values) {
  return u32List(values);
}

function u32List(values) {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  for (let i = 0; i < values.length; i++) view.setUint32(i * 4, values[i]);
  return out;
}

function u64List(values) {
  const out = new Uint8Array(values.length * 8);
  const view = new DataView(out.buffer);
  for (let i = 0; i < values.length; i++) {
    view.setUint32(i * 8, Math.floor(values[i] / 0x100000000));
    view.setUint32(i * 8 + 4, values[i] % 0x100000000);
  }
  return out;
}

function ascii(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

const zeros = (n) => new Uint8Array(n);

function box(type, ...payload) {
  const body = concat(payload);
  const out = new Uint8Array(8 + body.byteLength);
  new DataView(out.buffer).setUint32(0, out.byteLength);
  out.set(ascii(type), 4);
  out.set(body, 8);
  return out;
}

function fullBox(type, version, flags, ...payload) {
  return box(type, u32(version * 0x1000000 + flags), ...payload);
}

function toBytes(value, what) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer) {
    return new Uint8Array(value);
  }
  throw new TypeError(`Mp4Muxer: ${what} must be a Uint8Array or ArrayBuffer`);
}

// ------------------------------------------------------------------ colour info

// WebCodecs VideoColorSpace strings -> ISO/IEC 23091-2 code points.
const COLOUR_PRIMARIES = { bt709: 1, bt470bg: 5, smpte170m: 6, bt2020: 9, smpte432: 12 };
const TRANSFER = {
  bt709: 1, smpte170m: 6, linear: 8, 'iec61966-2-1': 13, pq: 16, hlg: 18,
};
const MATRIX = { rgb: 0, bt709: 1, bt470bg: 5, smpte170m: 6, 'bt2020-ncl': 9 };

// Returns the four nclx values, or null when nothing useful is known.
function normaliseColorSpace(cs) {
  if (!cs) return null;
  if (cs === 'bt709') cs = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };
  if (typeof cs !== 'object') return null;
  const primaries = COLOUR_PRIMARIES[cs.primaries];
  const transfer = TRANSFER[cs.transfer];
  const matrix = MATRIX[cs.matrix];
  if (primaries === undefined && transfer === undefined && matrix === undefined) return null;
  return {
    primaries: primaries ?? 2, // 2 = unspecified
    transfer: transfer ?? 2,
    matrix: matrix ?? 2,
    fullRange: cs.fullRange === true,
  };
}

// ------------------------------------------------------------------------ muxer

export class Mp4Muxer {
  // width/height: coded picture size in pixels. fps: integer frame rate.
  // codec: 'avc1' (a full WebCodecs string such as 'avc1.640033' is accepted).
  // colorSpace (optional): 'bt709' or a WebCodecs VideoColorSpace-like object;
  //   when known a `colr` (nclx) box is written. addChunk() picks it up from
  //   metadata.decoderConfig.colorSpace automatically if not given here.
  constructor({ width, height, fps, codec = 'avc1', colorSpace } = {}) {
    if (!Number.isInteger(width) || !Number.isInteger(height)
      || width < 1 || height < 1 || width > 0xffff || height > 0xffff) {
      throw new Error(`Mp4Muxer: invalid size ${width}x${height}`);
    }
    if (!Number.isInteger(fps) || fps < 1 || fps > 1000) {
      throw new Error(`Mp4Muxer: fps must be a positive integer, got ${fps}`);
    }
    const fourcc = String(codec).slice(0, 4);
    if (fourcc !== 'avc1' && fourcc !== 'avc3') {
      throw new Error(`Mp4Muxer: unsupported codec "${codec}" (only H.264 'avc1' is supported)`);
    }
    this.width = width;
    this.height = height;
    this.fps = fps;
    this.codec = fourcc;
    this._colour = normaliseColorSpace(colorSpace);
    this._avcC = null;
    this._frames = []; // Uint8Array per sample, kept by reference
    this._keyFrames = []; // 1-based sample numbers of sync samples
    this._bytes = 0;
  }

  get frameCount() {
    return this._frames.length;
  }

  // data: one AVCC length-prefixed access unit. The array is kept by reference
  // (not copied) and returned from finalize(), so do not reuse its buffer.
  addFrame(data, { key = false, description, colorSpace } = {}) {
    const bytes = toBytes(data, 'frame data');
    if (bytes.byteLength === 0) throw new Error('Mp4Muxer: empty frame');

    if (description && !this._avcC) {
      const avcC = toBytes(description, 'description').slice(); // private copy
      if (avcC.byteLength < 7 || avcC[0] !== 1) {
        throw new Error('Mp4Muxer: description is not an avcC record '
          + "(configure the encoder with avc: { format: 'avc' })");
      }
      this._avcC = avcC;
    }
    if (colorSpace && !this._colour) this._colour = normaliseColorSpace(colorSpace);

    if (this._frames.length === 0) {
      if (!key) throw new Error('Mp4Muxer: the first frame must be a key frame');
      if (bytes.byteLength >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 1) {
        throw new Error('Mp4Muxer: frame data looks like Annex B (start codes), expected '
          + "length-prefixed AVCC; use avc: { format: 'avc' } or annexBToAvcc()");
      }
    }

    this._frames.push(bytes);
    this._bytes += bytes.byteLength;
    if (key) this._keyFrames.push(this._frames.length);
  }

  // chunk: EncodedVideoChunk, metadata: the second argument of the
  // VideoEncoder output callback.
  addChunk(chunk, metadata) {
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    const config = metadata && metadata.decoderConfig;
    this.addFrame(data, {
      key: chunk.type === 'key',
      description: config ? config.description : undefined,
      colorSpace: config ? config.colorSpace : undefined,
    });
  }

  // Returns [header, frame0, frame1, ...] in file order. The header holds
  // ftyp + moov + the mdat box header; the frames are the arrays passed to
  // addFrame(). Use as `new Blob(parts, { type: 'video/mp4' })`.
  finalize() {
    const frames = this._frames;
    if (frames.length === 0) throw new Error('Mp4Muxer: no frames were added');
    if (!this._avcC) {
      throw new Error('Mp4Muxer: no avcC description was provided (pass '
        + 'metadata.decoderConfig.description with the first frame)');
    }

    // One chunk per second of video keeps stsc/stco tiny and seeking cheap.
    const samplesPerChunk = this.fps;
    const chunkStarts = []; // byte offset of each chunk relative to mdat payload
    let at = 0;
    for (let i = 0; i < frames.length; i++) {
      if (i % samplesPerChunk === 0) chunkStarts.push(at);
      at += frames[i].byteLength;
    }
    const payloadSize = at;

    const ftyp = box('ftyp', ascii('isom'), u32(0x200), ascii('isomiso2avc1mp41'));
    const mdatHeader = payloadSize + 8 > MAX_U32
      ? concat([u32(1), ascii('mdat'), u64List([payloadSize + 16])])
      : concat([u32(payloadSize + 8), ascii('mdat')]);

    // The moov size depends on stco vs co64, and the offsets depend on the
    // moov size. Try 32-bit offsets first; fall back to co64 if they overflow.
    let moov;
    for (const wide of [false, true]) {
      const moovSize = this._moov(chunkStarts, 0, wide, samplesPerChunk).byteLength;
      const dataStart = ftyp.byteLength + moovSize + mdatHeader.byteLength;
      if (!wide && dataStart + chunkStarts[chunkStarts.length - 1] > MAX_U32) continue;
      moov = this._moov(chunkStarts, dataStart, wide, samplesPerChunk);
      break;
    }

    return [concat([ftyp, moov, mdatHeader]), ...frames];
  }

  _moov(chunkStarts, dataStart, wide, samplesPerChunk) {
    const { width, height, fps } = this;
    const frames = this._frames;
    const count = frames.length;
    const timescale = fps * TICKS_PER_FRAME;
    const duration = count * TICKS_PER_FRAME;
    if (duration > MAX_U32) throw new Error('Mp4Muxer: too many frames');
    const matrix = u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000);

    const mvhd = fullBox('mvhd', 0, 0,
      u32(0, 0, timescale, duration), // creation, modification, timescale, duration
      u32(0x10000), // rate 1.0
      u16(0x0100), // volume 1.0
      zeros(10),
      matrix,
      zeros(24),
      u32(2)); // next_track_ID

    const tkhd = fullBox('tkhd', 0, 3, // enabled | in movie
      u32(0, 0, 1, 0, duration), // creation, modification, track_ID, reserved, duration
      zeros(8),
      u16(0, 0, 0, 0), // layer, alternate_group, volume, reserved
      matrix,
      u32(width * 0x10000, height * 0x10000));

    const mdhd = fullBox('mdhd', 0, 0,
      u32(0, 0, timescale, duration),
      u16(0x55c4, 0)); // language 'und'

    const hdlr = fullBox('hdlr', 0, 0,
      u32(0), ascii('vide'), zeros(12), ascii('VideoHandler\0'));

    const vmhd = fullBox('vmhd', 0, 1, zeros(8));
    const dinf = box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1)));

    const sampleEntryParts = [
      zeros(6), u16(1), // reserved, data_reference_index
      zeros(16), // pre_defined / reserved
      u16(width, height),
      u32(0x00480000, 0x00480000), // 72 dpi
      u32(0), // reserved
      u16(1), // frame_count
      zeros(32), // compressorname
      u16(0x0018, 0xffff), // depth, pre_defined = -1
      box('avcC', this._avcC),
    ];
    if (this._colour) {
      const c = this._colour;
      sampleEntryParts.push(box('colr', ascii('nclx'),
        u16(c.primaries, c.transfer, c.matrix), u8(c.fullRange ? 0x80 : 0)));
    }
    const stsd = fullBox('stsd', 0, 0, u32(1), box(this.codec, ...sampleEntryParts));

    const stts = fullBox('stts', 0, 0, u32(1, count, TICKS_PER_FRAME));
    const stss = fullBox('stss', 0, 0, u32(this._keyFrames.length), u32List(this._keyFrames));

    // stsc: all chunks hold `samplesPerChunk` samples except maybe the last.
    const chunkCount = chunkStarts.length;
    const lastChunkSamples = count - (chunkCount - 1) * samplesPerChunk;
    const stscEntries = [];
    if (chunkCount > 1 || lastChunkSamples === samplesPerChunk) {
      stscEntries.push(1, samplesPerChunk, 1);
    }
    if (lastChunkSamples !== samplesPerChunk) {
      stscEntries.push(chunkCount, lastChunkSamples, 1);
    }
    const stsc = fullBox('stsc', 0, 0, u32(stscEntries.length / 3), u32List(stscEntries));

    const sizes = new Array(count);
    for (let i = 0; i < count; i++) sizes[i] = frames[i].byteLength;
    const stsz = fullBox('stsz', 0, 0, u32(0, count), u32List(sizes));

    const offsets = chunkStarts.map((start) => dataStart + start);
    const chunkOffsets = wide
      ? fullBox('co64', 0, 0, u32(chunkCount), u64List(offsets))
      : fullBox('stco', 0, 0, u32(chunkCount), u32List(offsets));

    const stbl = box('stbl', stsd, stts, stss, stsc, stsz, chunkOffsets);
    const minf = box('minf', vmhd, dinf, stbl);
    const mdia = box('mdia', mdhd, hdlr, minf);
    const trak = box('trak', tkhd, mdia);
    return box('moov', mvhd, trak);
  }
}

// --------------------------------------------------------------------- Annex B

// Splits an Annex B H.264 elementary stream (00 00 01 / 00 00 00 01 start
// codes) into access units and converts each to an AVCC sample (4-byte length
// prefixes). SPS/PPS are collected separately (de-duplicated) and, like AUDs,
// removed from the samples. Access units are split on AUDs / parameter sets /
// SEI following a slice, or on a slice whose first_mb_in_slice is 0.
// Progressive (frame) streams only: paired fields are not merged.
export function annexBToAvcc(annexB) {
  const bytes = toBytes(annexB, 'annexB');
  const sps = [];
  const pps = [];
  const samples = [];

  let nals = [];
  let hasSlice = false;
  let key = false;

  const flush = () => {
    if (hasSlice) {
      let size = 0;
      for (const nal of nals) size += 4 + nal.byteLength;
      const data = new Uint8Array(size);
      const view = new DataView(data.buffer);
      let at = 0;
      for (const nal of nals) {
        view.setUint32(at, nal.byteLength);
        data.set(nal, at + 4);
        at += 4 + nal.byteLength;
      }
      samples.push({ data, key });
    }
    nals = [];
    hasSlice = false;
    key = false;
  };

  const addUnique = (list, nal) => {
    const same = (a) => a.byteLength === nal.byteLength && a.every((v, i) => v === nal[i]);
    if (!list.some(same)) list.push(nal.slice());
  };

  const handleNal = (nal) => {
    const type = nal[0] & 0x1f;
    if (type === 1 || type === 2 || type === 5) {
      // first_mb_in_slice is ue(v): it is 0 exactly when the first bit is 1.
      const firstMbIsZero = nal.byteLength > 1 && (nal[1] & 0x80) !== 0;
      if (hasSlice && firstMbIsZero) flush();
      hasSlice = true;
      if (type === 5) key = true;
      nals.push(nal);
    } else if (type === 6 || type === 7 || type === 8 || type === 9 || (type >= 14 && type <= 18)) {
      // These may only appear before the first slice of an access unit.
      if (hasSlice) flush();
      if (type === 7) addUnique(sps, nal);
      else if (type === 8) addUnique(pps, nal);
      else if (type !== 9) nals.push(nal);
    } else {
      nals.push(nal);
    }
  };

  // Find start codes; each NAL runs to the next start code (or end of data),
  // minus trailing zero bytes (which belong to a 4-byte start code or padding).
  const n = bytes.byteLength;
  let nalStart = -1;
  const emit = (end) => {
    if (nalStart < 0) return;
    while (end > nalStart && bytes[end - 1] === 0) end--;
    if (end > nalStart) handleNal(bytes.subarray(nalStart, end));
  };
  let i = 0;
  while (i + 2 < n) {
    const b2 = bytes[i + 2];
    if (b2 > 1) {
      i += 3;
    } else if (b2 === 1) {
      if (bytes[i] === 0 && bytes[i + 1] === 0) {
        emit(i);
        nalStart = i + 3;
        i += 3;
      } else {
        i += 3;
      }
    } else {
      i += 1;
    }
  }
  emit(n);
  flush();

  return { sps, pps, samples };
}

// ------------------------------------------------------------------------ avcC

// Reads chroma_format_idc and bit depths from the start of a High-profile SPS.
function spsChromaInfo(sps) {
  const info = { chroma: 1, lumaDepth: 0, chromaDepth: 0 };
  const rbsp = [];
  let zerosSeen = 0;
  for (let i = 1; i < sps.byteLength && rbsp.length < 48; i++) {
    const b = sps[i];
    if (zerosSeen >= 2 && b === 3) { // emulation prevention byte
      zerosSeen = 0;
      continue;
    }
    zerosSeen = b === 0 ? zerosSeen + 1 : 0;
    rbsp.push(b);
  }
  let bit = 24; // skip profile_idc, constraint flags, level_idc
  const readBit = () => {
    const byte = rbsp[bit >> 3];
    if (byte === undefined) throw new Error('short SPS');
    const value = (byte >> (7 - (bit & 7))) & 1;
    bit++;
    return value;
  };
  const readUe = () => {
    let leading = 0;
    while (readBit() === 0) {
      if (++leading > 31) throw new Error('bad SPS');
    }
    let value = 0;
    for (let k = 0; k < leading; k++) value = value * 2 + readBit();
    return 2 ** leading - 1 + value;
  };
  try {
    readUe(); // seq_parameter_set_id
    const chroma = readUe();
    if (chroma === 3) readBit(); // separate_colour_plane_flag
    const lumaDepth = readUe();
    const chromaDepth = readUe();
    if (chroma <= 3 && lumaDepth <= 6 && chromaDepth <= 6) {
      Object.assign(info, { chroma, lumaDepth, chromaDepth });
    }
  } catch {
    // keep 4:2:0 8-bit defaults
  }
  return info;
}

const PROFILES_WITH_CHROMA_INFO = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]);

// Builds an AVCDecoderConfigurationRecord (the payload of the avcC box) from
// raw SPS and PPS NAL units (no start codes / length prefixes). Each argument
// may be a single Uint8Array or an array of them.
export function buildAvcC(sps, pps) {
  const spsList = (Array.isArray(sps) ? sps : [sps]).map((s) => toBytes(s, 'SPS'));
  const ppsList = (Array.isArray(pps) ? pps : [pps]).map((p) => toBytes(p, 'PPS'));
  if (spsList.length === 0 || ppsList.length === 0) {
    throw new Error('buildAvcC: at least one SPS and one PPS are required');
  }
  if (spsList.length > 31 || ppsList.length > 255) {
    throw new Error('buildAvcC: too many parameter sets');
  }
  const first = spsList[0];
  if (first.byteLength < 4 || (first[0] & 0x1f) !== 7) {
    throw new Error('buildAvcC: first SPS is not a valid SPS NAL unit');
  }
  const profile = first[1];

  const parts = [u8(1, profile, first[2], first[3], 0xfc | 3, 0xe0 | spsList.length)];
  for (const s of spsList) parts.push(u16(s.byteLength), s);
  parts.push(u8(ppsList.length));
  for (const p of ppsList) parts.push(u16(p.byteLength), p);

  if (profile !== 66 && profile !== 77 && profile !== 88) {
    const info = PROFILES_WITH_CHROMA_INFO.has(profile)
      ? spsChromaInfo(first)
      : { chroma: 1, lumaDepth: 0, chromaDepth: 0 };
    parts.push(u8(0xfc | info.chroma, 0xf8 | info.lumaDepth, 0xf8 | info.chromaDepth, 0));
  }
  return concat(parts);
}
