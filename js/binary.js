/**
 * Binary WS protocol for Zona (AOI state + board).
 * Server copy — keep in sync with client/js/binary.js when protocol changes.
 *
 * STATE 11 (slither-style deltas):
 *   u32 tick | f32 worldSize | f32 viewRadius | u8 pktFlags | u16 zoneCount | zones…
 *   pktFlags bit0 = HAS_BOARD → then board block
 *
 * Zone flags: bit0 alive | bit1 outside | bit2 TERR_SYNC (full territory follows)
 * Compact pose: i16 cellX/Y | u8 radius | i16 dir*1000 | u8 trailWidth | u16 kills
 * Geometry: i16 coords (world units, rounded)
 */

export const OP = {
  JOIN: 1,
  INPUT: 2,
  PING: 3,
  NAME: 4,
  CHAT: 5,
  COLOR: 6,
  WELCOME: 10,
  STATE: 11,
  PONG: 12,
  CHAT_MSG: 13,
};

const FLAG_ALIVE = 1;
const FLAG_OUTSIDE = 2;
const FLAG_TERR = 4;
const PKT_HAS_BOARD = 1;

function encodeUtf8(str) {
  return new TextEncoder().encode(str || '');
}

function decodeUtf8(buf, offset, len) {
  return new TextDecoder().decode(buf.subarray(offset, offset + len));
}

function parseColor(hex) {
  const n = (hex || '#888888').replace('#', '');
  return [
    parseInt(n.slice(0, 2), 16) || 0,
    parseInt(n.slice(2, 4), 16) || 0,
    parseInt(n.slice(4, 6), 16) || 0,
  ];
}

function colorHex(r, g, b) {
  return (
    '#' +
    r.toString(16).padStart(2, '0') +
    g.toString(16).padStart(2, '0') +
    b.toString(16).padStart(2, '0')
  );
}

function clampI16(n) {
  const v = Math.round(n);
  if (v > 32767) return 32767;
  if (v < -32768) return -32768;
  return v;
}

function measureTerritory(territory) {
  let n = 2;
  for (const poly of territory || []) {
    n += 2;
    for (const ring of poly) {
      n += 2 + ring.length * 4;
    }
  }
  return n;
}

function measureZone(z) {
  const idLen = encodeUtf8(String(z.id)).length;
  const nameLen = encodeUtf8(String(z.name || '').slice(0, 16)).length;
  // id + name + rgb + flags + pose(10) + kills already in pose + trail
  let n = 1 + idLen + 1 + nameLen + 3 + 1 + 10;
  n += 2 + (z.trail?.length || 0) * 4;
  if (z.terrSync) n += measureTerritory(z.territory || []);
  return n;
}

function measureBoard(board) {
  let n = 2;
  for (const b of board || []) {
    const idLen = encodeUtf8(String(b.id)).length;
    const nameLen = encodeUtf8(String(b.name || '').slice(0, 16)).length;
    n += 1 + idLen + 1 + nameLen + 3 + 2 + 4; // pct u16, cell i16 i16
  }
  return n;
}

export function encodeJoin(name = '', colorIdx = 255) {
  const raw = encodeUtf8(String(name).slice(0, 24));
  const buf = new Uint8Array(3 + raw.length);
  buf[0] = OP.JOIN;
  buf[1] = raw.length;
  buf.set(raw, 2);
  buf[2 + raw.length] = colorIdx & 0xff;
  return buf;
}

export function encodeName(name = '') {
  const raw = encodeUtf8(String(name).slice(0, 24));
  const buf = new Uint8Array(2 + raw.length);
  buf[0] = OP.NAME;
  buf[1] = raw.length;
  buf.set(raw, 2);
  return buf;
}

export function encodeColor(colorIdx = 0) {
  const buf = new Uint8Array(2);
  buf[0] = OP.COLOR;
  buf[1] = colorIdx & 0xff;
  return buf;
}

