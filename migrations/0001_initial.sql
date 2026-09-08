CREATE TABLE IF NOT EXISTS Groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  order_num INTEGER NOT NULL DEFAULT 0,
  is_private INTEGER NOT NULL DEFAULT 0 CHECK (is_private IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  logo TEXT,
  description TEXT,
  group_id INTEGER NOT NULL,
  order_num INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES Groups(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_groups_order ON Groups(order_num, id);
CREATE INDEX IF NOT EXISTS idx_links_group_order ON Links(group_id, order_num, id);

INSERT INTO Groups (name, order_num, is_private)
SELECT '我的工具', 1, 0 WHERE NOT EXISTS (SELECT 1 FROM Groups);

INSERT INTO Links (name, url, description, group_id, order_num)
SELECT '短链接', 'https://s.992698.xyz/', '创建和管理短链接', id, 1 FROM Groups WHERE name = '我的工具'
AND NOT EXISTS (SELECT 1 FROM Links WHERE url = 'https://s.992698.xyz/');

INSERT INTO Links (name, url, description, group_id, order_num)
SELECT '图床', 'https://img.992698.xyz/', '上传和管理图片', id, 2 FROM Groups WHERE name = '我的工具'
AND NOT EXISTS (SELECT 1 FROM Links WHERE url = 'https://img.992698.xyz/');

INSERT INTO Links (name, url, description, group_id, order_num)
SELECT '云盘', 'https://drive.992698.xyz/', '个人文件与 WebDAV', id, 3 FROM Groups WHERE name = '我的工具'
AND NOT EXISTS (SELECT 1 FROM Links WHERE url = 'https://drive.992698.xyz/');
