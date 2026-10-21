-- RecuérdaME — esquema de sincronización en la nube (Cloudflare D1)
-- Un "espacio" (space) es una copia en la nube identificada por un código.
CREATE TABLE IF NOT EXISTS spaces (
  code     TEXT PRIMARY KEY,   -- código de emparejamiento (ej: 7K2P-9QX)
  data     TEXT NOT NULL,      -- JSON con los recordatorios (sin audio)
  created  INTEGER NOT NULL,
  updated  INTEGER NOT NULL
);