export function encodeChat(text = '') {
  const raw = encodeUtf8(String(text).slice(0, 80));
  const buf = new Uint8Array(2 + raw.length);
  buf[0] = OP.CHAT;
  buf[1] = raw.length;
  buf.set(raw, 2);
  return buf;
}

export function encodeChatMsg(name, color, text) {
  const n = encodeUtf8(String(name || 'Игрок').slice(0, 16));
  const t = encodeUtf8(String(text || '').slice(0, 80));
  const [r, g, b] = parseColor(color);
  const buf = new Uint8Array(1 + 1 + n.length + 3 + 1 + t.length);
  const v = new DataView(buf.buffer);
  let o = 0;
  v.setUint8(o++, OP.CHAT_MSG);
  v.setUint8(o++, n.length);
  buf.set(n, o);
  o += n.length;
  v.setUint8(o++, r);
  v.setUint8(o++, g);
  v.setUint8(o++, b);
  v.setUint8(o++, t.length);
  buf.set(t, o);
  return buf;
}

export function encodeInput(dx, dy) {
  const buf = new ArrayBuffer(1 + 8);
  const v = new DataView(buf);
  v.setUint8(0, OP.INPUT);
  v.setFloat32(1, dx, true);
  v.setFloat32(5, dy, true);
  return buf;
}

export function encodePing(t) {
  const buf = new ArrayBuffer(1 + 8);
  const v = new DataView(buf);
  v.setUint8(0, OP.PING);
  v.setFloat64(1, t || 0, true);
  return buf;
}

export function encodeWelcome(id, size) {
  const raw = encodeUtf8(String(id));
  const buf = new Uint8Array(1 + 1 + raw.length + 4);
  const v = new DataView(buf.buffer);
  let o = 0;
  v.setUint8(o++, OP.WELCOME);
  v.setUint8(o++, raw.length);
  buf.set(raw, o);
  o += raw.length;
  v.setFloat32(o, size, true);
  return buf;
}

function writeTerritory(v, u8, o, territory) {
  const polys = territory || [];
  v.setUint16(o, polys.length, true);
  o += 2;
  for (const poly of polys) {
    v.setUint16(o, poly.length, true);
    o += 2;
    for (const ring of poly) {
      v.setUint16(o, ring.length, true);
      o += 2;
      for (const p of ring) {
        v.setInt16(o, clampI16(p[0]), true);
        o += 2;
        v.setInt16(o, clampI16(p[1]), true);
        o += 2;
      }
    }
  }
  return o;
}

