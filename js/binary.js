/**
 * Binary WS protocol for Zona (AOI state + board for minimap/leaderboard).
 *
 * STATE 11:
 *   u32 tick | f32 worldSize | f32 viewRadius | u16 zoneCount | zones…
 *   u16 boardCount | board entries…
 *
 * Board entry (all alive players, lightweight):
 *   u8 idLen | utf8 id | u8 r,g,b | f32 pct | f32 cellX | f32 cellY
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

function measureZone(z) {
  const idLen = encodeUtf8(String(z.id)).length;
  const nameLen = encodeUtf8(String(z.name || '').slice(0, 16)).length;
  let n = 1 + idLen + 1 + nameLen + 3 + 1 + 20 + 2;
  n += 2 + (z.trail?.length || 0) * 8;
  n += 2;
  for (const poly of z.territory || []) {
    n += 2;
    for (const ring of poly) {
      n += 2 + ring.length * 8;
    }
  }
  return n;
}

function measureBoard(board) {
  let n = 2;
  for (const b of board || []) {
    const idLen = encodeUtf8(String(b.id)).length;
    const nameLen = encodeUtf8(String(b.name || '').slice(0, 16)).length;
    n += 1 + idLen + 1 + nameLen + 3 + 4 + 8;
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

/** Change nick while already in a match. */
export function encodeName(name = '') {
  const raw = encodeUtf8(String(name).slice(0, 24));
  const buf = new Uint8Array(2 + raw.length);
  buf[0] = OP.NAME;
  buf[1] = raw.length;
  buf.set(raw, 2);
  return buf;
}

/** Change color while in a match (palette index). */
export function encodeColor(colorIdx = 0) {
  const buf = new Uint8Array(2);
  buf[0] = OP.COLOR;
  buf[1] = colorIdx & 0xff;
  return buf;
}

/** C→S chat text (max 80). */
export function encodeChat(text = '') {
  const raw = encodeUtf8(String(text).slice(0, 80));
  const buf = new Uint8Array(2 + raw.length);
  buf[0] = OP.CHAT;
  buf[1] = raw.length;
  buf.set(raw, 2);
  return buf;
}

/** S→C chat broadcast: name + rgb + text. */
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

export function encodeState(snap) {
  const zones = snap.zones || [];
  const board = snap.board || [];
  let size = 1 + 4 + 4 + 4 + 2;
  for (const z of zones) size += measureZone(z);
  size += measureBoard(board);
  const buf = new ArrayBuffer(size + 128);
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
    if (z.alive) flags |= 1;
    if (z.outside) flags |= 2;
    v.setUint8(o++, flags);
    v.setFloat32(o, z.cell[0], true);
    o += 4;
    v.setFloat32(o, z.cell[1], true);
    o += 4;
    // Allow 0 = head hidden (outside viewer AOI); don't coerce with || 11
    v.setFloat32(o, z.radius ?? 11, true);
    o += 4;
    v.setFloat32(o, z.dir || 0, true);
    o += 4;
    v.setFloat32(o, z.trailWidth || 8, true);
    o += 4;
    v.setUint16(o, z.kills >>> 0, true);
    o += 2;

    const trail = z.trail || [];
    v.setUint16(o, trail.length, true);
    o += 2;
    for (const p of trail) {
      v.setFloat32(o, p[0], true);
      o += 4;
      v.setFloat32(o, p[1], true);
      o += 4;
    }

    const territory = z.territory || [];
    v.setUint16(o, territory.length, true);
    o += 2;
    for (const poly of territory) {
      v.setUint16(o, poly.length, true);
      o += 2;
      for (const ring of poly) {
        v.setUint16(o, ring.length, true);
        o += 2;
        for (const p of ring) {
          v.setFloat32(o, p[0], true);
          o += 4;
          v.setFloat32(o, p[1], true);
          o += 4;
        }
      }
    }
  }

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
    v.setFloat32(o, b.pct || 0, true);
    o += 4;
    v.setFloat32(o, b.cell[0], true);
    o += 4;
    v.setFloat32(o, b.cell[1], true);
    o += 4;
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
      const cellX = v.getFloat32(o, true);
      o += 4;
      const cellY = v.getFloat32(o, true);
      o += 4;
      const radius = v.getFloat32(o, true);
      o += 4;
      const dir = v.getFloat32(o, true);
      o += 4;
      const trailWidth = v.getFloat32(o, true);
      o += 4;
      const kills = v.getUint16(o, true);
      o += 2;
      const trailCount = v.getUint16(o, true);
      o += 2;
      const trail = [];
      for (let t = 0; t < trailCount; t++) {
        const x = v.getFloat32(o, true);
        o += 4;
        const y = v.getFloat32(o, true);
        o += 4;
        trail.push([x, y]);
      }
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
            const x = v.getFloat32(o, true);
            o += 4;
            const y = v.getFloat32(o, true);
            o += 4;
            ring.push([x, y]);
          }
          poly.push(ring);
        }
        territory.push(poly);
      }
      zones.push({
        id,
        name: name || 'Игрок',
        color: colorHex(r, g, b),
        alive: !!(flags & 1),
        outside: !!(flags & 2),
        cell: [cellX, cellY],
        radius,
        dir,
        trailWidth,
        kills,
        trail,
        territory,
      });
    }

    const board = [];
    if (o + 2 <= buf.byteLength) {
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
        const pct = v.getFloat32(o, true);
        o += 4;
        const cx = v.getFloat32(o, true);
        o += 4;
        const cy = v.getFloat32(o, true);
        o += 4;
        board.push({
          id,
          name: name || 'Игрок',
          color: colorHex(r, g, b),
          pct,
          cell: [cx, cy],
        });
      }
    }

    return { type: 'state', tick, size, viewRadius, zones, board };
  }
  return { type: 'unknown', op };
}
