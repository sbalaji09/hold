// One-line JSON logs, so per-turn latency metrics can be grepped and summed after a rehearsal.
type Fields = Record<string, unknown>;

const write = (level: string, msg: string, fields?: Fields) => {
  if (process.env.VITEST && level !== "error") return;
  console.log(JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields }));
};

export const log = {
  info: (msg: string, fields?: Fields) => write("info", msg, fields),
  warn: (msg: string, fields?: Fields) => write("warn", msg, fields),
  error: (msg: string, fields?: Fields) => write("error", msg, fields),
};