export function encodeState(snap) {
  const zones = snap.zones || [];
  const boardSync = !!snap.boardSync && Array.isArray(snap.board);
  const board = boardSync ? snap.board : [];
  let size = 1 + 4 + 4 + 4 + 1 + 2;
  for (const z of zones) size += measureZone(z);
  if (boardSync) size += measureBoard(board);
  const buf = new ArrayBuffer(size + 64);
  const u8 = new Uint8Array(buf);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o++, OP.STATE);
  v.setUint32(o, snap.tick >>> 0, true);
  o += 4;
  v.setFloat32(o, snap.size, true);
  o += 4;
  v.setFloat32(o, snap.viewRadius ?? 600, true);
  o += 4;
  v.setUint8(o++, boardSync ? PKT_HAS_BOARD : 0);
  v.setUint16(o, zones.length, true);
  o += 2;

  for (const z of zones) {
    const id = encodeUtf8(String(z.id));
    v.setUint8(o++, id.length);
    u8.set(id, o);
    o += id.length;
    const name = encodeUtf8(String(z.name || '').slice(0, 16));
    v.setUint8(o++, name.length);
    u8.set(name, o);
    o += name.length;
    const [r, g, b] = parseColor(z.color);
    v.setUint8(o++, r);
    v.setUint8(o++, g);
    v.setUint8(o++, b);
    let flags = 0;
    if (z.alive) flags |= FLAG_ALIVE;
    if (z.outside) flags |= FLAG_OUTSIDE;
    if (z.terrSync) flags |= FLAG_TERR;
    v.setUint8(o++, flags);
    v.setInt16(o, clampI16(z.cell[0]), true);
    o += 2;
    v.setInt16(o, clampI16(z.cell[1]), true);
    o += 2;
    v.setUint8(o++, Math.max(0, Math.min(255, Math.round(z.radius ?? 11))));
    v.setInt16(o, clampI16((z.dir || 0) * 1000), true);
    o += 2;
    v.setUint8(o++, Math.max(0, Math.min(255, Math.round(z.trailWidth || 8))));
    v.setUint16(o, z.kills >>> 0, true);
    o += 2;

    const trail = z.trail || [];
    v.setUint16(o, trail.length, true);
    o += 2;
    for (const p of trail) {
      v.setInt16(o, clampI16(p[0]), true);
      o += 2;
      v.setInt16(o, clampI16(p[1]), true);
      o += 2;
    }

    if (z.terrSync) {
      o = writeTerritory(v, u8, o, z.territory || []);
    }
  }

  if (boardSync) {
    v.setUint16(o, board.length, true);
    o += 2;
    for (const b of board) {
      const id = encodeUtf8(String(b.id));
      v.setUint8(o++, id.length);
      u8.set(id, o);
      o += id.length;
      const name = encodeUtf8(String(b.name || '').slice(0, 16));
      v.setUint8(o++, name.length);
      u8.set(name, o);
      o += name.length;
      const [r, g, bl] = parseColor(b.color);
      v.setUint8(o++, r);
      v.setUint8(o++, g);
      v.setUint8(o++, bl);
      v.setUint16(o, Math.max(0, Math.min(65535, Math.round((b.pct || 0) * 100))), true);
      o += 2;
      v.setInt16(o, clampI16(b.cell[0]), true);
      o += 2;
      v.setInt16(o, clampI16(b.cell[1]), true);
      o += 2;
    }
  }

  return buf.slice(0, o);
}

export function encodePong(t) {
  const buf = new ArrayBuffer(1 + 8);
  const v = new DataView(buf);
  v.setUint8(0, OP.PONG);
  v.setFloat64(1, t || 0, true);
  return buf;
}

function readTerritory(v, o) {
  const polyCount = v.getUint16(o, true);
  o += 2;
  const territory = [];
  for (let p = 0; p < polyCount; p++) {
    const ringCount = v.getUint16(o, true);
    o += 2;
    const poly = [];
    for (let ri = 0; ri < ringCount; ri++) {
      const n = v.getUint16(o, true);
      o += 2;
      const ring = [];
      for (let k = 0; k < n; k++) {
        const x = v.getInt16(o, true);
        o += 2;
        const y = v.getInt16(o, true);
        o += 2;
        ring.push([x, y]);
      }
      poly.push(ring);
    }
    territory.push(poly);
  }
  return { territory, o };
}

