-- ============================================================
-- XingHo Read　种子数据（seed.sql）
-- ============================================================
--
-- 【这个文件做什么】
--   往三张表里填一批测试数据，好让 Day 17 的读接口有东西可读。
--   数据内容参照 `src/mock/homeData.js`（前端现在用的假数据），
--   这样 Day 17 前端从假数据切到真接口时，界面看到的东西差不多，容易对比。
--
-- 【怎么做到「重复执行不报错」（重要）】
--   每条 INSERT 末尾都有 ON CONFLICT ... DO NOTHING。
--
--   它是什么意思：
--     插入每一行之前，数据库先检查主键有没有冲突。
--     冲突（说明这行已经在了）→ 跳过这条，**不报错**。
--     不冲突 → 正常插入。
--
--   所以：执行 1 次和执行 10 次，结果完全一样。
--
--   ⚠️ 但要注意：DO NOTHING 的意思是「不更新已有数据」。
--   如果你改了这里的文字、想让改动生效，光重跑没用 ——
--   得先把旧数据删掉再跑（删除语句见文件末尾）。
--
-- 【为什么每条 INSERT 一次插多行】
--   一条 INSERT 带多个 VALUES，比写很多条 INSERT 快得多，
--   而且「要么都成功、要么都不做」，不容易插一半。
--
-- 【执行顺序不能乱】
--   folders → materials → sentences
--   因为 materials 要引用 folders，sentences 要引用 materials。
--   顺序反了会报「外键约束失败」。
--
-- 【今天不填什么】
--   audio_url 留空（NULL）—— Day 19 做音频上传时才有值。
-- ============================================================


-- ------------------------------------------------------------
-- 1. 文件夹（5 个）
-- ------------------------------------------------------------
--
-- ⚠️ 注意这里**没有** 'all'（全部材料）——
--   它是前端造出来的「看全部」入口，不是真实文件夹，不进数据库。
--
INSERT INTO public.folders (id, name, created_at)
VALUES
  ('textbook',  '课本音频',  now()),
  ('listening', '听力训练',  now()),
  ('speaking',  '口语跟读',  now()),
  ('news',      '新闻英语',  now()),
  ('unsorted',  '未分类',    now())
ON CONFLICT (id) DO NOTHING;


-- ------------------------------------------------------------
-- 2. 材料（6 条）
-- ------------------------------------------------------------
--
-- folder_id 必须能在 folders 表里找到，否则外键约束会拦住。
-- 比如 'textbook' 是在上一段刚插进去的。
--
INSERT INTO public.materials (id, title, folder_id, created_at)
VALUES
  ('1', 'Unit 1 Reading',      'textbook',  now()),
  ('2', 'Unit 2 Listening',    'textbook',  now()),
  ('3', 'VOA 慢速英语 0901',    'listening', now()),
  ('4', 'BBC 六分钟英语',       'listening', now()),
  ('5', '日常口语 100 句',      'speaking',  now()),
  ('6', '还没分类的素材',        'unsorted',  now())
ON CONFLICT (id) DO NOTHING;


-- ------------------------------------------------------------
-- 3. 句段（9 条，分属两条材料）
-- ------------------------------------------------------------
--
-- 主键是 (material_id, no) 两列，所以 ON CONFLICT 也要写两列。
--
-- 时间轴用毫秒（start_ms / end_ms）：
--   1000 = 1 秒，所以 0 → 2000 就是「第 0 秒到第 2 秒」这一句。
--   每句的 end_ms 必须大于 start_ms（建表时加的检查约束会拦住反过来的）。
--
-- 故意让材料 '1' 有 6 句、材料 '3' 有 3 句 ——
--   这样 Day 17 测试「取单条材料的句段」时，能看出不同材料的句段是分开的，
--   而不是所有句段都混在一起。
--
INSERT INTO public.sentences (material_id, no, text, start_ms, end_ms)
VALUES
  -- 材料 1：Unit 1 Reading
  ('1', 1, 'Learning a language takes time.',                 0,     2000),
  ('1', 2, 'But small steps every day add up.',               2000,  4500),
  ('1', 3, 'Read aloud, and your mouth learns the rhythm.',   4500,  7500),
  ('1', 4, 'Listen again, and your ears learn the sound.',    7500,  10500),
  ('1', 5, 'Do not rush. Slow is smooth.',                    10500, 13000),
  ('1', 6, 'And smooth becomes fast.',                        13000, 15000),

  -- 材料 3：VOA 慢速英语 0901
  ('3', 1, 'This is VOA Learning English.',                   0,     2500),
  ('3', 2, 'Today we talk about reading habits.',             2500,  6000),
  ('3', 3, 'Many students read for twenty minutes a day.',    6000,  10000)
ON CONFLICT (material_id, no) DO NOTHING;


-- ============================================================
-- 执行完后怎么验证（在同一个编辑器里跑下面两句）
-- ============================================================
--
-- 【第 1 句】数一下每张表有多少行
--
--   SELECT 'folders'   AS 表名, count(*) AS 行数 FROM public.folders
--   UNION ALL
--   SELECT 'materials',        count(*)          FROM public.materials
--   UNION ALL
--   SELECT 'sentences',        count(*)          FROM public.sentences;
--
--   期望：folders 5 行 / materials 6 行 / sentences 9 行
--
--
-- 【第 2 句】看看实际内容（截图用这个，每张表至少 5 行）
--
--   SELECT * FROM public.folders;
--   SELECT * FROM public.materials;
--   SELECT * FROM public.sentences;
--
--
-- ============================================================
-- 附：想「重来一遍」怎么办
-- ============================================================
--
-- 因为用了 DO NOTHING，改了数据再重跑不会生效。要重置的话，
-- 按**子表先删**的顺序执行（顺序反了会被外键拦住）：
--
--   DELETE FROM public.sentences;
--   DELETE FROM public.materials;
--   DELETE FROM public.folders;
--
-- 然后重新执行本文件的 INSERT 部分。
--
-- ⚠️ 删表数据是不可逆的，跑之前确认一下里面没有你要留的东西。
-- ============================================================
