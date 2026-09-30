-- ============================================================
-- XingHo Read　数据库表结构（schema.sql）
-- ============================================================
--
-- 【这个文件做什么】
--   建立本项目需要的三张表。整段执行一次即可。
--   全部语句都带 IF NOT EXISTS，**重复执行不会报错**。
--
-- 【依据】
--   `api-contract.md` 第三节「数据模型」—— 字段以那里为准。
--   本文件是「数据库怎么存」，契约是「接口怎么返回」，两者不必逐字对应。
--
-- 【三张表的关系】
--
--     folders ──< materials ──< sentences
--
--     materials.folder_id   → folders.id      （一条材料属于一个文件夹）
--     sentences.material_id → materials.id    （一条材料有很多句段）
--
--   一个文件夹下有多个材料，一条材料下有多个句段 —— 这叫「一对多」。
--   关联靠的是 **id**，不是名字：名字可以重复、可以改名，id 不会。
--
-- 【列名风格】
--   数据库列名用 snake_case（folder_id / created_at），这是 PostgreSQL 的惯例。
--   接口返回给前端时转成 camelCase（folderId / createdAt），
--   转换在 Day 17 写接口时用 SQL 的 AS 别名完成，前端契约不用改。
--
-- 【为什么都写 public. 前缀】
--   CloudBase 的 PostgreSQL 用 schema 组织表，public 是默认的业务 schema。
--   写全称是为了明确无歧义（官方文档示例也是这么写的）。
--
-- 【怎么执行】
--   在 CloudBase 控制台的 SQL 编辑器里整段粘贴后运行。
--   入口：控制台 → 数据库 → SQL 编辑器
--
-- 【今天不做什么】
--   不插数据（那是 seed.sql 的事）、不配权限（GRANT / RLS，Day 17 再说）、
--   不写任何接口代码。
-- ============================================================


-- ------------------------------------------------------------
-- 表 1：folders　文件夹
-- ------------------------------------------------------------
--
-- 为什么 id 是 text 而不是自增数字：
--   前端和接口契约里 id 一律是字符串（如 'textbook'）。
--   用 text 直接存，前后端零转换，少一层出错的余地。
--
-- ⚠️ 'all'（全部材料）不会存进这张表：
--   它是前端造出来的「看全部」入口，不是真实文件夹。
--
CREATE TABLE IF NOT EXISTS public.folders (
  id          text        PRIMARY KEY,
  name        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.folders            IS '文件夹：材料的分类';
COMMENT ON COLUMN public.folders.id         IS '文件夹标识，语义化字符串（如 textbook）。''all'' 是前端保留值，不入库';
COMMENT ON COLUMN public.folders.name       IS '文件夹显示名（可重复、可改，所以关联一律用 id）';
COMMENT ON COLUMN public.folders.created_at IS '创建时间，带时区。默认取服务器当前时间';


-- ------------------------------------------------------------
-- 表 2：materials　材料
-- ------------------------------------------------------------
--
-- 为什么没有 sentenceCount 这一列：
--   契约里接口要返回 sentenceCount，但它是「算出来的」，不是「存起来的」。
--   Day 17 用 COUNT() 从 sentences 表数出来即可。
--   如果存成列，增删句段时都要记得同步更新，很容易不一致。
--
-- 为什么 folder_id 不加 ON DELETE CASCADE：
--   默认行为是「文件夹下还有材料时，不允许删文件夹」——
--   这是**故意**的保守设置，防止手滑把一整个文件夹的材料全删了。
--   （句段表相反，见下）
--
CREATE TABLE IF NOT EXISTS public.materials (
  id          text        PRIMARY KEY,
  title       text        NOT NULL,
  folder_id   text        NOT NULL REFERENCES public.folders(id),
  audio_url   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.materials            IS '材料：一条练习素材';
COMMENT ON COLUMN public.materials.id         IS '材料标识，字符串（如 ''1''），与地址栏 #/practice/1 一致';
COMMENT ON COLUMN public.materials.title      IS '材料标题';
COMMENT ON COLUMN public.materials.folder_id  IS '所属文件夹，外键指向 folders.id';
COMMENT ON COLUMN public.materials.audio_url  IS '音频文件地址。今天留空，Day 19 做音频上传时才开始填';
COMMENT ON COLUMN public.materials.created_at IS '创建时间，带时区';

-- 首页要「按文件夹筛选材料」，这个索引让筛选不必全表扫描。
-- 数据量小的时候看不出差别，但这是正确习惯：**外键列通常都要建索引**。
CREATE INDEX IF NOT EXISTS idx_materials_folder_id ON public.materials(folder_id);


-- ------------------------------------------------------------
-- 表 3：sentences　句段
-- ------------------------------------------------------------
--
-- 为什么主键是 (material_id, no) 两列合起来：
--   「第 1 句」单独拿出来不唯一 —— 每条材料都有第 1 句。
--   但「材料 A 的第 1 句」是唯一的。两列合起来才能定位一句。
--
-- 为什么 ON DELETE CASCADE：
--   句段脱离材料没有意义。删掉一条材料时，它的句段自动跟着删，
--   否则会留下「没有妈妈的句段」，越积越多污染数据。
--
-- 为什么 text 列允许为空：
--   PRD 明确「不填文本也能保存」—— 用户可能只想练听音跟读，不打字。
--
-- 为什么加 end_ms > start_ms 这条检查：
--   句段的终点必须晚于起点，否则是坏数据。
--   让数据库自己拦住它，比等到界面上出怪现象再查要好。
--
CREATE TABLE IF NOT EXISTS public.sentences (
  material_id text    NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  no          integer NOT NULL,
  text        text,
  start_ms    integer NOT NULL,
  end_ms      integer NOT NULL,

  PRIMARY KEY (material_id, no),
  CONSTRAINT chk_sentences_time CHECK (end_ms > start_ms)
);

COMMENT ON TABLE  public.sentences             IS '句段：材料下的一句（跟读的最小单位）';
COMMENT ON COLUMN public.sentences.material_id IS '所属材料，外键指向 materials.id。删材料时本行自动删除';
COMMENT ON COLUMN public.sentences.no          IS '句段序号，从 1 开始';
COMMENT ON COLUMN public.sentences.text        IS '对应文本。可以为空（不填文本也能保存）';
COMMENT ON COLUMN public.sentences.start_ms    IS '在音频中的起点，毫秒';
COMMENT ON COLUMN public.sentences.end_ms      IS '在音频中的终点，毫秒，必须晚于起点';


-- ============================================================
-- 执行完后怎么确认建成了
-- ============================================================
--
-- 在同一个 SQL 编辑器里执行下面这句，应该看到 3 行：
--
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--     AND table_name IN ('folders', 'materials', 'sentences')
--   ORDER BY table_name;
--
-- 期望结果：folders / materials / sentences
-- ============================================================