export function decodePacket(data) {
  const buf =
    data instanceof ArrayBuffer
      ? data
      : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const u8 = new Uint8Array(buf);
  const v = new DataView(buf);
  const op = v.getUint8(0);
  let o = 1;

  if (op === OP.JOIN) {
    const len = v.getUint8(o++);
    const name = decodeUtf8(u8, o, len);
    o += len;
    const colorIdx = o < u8.length ? v.getUint8(o) : 255;
    return { type: 'join', name, colorIdx };
  }
  if (op === OP.NAME) {
    const len = v.getUint8(o++);
    return { type: 'name', name: decodeUtf8(u8, o, len) };
  }
  if (op === OP.COLOR) {
    return { type: 'color', colorIdx: v.getUint8(o) };
  }
  if (op === OP.CHAT) {
    const len = v.getUint8(o++);
    return { type: 'chat', text: decodeUtf8(u8, o, len) };
  }
  if (op === OP.INPUT) {
    return {
      type: 'input',
      dx: v.getFloat32(o, true),
      dy: v.getFloat32(o + 4, true),
    };
  }
  if (op === OP.PING) {
    return { type: 'ping', t: v.getFloat64(o, true) };
  }
  if (op === OP.WELCOME) {
    const len = v.getUint8(o++);
    const id = decodeUtf8(u8, o, len);
    o += len;
    return { type: 'welcome', id, size: v.getFloat32(o, true) };
  }
  if (op === OP.PONG) {
    return { type: 'pong', t: v.getFloat64(o, true) };
  }
  if (op === OP.CHAT_MSG) {
    const nameLen = v.getUint8(o++);
    const name = decodeUtf8(u8, o, nameLen);
    o += nameLen;
    const r = v.getUint8(o++);
    const g = v.getUint8(o++);
    const b = v.getUint8(o++);
    const textLen = v.getUint8(o++);
    const text = decodeUtf8(u8, o, textLen);
    return {
      type: 'chat_msg',
      name: name || 'Игрок',
      color: colorHex(r, g, b),
      text,
    };
  }
  if (op === OP.STATE) {
    const tick = v.getUint32(o, true);
    o += 4;
    const size = v.getFloat32(o, true);
    o += 4;
    const viewRadius = v.getFloat32(o, true);
    o += 4;
    const pktFlags = v.getUint8(o++);
    const boardSync = !!(pktFlags & PKT_HAS_BOARD);
    const count = v.getUint16(o, true);
    o += 2;
    const zones = [];
    for (let i = 0; i < count; i++) {
      const idLen = v.getUint8(o++);
      const id = decodeUtf8(u8, o, idLen);
      o += idLen;
      const nameLen = v.getUint8(o++);
      const name = decodeUtf8(u8, o, nameLen);
      o += nameLen;
      const r = v.getUint8(o++);
      const g = v.getUint8(o++);
      const b = v.getUint8(o++);
      const flags = v.getUint8(o++);
      const cellX = v.getInt16(o, true);
      o += 2;
      const cellY = v.getInt16(o, true);
      o += 2;
      const radius = v.getUint8(o++);
      const dir = v.getInt16(o, true) / 1000;
      o += 2;
      const trailWidth = v.getUint8(o++);
      const kills = v.getUint16(o, true);
      o += 2;
      const trailCount = v.getUint16(o, true);
      o += 2;
      const trail = [];
      for (let t = 0; t < trailCount; t++) {
        const x = v.getInt16(o, true);
        o += 2;
        const y = v.getInt16(o, true);
        o += 2;
        trail.push([x, y]);
      }
      const terrSync = !!(flags & FLAG_TERR);
      let territory = null;
      if (terrSync) {
        const read = readTerritory(v, o);
        territory = read.territory;
        o = read.o;
      }
      zones.push({
        id,
        name: name || 'Игрок',
        color: colorHex(r, g, b),
        alive: !!(flags & FLAG_ALIVE),
        outside: !!(flags & FLAG_OUTSIDE),
        terrSync,
        cell: [cellX, cellY],
        radius,
        dir,
        trailWidth,
        kills,
        trail,
        territory,
      });
    }

    let board = null;
    if (boardSync) {
      board = [];
      const boardCount = v.getUint16(o, true);
      o += 2;
      for (let i = 0; i < boardCount; i++) {
        const idLen = v.getUint8(o++);
        const id = decodeUtf8(u8, o, idLen);
        o += idLen;
        const nameLen = v.getUint8(o++);
        const name = decodeUtf8(u8, o, nameLen);
        o += nameLen;
        const r = v.getUint8(o++);
        const g = v.getUint8(o++);
        const b = v.getUint8(o++);
        const pct = v.getUint16(o, true) / 100;
        o += 2;
        const cx = v.getInt16(o, true);
        o += 2;
        const cy = v.getInt16(o, true);
        o += 2;
        board.push({
          id,
          name: name || 'Игрок',
          color: colorHex(r, g, b),
          pct,
          cell: [cx, cy],
        });
      }
    }

    return {
      type: 'state',
      tick,
      size,
      viewRadius,
      boardSync,
      zones,
      board,
    };
  }
  return { type: 'unknown', op };
}
