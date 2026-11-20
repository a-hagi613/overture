import { createSocket } from "node:dgram";

function readName(message: Buffer, start: number) {
  let offset = start;
  const labels: string[] = [];

  while (true) {
    const length = message[offset];

    if (length === undefined) {
      return { name: labels.join("."), offset };
    }

    if (length === 0) {
      offset += 1;

      break;
    }

    labels.push(message.toString("utf8", offset + 1, offset + 1 + length));
    offset += length + 1;
  }

  return { name: labels.join(".").toLowerCase(), offset };
}

function txtData(record: string) {
  const bytes = Buffer.from(record, "utf8");
  const parts: Buffer[] = [];

  for (let offset = 0; offset < bytes.length; offset += 255) {
    const chunk = bytes.subarray(offset, offset + 255);

    parts.push(Buffer.from([chunk.length]), chunk);
  }

  return Buffer.concat(parts);
}

function answerFor(query: Buffer, records: Record<string, string[]>) {
  const { name, offset } = readName(query, 12);
  const qtype = query.readUInt16BE(offset);
  const question = query.subarray(12, offset + 4);
  const texts = qtype === 16 ? records[name] : undefined;
  const header = Buffer.alloc(12);

  query.copy(header, 0, 0, 2);
  header.writeUInt16BE(texts === undefined ? 0x81_83 : 0x81_80, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(texts?.length ?? 0, 6);

  const answers = (texts ?? []).flatMap((text) => {
    const data = txtData(text);
    const answerHeader = Buffer.alloc(12);

    answerHeader.writeUInt16BE(0xc0_0c, 0);
    answerHeader.writeUInt16BE(16, 2);
    answerHeader.writeUInt16BE(1, 4);
    answerHeader.writeUInt32BE(60, 6);
    answerHeader.writeUInt16BE(data.length, 10);

    return [answerHeader, data];
  });

  return Buffer.concat([header, question, ...answers]);
}

export async function startTxtDnsServer(records: Record<string, string[]>) {
  const socket = createSocket("udp4");

  socket.on("message", (message, remote) => {
    socket.send(answerFor(message, records), remote.port, remote.address);
  });

  await new Promise<void>((resolve) => {
    socket.bind(0, "127.0.0.1", resolve);
  });

  const address = socket.address();

  return {
    server: `127.0.0.1:${String(address.port)}`,
    stop: async () => {
      await new Promise<void>((resolve) => {
        socket.close(resolve);
      });
    },
  };
}
